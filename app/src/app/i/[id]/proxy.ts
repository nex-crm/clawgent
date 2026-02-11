import { NextRequest, NextResponse } from "next/server";
import { instances, reconcileWithDocker, startPairingAutoApprover, findInstanceByUserId } from "@/lib/instances";
import { isWorkOSConfigured } from "@/lib/auth-config";
import {
  dbGetLinkedByWebUser,
  dbGetLinkedByPhone,
  dbInsertLinkedAccount,
  dbUpdateInstanceUserId,
  dbWasUnlinkedPair,
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
 * Handle linking when an authenticated web user visits a WA-deployed instance.
 * Shows a confirmation page before linking. Blocks previously-unlinked pairs.
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
    const signInUrl = await getSignInUrl();
    const escapedUrl = signInUrl.replace(/"/g, "&quot;");
    return new Response(
      linkPage("Sign in to access this instance",
        `<p>This instance was deployed via WhatsApp. Sign in to link it to your web account.</p>` +
        `<a href="${escapedUrl}" style="display:inline-block;margin-top:16px;padding:12px 32px;background:#00ff88;color:#000;text-decoration:none;border-radius:6px;font-weight:bold">Sign in with email</a>`),
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const webUserId = session.user.id;
  const phone = instance.userId!.replace("wa-", "");

  // Already linked to THIS web user? Proceed normally.
  const existingByPhone = dbGetLinkedByPhone(phone);
  if (existingByPhone?.web_user_id === webUserId) return null;

  // Previously unlinked? Block re-linking from web — user must re-link from WhatsApp dashboard link.
  if (dbWasUnlinkedPair(webUserId, phone)) {
    return new Response(
      errorPage("Access revoked", "This instance was unlinked from your account. Ask the WhatsApp owner to share a new link if you need access."),
      { status: 403, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // Phone linked to DIFFERENT web user? Error.
  if (existingByPhone && existingByPhone.web_user_id !== webUserId) {
    return new Response(
      errorPage("Account conflict", "This WhatsApp number is already linked to a different web account."),
      { status: 409, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // Web user linked to DIFFERENT phone? Error.
  const existingByWeb = dbGetLinkedByWebUser(webUserId);
  if (existingByWeb && existingByWeb.wa_phone !== phone) {
    return new Response(
      errorPage("Account conflict", "Your web account is already linked to a different WhatsApp number."),
      { status: 409, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  // Web user has their OWN separate active instance? Error.
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

  // Check if user confirmed linking via ?confirm_link=1
  if (request.nextUrl.searchParams.get("confirm_link") === "1") {
    console.log(`[auto-link] Linking web user ${webUserId} to WA phone ${phone} (instance ${instanceId})`);

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

    // Redirect to clean URL (remove confirm_link param)
    const host = request.headers.get("host") || "localhost:3001";
    const proto = request.headers.get("x-forwarded-proto") || "http";
    return NextResponse.redirect(`${proto}://${host}/i/${instanceId}/`, 302);
  }

  // Show confirmation page
  const email = session.user.email;
  const confirmUrl = `/i/${instanceId}/?confirm_link=1`;
  return new Response(
    linkPage("Link this instance to your account?",
      `<p>This instance was deployed via WhatsApp.</p>` +
      `<p>Linking it to <strong>${email}</strong> lets you manage it from the web dashboard. The WhatsApp owner will be notified.</p>` +
      `<div style="margin-top:24px;display:flex;gap:12px;justify-content:center">` +
      `<a href="${confirmUrl}" style="padding:12px 32px;background:#00ff88;color:#000;text-decoration:none;border-radius:6px;font-weight:bold">Yes, link my account</a>` +
      `<a href="/" style="padding:12px 32px;background:#333;color:#fff;text-decoration:none;border-radius:6px">No thanks</a>` +
      `</div>`),
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function errorPage(title: string, message: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff">` +
    `<div style="text-align:center;max-width:500px"><h2 style="color:#ff4444">${title}</h2>` +
    `<p>${message}</p><a href="/" style="color:#00ff88">Back to home</a></div></body></html>`
  );
}

function linkPage(title: string, body: string): string {
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
    `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff">` +
    `<div style="text-align:center;max-width:500px"><h2>${title}</h2>${body}</div></body></html>`
  );
}
