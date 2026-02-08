"use server";

import { isWorkOSConfigured } from "@/lib/auth-config";

export async function getSignInUrlAction(): Promise<string> {
  if (!isWorkOSConfigured) {
    // Dev mode: no sign-in URL available
    return "/";
  }
  // TODO: Re-add Google OAuth provider parameter when Google OAuth is configured in WorkOS Dashboard
  // e.g. getSignInUrl({ provider: "GoogleOAuth" })
  const { getSignInUrl } = await import("@workos-inc/authkit-nextjs");
  return getSignInUrl();
}

export async function signOutAction(): Promise<void> {
  if (!isWorkOSConfigured) {
    return;
  }
  const { signOut } = await import("@workos-inc/authkit-nextjs");
  return signOut({ returnTo: "/" });
}
