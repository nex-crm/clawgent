import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isWorkOSConfigured =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.WORKOS_COOKIE_PASSWORD;

export async function GET(req: NextRequest) {
  if (isWorkOSConfigured) {
    const { handleAuth } = await import("@workos-inc/authkit-nextjs");
    const handler = handleAuth({ returnPathname: "/" });
    return handler(req);
  }
  return NextResponse.redirect(new URL("/", req.url));
}
