/**
 * Shared flag: true when all required WorkOS env vars are present.
 * When false, the app runs in dev mode with auth bypassed.
 */
export const isWorkOSConfigured =
  !!process.env.WORKOS_CLIENT_ID &&
  !!process.env.WORKOS_API_KEY &&
  !!process.env.WORKOS_COOKIE_PASSWORD;

/** Anonymous user ID used when WorkOS is not configured (dev mode). */
export const DEV_USER_ID = "dev-user-local";
