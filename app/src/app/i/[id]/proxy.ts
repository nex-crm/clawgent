import { NextRequest, NextResponse } from "next/server";
import { instances, reconcileWithDocker, startPairingAutoApprover } from "@/lib/instances";

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

    // Pass through response headers but filter hop-by-hop
    const responseHeaders = new Headers();
    proxyRes.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!["transfer-encoding", "connection"].includes(lower)) {
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
        const settingsScript = `<script>
(function() {
  localStorage.setItem("openclaw.control.settings.v1", JSON.stringify({
    gatewayUrl: "${gatewayUrl}",
    token: "${instance.token}"
  }));
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
    const message = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Proxy error: ${message}`, { status: 502 });
  }
}
