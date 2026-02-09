import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isWorkOSConfigured =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.WORKOS_COOKIE_PASSWORD;

export async function GET(req: NextRequest) {
  if (isWorkOSConfigured) {
    const { handleAuth } = await import("@workos-inc/authkit-nextjs");
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3001";
    const baseURL = `${proto}://${host}`;
    const handler = handleAuth({ returnPathname: "/", baseURL });
    return handler(req);
  }
  return NextResponse.redirect(new URL("/", req.url));
}
