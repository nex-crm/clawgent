import { NextResponse } from "next/server";
import type { NextRequest, NextFetchEvent } from "next/server";

const isWorkOSConfigured =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.WORKOS_COOKIE_PASSWORD;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedMiddleware: ((req: NextRequest, event: NextFetchEvent) => any) | null = null;

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
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
          // LLM proxy — containers authenticate via instance token, not WorkOS
          "/api/llm-proxy/:path*",
        ],
      },
    });
  }

  return cachedMiddleware(req, event);
}

export const config = {
  matcher: [
    // Match all paths except static assets and Next.js internals
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
