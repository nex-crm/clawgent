import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";

const isWorkOSConfigured =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.WORKOS_COOKIE_PASSWORD;

const denyAllInProd =
  process.env.NODE_ENV === "production" && !isWorkOSConfigured;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedMiddleware: ((req: NextRequest, event: NextFetchEvent) => any) | null = null;

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (denyAllInProd) {
    return new NextResponse("Service misconfigured", { status: 503 });
  }

  if (!isWorkOSConfigured) {
    // Dev mode: pass all requests through
    return NextResponse.next();
  }

  if (!cachedMiddleware) {
    const { authkitMiddleware } = await import("@workos-inc/authkit-nextjs");
    cachedMiddleware = authkitMiddleware({
      middlewareAuth: {
        enabled: true,
        unauthenticatedPaths: [
          "/",
          "/api/status",
          "/auth/callback",
          // OpenClaw proxy paths — must remain accessible after initial auth redirect
          "/i/:path*",
          // WhatsApp webhook — Plivo sends inbound messages here (no auth)
          "/api/whatsapp/webhook",
        ],
      },
    });
  }

  // CSRF: verify Origin header on state-changing requests
  // Skip CSRF for WhatsApp webhook — Plivo POSTs won't have a matching Origin
  const isWhatsAppWebhook = req.nextUrl.pathname === "/api/whatsapp/webhook";
  if (!isWhatsAppWebhook && ["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host") || "";
    if (origin) {
      const allowedOrigins = [
        `https://${host}`,
        `http://${host}`,
        "https://clawgent.ai",
        "http://localhost:3001",
      ];
      if (!allowedOrigins.includes(origin)) {
        return new NextResponse("Forbidden", { status: 403 });
      }
    }
  }

  return cachedMiddleware(req, event);
}

export const config = {
  matcher: [
    // Match all paths except static assets and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|sounds/|sprites/|ingest/).*)",
  ],
};
