import { NextRequest, NextResponse } from "next/server";
import { instances, reconcileWithDocker, startPairingAutoApprover, findInstanceByUserId } from "@/lib/instances";
import { isWorkOSConfigured } from "@/lib/auth-config";
import {
  dbGetLinkedByWebUser,
  dbGetLinkedByPhone,
  dbInsertLinkedAccount,
  dbUpdateInstanceUserId,
  dbGetWaSession,
  dbUpsertWaSession,
} from "@/lib/db";
import { sendPlivoMessage } from "@/lib/whatsapp";
import { randomInt } from "crypto";

export async function proxyRequest(
  request: NextRequest,
  id: string,
  subPath: string[] | undefined
) {
  let instance = instances.get(id);
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }

  if (!instance || instance.status !== "running") {
    return new NextResponse("Instance not found or not running", { status: 404 });
  }

  if (instance.port < 19000 || instance.port > 19099) {
    return new NextResponse("Invalid instance configuration", { status: 500 });
  }

  // --- Auto-link: WA-deployed instances require web auth on HTML page loads ---
  const isRootHtml = (!subPath || subPath.length === 0) &&
    (request.headers.get("accept")?.includes("text/html") ?? false);

  if (isRootHtml && instance.userId?.startsWith("wa-")) {
    const linkResult = await handleWaAutoLink(request, instance, id);
    if (linkResult) return linkResult;
    // Re-fetch instance after potential userId migration
    instance = instances.get(id)!;
  }

  // Ensure auto-approver is running for this instance on every visit.
  // Deduplicates internally — no-op if already active.
  startPairingAutoApprover(instance);

  // For root dashboard path without token: redirect to include ?token=
  // OpenClaw natively reads ?token= from URL and applies it to settings.
  //
  // SECURITY NOTE: Passing the token via URL query param is a trade-off.
  // OpenClaw requires ?token= for initial auth — it reads from the URL
  // and stores it in localStorage. Moving to cookie/header auth would
  // require upstream OpenClaw changes. The nginx log format strips query
  // params to mitigate server-side token leakage. The 302 redirect means
  // the token-bearing URL is only in the browser, not in Referer headers
  // (the redirect target URL replaces it in history).
  if (!subPath || subPath.length === 0) {
    if (!request.nextUrl.searchParams.has("token")) {
      const host = request.headers.get("host") || "localhost:3001";
      const redirectUrl = new URL(`/i/${id}/`, `http://${host}`);
      redirectUrl.searchParams.set("token", instance.token);
      return NextResponse.redirect(redirectUrl.toString(), 302);
    }
  }

  // Reconstruct the target URL
  const pathStr = "/" + (subPath?.join("/") || "");
  const targetUrl = new URL(pathStr, `http://127.0.0.1:${instance.port}`);

  // Forward query string
  request.nextUrl.searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  // Always inject the gateway token so OpenClaw authenticates the HTTP request
  if (!targetUrl.searchParams.has("token")) {
    targetUrl.searchParams.set("token", instance.token);
  }

  try {
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!["host", "connection", "keep-alive", "transfer-encoding"].includes(lower)) {
        headers[key] = value;
      }
    });

    const proxyRes = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.method !== "GET" && request.method !== "HEAD"
        ? request.body
        : undefined,
      // @ts-expect-error duplex needed for streaming body
      duplex: "half",
      redirect: "manual",
    });

    // Pass through only safe response headers (allowlist approach)
    const ALLOWED_RESPONSE_HEADERS = new Set([
      "content-type",
      "content-length",
      "cache-control",
      "etag",
      "last-modified",
      "content-encoding",
      "vary",
      "accept-ranges",
      "content-disposition",
      "x-request-id",
    ]);

    const responseHeaders = new Headers();
    proxyRes.headers.forEach((value, key) => {
      if (ALLOWED_RESPONSE_HEADERS.has(key.toLowerCase())) {
        responseHeaders.set(key, value);
      }
    });

    // Inject gatewayUrl + token into localStorage on ANY proxied HTML page.
    // OpenClaw may navigate to /chat?session=main via full page load, so
    // we can't rely on injection only on the root path.
    const contentType = responseHeaders.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let html = await proxyRes.text();

      // Only inject into full HTML pages (has </head>), not HTML fragments
      if (html.includes("</head>")) {
        const wsProto = request.headers.get("x-forwarded-proto") === "https" ? "wss" : "ws";
        const host = request.headers.get("host") || "localhost:3001";
        const gatewayUrl = `${wsProto}://${host}/i/${id}/`;

        // Set gatewayUrl and token without clearing device identity keys.
        // OpenClaw stores device keypairs in localStorage — wiping them
        // forces a new pairing request on every page refresh.
        // Double JSON.stringify to safely escape values for both
        // the JS string literal and the JSON content (prevents XSS).
        const settingsData = JSON.stringify({
          gatewayUrl: gatewayUrl,
          token: instance.token,
        });
        const settingsScript = `<script>
(function() {
  localStorage.setItem("openclaw.control.settings.v1", ${JSON.stringify(settingsData)});
})();
</script>`;

        // Canvas relay bridge: forward Canvas button actions through the chat's
        // WebSocket so they appear in the chat conversation.
        const canvasRelayScript = `<script>
(function() {
  var bc = new BroadcastChannel(${JSON.stringify("clawgent-canvas-" + id)});
  var chatWs = null;
  var sessionKey = null;
  var NativeWS = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
    chatWs = ws;

    ws.addEventListener("message", function(e) {
      if (typeof e.data !== "string") return;
      try {
        var frame = JSON.parse(e.data);
        // Extract sessionKey from connect response
        if (frame.type === "res" && frame.ok && !sessionKey) {
          var r = frame.result || frame.data || frame.payload || {};
          var key = (r.snapshot && r.snapshot.sessionDefaults && r.snapshot.sessionDefaults.mainSessionKey)
            || (r.sessionDefaults && r.sessionDefaults.mainSessionKey)
            || r.mainSessionKey;
          if (key) {
            sessionKey = key;
            bc.postMessage({ type: "relay-ready" });
          }
        }
        // Forward A2UI events to Canvas via BroadcastChannel
        if (frame.surfaceUpdate || frame.beginRendering || frame.deleteSurface || frame.dataModelUpdate) {
          bc.postMessage({ type: "a2ui-event", event: frame });
        }
        // Forward chat events that may contain A2UI in code fences
        if (frame.type === "event" && frame.event === "chat" && frame.payload) {
          bc.postMessage({ type: "chat-event", frame: frame });
        }
      } catch(ex) {}
    });

    return ws;
  };
  window.WebSocket.prototype = NativeWS.prototype;
  window.WebSocket.CONNECTING = NativeWS.CONNECTING;
  window.WebSocket.OPEN = NativeWS.OPEN;
  window.WebSocket.CLOSING = NativeWS.CLOSING;
  window.WebSocket.CLOSED = NativeWS.CLOSED;

  bc.onmessage = function(e) {
    var d = e.data;
    if (!d) return;
    if (d.type === "canvas-action" && chatWs && chatWs.readyState === 1 && sessionKey) {
      var aid = "canvas-" + Date.now() + "-" + Math.random().toString(36).slice(2,8);
      chatWs.send(JSON.stringify({
        type: "req", id: aid, method: "chat.send",
        params: { sessionKey: sessionKey, message: "[Canvas] " + d.action, idempotencyKey: aid }
      }));
      bc.postMessage({ type: "action-ack", id: d.id });
    }
    if (d.type === "ping") {
      bc.postMessage({ type: "pong", ready: !!(chatWs && chatWs.readyState === 1 && sessionKey) });
    }
  };
})();
</script>`;
        html = html.replace("</head>", settingsScript + canvasRelayScript + "</head>");
        responseHeaders.delete("content-length");

        return new Response(html, {
          status: proxyRes.status,
          statusText: proxyRes.statusText,
          headers: responseHeaders,
        });
      }
    }

    return new Response(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[proxy] Error proxying to instance ${id}:`, err);
    return new NextResponse("Bad gateway", { status: 502 });
  }
}

// --- Link code store (in-memory, ephemeral) ---
interface PendingLinkCode {
  code: string;
  webUserId: string;
  phone: string;
  instanceId: string;
  createdAt: number;
  attempts: number;
}
const CODE_TTL = 10 * 60 * 1000; // 10 minutes
const CODE_COOLDOWN = 60 * 1000; // 1 minute between sends
const MAX_ATTEMPTS = 5;
const pendingLinkCodes = new Map<string, PendingLinkCode>();

function getLinkCodeKey(instanceId: string, webUserId: string): string {
  return `${instanceId}:${webUserId}`;
}

/**
 * Handle linking when an authenticated web user visits a WA-deployed instance.
 * Sends a 6-digit code to WhatsApp owner for verification before linking.
 * Returns a Response if action is needed, or null to proceed with normal proxy.
 */
async function handleWaAutoLink(
  request: NextRequest,
  instance: { id: string; userId?: string },
  instanceId: string,
): Promise<Response | null> {
  if (!isWorkOSConfigured) return null;

  const { withAuth, getSignInUrl } = await import("@workos-inc/authkit-nextjs");
  let session: Awaited<ReturnType<typeof withAuth>>;
  try {
    session = await withAuth();
  } catch {
    return null;
  }

  if (!session.user) {
    // Encode returnPathname in state so the callback redirects back to this instance
    const returnPathname = `/i/${instanceId}/`;
    const state = btoa(JSON.stringify({ returnPathname })).replace(/\+/g, "-").replace(/\//g, "_");
    const signInUrl = await getSignInUrl({ state });
    const escapedUrl = signInUrl.replace(/"/g, "&quot;");
    return htmlResponse(
      linkPage("Sign in to access this instance",
        `<p>This instance was deployed via WhatsApp. Sign in to link it to your web account.</p>` +
        `<a href="${escapedUrl}" class="btn btn-primary">Sign in with email</a>`),
    );
  }

  const webUserId = session.user.id;
  const phone = instance.userId!.replace("wa-", "");

  // Already linked to THIS web user? Proceed normally.
  const existingByPhone = dbGetLinkedByPhone(phone);
  if (existingByPhone?.web_user_id === webUserId) return null;

  // Phone linked to DIFFERENT web user? Error.
  if (existingByPhone && existingByPhone.web_user_id !== webUserId) {
    return htmlResponse(
      errorPage("Account conflict", "This WhatsApp number is already linked to a different web account."),
      409,
    );
  }

  // Web user linked to DIFFERENT phone? Error.
  const existingByWeb = dbGetLinkedByWebUser(webUserId);
  if (existingByWeb && existingByWeb.wa_phone !== phone) {
    return htmlResponse(
      errorPage("Account conflict", "Your web account is already linked to a different WhatsApp number."),
      409,
    );
  }

  // Web user has their OWN separate active instance? Error.
  const webInstance = findInstanceByUserId(webUserId);
  if (webInstance && webInstance.id !== instanceId) {
    return htmlResponse(
      errorPage("Both accounts have instances",
        "Your web account already has a running instance. Destroy one first before linking."),
      409,
    );
  }

  const codeKey = getLinkCodeKey(instanceId, webUserId);

  // --- Handle code submission ---
  const submittedCode = request.nextUrl.searchParams.get("link_code");
  if (submittedCode) {
    const pending = pendingLinkCodes.get(codeKey);

    if (!pending || Date.now() - pending.createdAt > CODE_TTL) {
      pendingLinkCodes.delete(codeKey);
      return htmlResponse(
        linkPage("Code expired", `<p>That code has expired. Refresh to get a new one.</p>` +
          `<a href="/i/${instanceId}/" class="btn btn-primary">Try again</a>`),
      );
    }

    if (pending.attempts >= MAX_ATTEMPTS) {
      pendingLinkCodes.delete(codeKey);
      return htmlResponse(
        errorPage("Too many attempts", "Too many incorrect codes. Refresh to get a new one."),
        429,
      );
    }

    if (submittedCode !== pending.code) {
      pending.attempts++;
      const remaining = MAX_ATTEMPTS - pending.attempts;
      return htmlResponse(
        codeInputPage(instanceId, session.user.email,
          `Wrong code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.`),
      );
    }

    // Code is correct — link the accounts
    pendingLinkCodes.delete(codeKey);
    console.log(`[link] Linking web user ${webUserId} to WA phone ${phone} (instance ${instanceId})`);

    dbInsertLinkedAccount(webUserId, phone);

    dbUpdateInstanceUserId(instanceId, webUserId);
    const cached = instances.get(instanceId);
    if (cached) cached.userId = webUserId;

    const waSession = dbGetWaSession(phone);
    if (waSession) {
      waSession.userId = webUserId;
      waSession.updatedAt = new Date().toISOString();
      dbUpsertWaSession(waSession);
    }

    sendPlivoMessage(
      phone,
      `🔗 your WhatsApp is now linked to *${session.user.email}*\n\nyour instance is accessible from both WhatsApp and the web dashboard.\n\nuse /unlink on WhatsApp to disconnect.`,
    ).catch(() => {});

    const host = request.headers.get("host") || "localhost:3001";
    const proto = request.headers.get("x-forwarded-proto") || "http";
    return NextResponse.redirect(`${proto}://${host}/i/${instanceId}/`, 302);
  }

  // --- Generate and send code (or reuse if recently sent) ---
  const existing = pendingLinkCodes.get(codeKey);
  const now = Date.now();

  if (!existing || now - existing.createdAt > CODE_TTL) {
    // Generate new code
    const code = String(randomInt(100000, 999999));
    pendingLinkCodes.set(codeKey, {
      code, webUserId, phone, instanceId, createdAt: now, attempts: 0,
    });
    sendPlivoMessage(
      phone,
      `🔐 someone wants to link this instance to their web account.\n\ntheir code: *${code}*\n\nshare this code with them if you approve. it expires in 10 minutes.\n\nif this wasn't you, ignore this message.`,
    ).catch(() => {});
  } else if (request.nextUrl.searchParams.has("resend") && now - existing.createdAt > CODE_COOLDOWN) {
    // Resend with new code
    const code = String(randomInt(100000, 999999));
    existing.code = code;
    existing.createdAt = now;
    existing.attempts = 0;
    sendPlivoMessage(
      phone,
      `🔐 new link code: *${code}*\n\nshare this with the person trying to link to your instance. expires in 10 minutes.`,
    ).catch(() => {});
  }

  // Show code input page
  return htmlResponse(codeInputPage(instanceId, session.user.email));
}

// --- Page templates ---

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const PAGE_STYLES = `
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0a0a0a; color: #fff; }
    .card { text-align: center; max-width: 440px; padding: 32px; }
    h2 { margin: 0 0 16px; }
    p { color: #aaa; line-height: 1.5; }
    .error-title { color: #ff4444; }
    .btn { display: inline-block; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; border: none; cursor: pointer; font-size: 16px; }
    .btn-primary { background: #00ff88; color: #000; }
    .btn-secondary { background: #333; color: #fff; }
    .code-input { background: #1a1a1a; border: 2px solid #333; color: #fff; font-size: 32px; letter-spacing: 8px; text-align: center; padding: 12px; border-radius: 8px; width: 220px; font-family: monospace; }
    .code-input:focus { outline: none; border-color: #00ff88; }
    .error-msg { color: #ff4444; font-size: 14px; margin-top: 8px; }
    .subtle { color: #666; font-size: 13px; margin-top: 16px; }
    .subtle a { color: #888; }
  </style>`;

function codeInputPage(instanceId: string, email: string, error?: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link instance</title>${PAGE_STYLES}</head>` +
    `<body><div class="card">` +
    `<h2>Enter link code</h2>` +
    `<p>A 6-digit code was sent to the WhatsApp owner of this instance. Enter it below to link to <strong>${email}</strong>.</p>` +
    `<form action="/i/${instanceId}/" method="get" style="margin-top:24px">` +
    `<input name="link_code" class="code-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" autocomplete="off" autofocus required>` +
    (error ? `<div class="error-msg">${error}</div>` : "") +
    `<div style="margin-top:20px;display:flex;gap:12px;justify-content:center">` +
    `<button type="submit" class="btn btn-primary">Verify &amp; link</button>` +
    `<a href="/" class="btn btn-secondary">Cancel</a></div></form>` +
    `<p class="subtle">Didn't get the code? <a href="/i/${instanceId}/?resend">Resend code</a></p>` +
    `</div></body></html>`
  );
}

function errorPage(title: string, message: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${PAGE_STYLES}</head>` +
    `<body><div class="card"><h2 class="error-title">${title}</h2>` +
    `<p>${message}</p><a href="/" class="btn btn-secondary" style="margin-top:16px">Back to home</a></div></body></html>`
  );
}

function linkPage(title: string, body: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>${PAGE_STYLES}</head>` +
    `<body><div class="card"><h2>${title}</h2>${body}</div></body></html>`
  );
}
