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
        html = html.replace("</head>", settingsScript + "</head>");
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

/**
 * Handle auto-linking when an authenticated web user visits a WA-deployed instance.
 * Returns a Response if the user needs to authenticate or if there's a conflict.
 * Returns null if linking succeeded or was already done — caller should proceed normally.
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
    return null; // Auth check failed non-fatally, proceed without linking
  }

  if (!session.user) {
    // Not authenticated — redirect to WorkOS login
    // After auth, the middleware routes back to the original URL.
    const signInUrl = await getSignInUrl();
    const escapedUrl = signInUrl.replace(/"/g, "&quot;");
    return new Response(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escapedUrl}">` +
      `<title>Sign in to access this instance</title></head>` +
      `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff">` +
      `<div style="text-align:center"><h2>Sign in to access this instance</h2>` +
      `<p>This instance was deployed via WhatsApp. Sign in to link it to your web account.</p>` +
      `<a href="${escapedUrl}" style="color:#00ff88">Sign in with email</a></div></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // Authenticated — run auto-link logic
  const webUserId = session.user.id;
  const phone = instance.userId!.replace("wa-", "");

  // 1. Already linked to THIS web user? Skip.
  const existingByPhone = dbGetLinkedByPhone(phone);
  if (existingByPhone?.web_user_id === webUserId) return null;

  // 2. Phone linked to DIFFERENT web user? Error.
  if (existingByPhone && existingByPhone.web_user_id !== webUserId) {
    return new Response(
      errorPage("Account conflict", "This WhatsApp number is already linked to a different web account."),
      { status: 409, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // 3. Web user linked to DIFFERENT phone? Error.
  const existingByWeb = dbGetLinkedByWebUser(webUserId);
  if (existingByWeb && existingByWeb.wa_phone !== phone) {
    return new Response(
      errorPage("Account conflict", "Your web account is already linked to a different WhatsApp number."),
      { status: 409, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // 4. Web user has their OWN separate active instance? Error.
  const webInstance = findInstanceByUserId(webUserId);
  if (webInstance && webInstance.id !== instanceId) {
    return new Response(
      errorPage(
        "Both accounts have instances",
        "Your web account already has a running instance. Destroy one first before linking.",
      ),
      { status: 409, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // 5. All clear — LINK the accounts
  console.log(`[auto-link] Linking web user ${webUserId} to WA phone ${phone} (instance ${instanceId})`);

  // a. Insert linked_accounts
  dbInsertLinkedAccount(webUserId, phone);

  // b. Update instance.userId from wa-{phone} to webUserId (DB + cache)
  dbUpdateInstanceUserId(instanceId, webUserId);
  const cached = instances.get(instanceId);
  if (cached) cached.userId = webUserId;

  // c. Update whatsapp_sessions.userId to webUserId
  const waSession = dbGetWaSession(phone);
  if (waSession) {
    waSession.userId = webUserId;
    waSession.updatedAt = new Date().toISOString();
    dbUpsertWaSession(waSession);
  }

  // d. Notify on WhatsApp (fire and forget)
  sendPlivoMessage(
    phone,
    `🔗 your WhatsApp is now linked to *${session.user.email}*\n\nyour instance is accessible from both WhatsApp and the web dashboard.\n\nuse /unlink on WhatsApp to disconnect.`,
  ).catch(() => {});

  return null; // Proceed to serve the proxied page
}

function errorPage(title: string, message: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff">` +
    `<div style="text-align:center;max-width:500px"><h2 style="color:#ff4444">${title}</h2>` +
    `<p>${message}</p><a href="/" style="color:#00ff88">Back to home</a></div></body></html>`
  );
}
