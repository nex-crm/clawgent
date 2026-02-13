// Centralized WhatsApp / Plivo configuration.
// All deployer-customizable settings live here.
// Only PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, and PLIVO_WHATSAPP_NUMBER are required;
// everything else has sensible defaults.

// --- Tier 1: Must-have (Plivo credentials & branding) ---

export const PLIVO_AUTH_ID = process.env.PLIVO_AUTH_ID ?? "";
export const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN ?? "";

/** Plivo WhatsApp sender number — no fallback, must be configured. */
export const PLIVO_WHATSAPP_NUMBER = (() => {
  const num = process.env.PLIVO_WHATSAPP_NUMBER;
  if (!num) {
    console.error("[whatsapp-config] PLIVO_WHATSAPP_NUMBER is not set — WhatsApp messaging will fail");
  }
  return num ?? "";
})();

export const PLIVO_API_URL = "https://api.plivo.com/v1";

/** Public base URL for the platform (used in messages, allowed origins, dashboard links). */
export const BASE_URL =
  process.env.BASE_URL ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://clawgent.ai"
    : `http://localhost:${process.env.PORT ?? 3001}`);

/** Brand name shown in WhatsApp interactive headers. */
export const WA_BRAND_HEADER = process.env.WA_BRAND_HEADER ?? "welcome to clawgent by nex.ai";

/** Brand name shown in WhatsApp interactive footers. */
export const WA_BRAND_FOOTER = process.env.WA_BRAND_FOOTER ?? "clawgent.ai";

/** Welcome message body sent to new WhatsApp users. */
export const WA_WELCOME_BODY =
  process.env.WA_WELCOME_BODY ??
  "yo, i deploy AI agents that actually do stuff.\nmarketing, sales, dev, ops -- pick your agent.\n\nlet's get you set up. takes about 60 seconds.";

/** Help command label shown in /help responses. */
export const WA_HELP_LABEL = process.env.WA_HELP_LABEL ?? "clawgent commands";

// --- Tier 2: Operational settings ---

/** Maximum concurrent instances across the entire platform. */
export const MAX_INSTANCES = parseInt(process.env.MAX_INSTANCES ?? "20", 10);

/** Rate limit: time window in ms for per-phone rate limiting. */
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.WA_RATE_LIMIT_WINDOW_MS ?? "60000", 10);

/** Rate limit: max messages per phone per window. */
export const RATE_LIMIT_MAX = parseInt(process.env.WA_RATE_LIMIT_MAX ?? "10", 10);

/** Docker container memory limit (e.g. "1024m"). */
export const CONTAINER_MEMORY = process.env.CONTAINER_MEMORY ?? "1024m";

/** Docker container memory swap limit (defaults to same as CONTAINER_MEMORY). */
export const CONTAINER_MEMORY_SWAP = process.env.CONTAINER_MEMORY_SWAP ?? CONTAINER_MEMORY;

/** Docker container CPU limit. */
export const CONTAINER_CPUS = process.env.CONTAINER_CPUS ?? "0.5";

/** Trusted proxy CIDRs for gateway config. */
export const TRUSTED_PROXIES: string[] = process.env.TRUSTED_PROXIES
  ? process.env.TRUSTED_PROXIES.split(",").map((s) => s.trim())
  : ["172.17.0.0/16", "127.0.0.1"];

/** Allowed origins for OpenClaw gateway control UI — derived from BASE_URL by default. */
export const ALLOWED_ORIGINS: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim())
  : [BASE_URL, ...(BASE_URL.startsWith("https://") ? [`http://localhost:${process.env.PORT ?? 3001}`] : [])];

// --- Tier 3: Rarely changed (constants with comments) ---

// These can be extracted to env vars if needed for your deployment:
// MAX_MESSAGE_LENGTH = 4000 (Plivo max per message)
// PORT_RANGE_START = 19000 (first port for container allocation)
// HEALTH_CHECK_TIMEOUT = 60 (seconds to wait for gateway health)
// CONTAINER_PIDS_LIMIT = 256
