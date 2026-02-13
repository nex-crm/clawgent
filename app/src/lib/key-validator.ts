/**
 * 24-hour background API key validator.
 *
 * Periodically checks that each running instance's API key is still valid
 * by hitting the provider's lightweight list-models endpoint.
 * On failure (401/403), notifies the linked WA user and marks the key as invalid
 * so the homepage can show a warning banner.
 */

import { instances, runCommandSilent } from "./instances";
import { dbGetLinkedByWebUser } from "./db";
import { sendPlivoMessage } from "./whatsapp";

const PROVIDER_CONFIG: Record<string, { envVar: string }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY" },
  google: { envVar: "GEMINI_API_KEY" },
  openai: { envVar: "OPENAI_API_KEY" },
};

interface KeyStatus {
  valid: boolean;
  checkedAt: string;
}

const keyStatusMap = new Map<string, KeyStatus>();
let intervalTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Validate an API key against its provider's models endpoint.
 * Returns true if valid, false if 401/403, null if inconclusive (network/5xx).
 */
async function checkKey(provider: string, apiKey: string): Promise<boolean | null> {
  try {
    let res: Response;

    if (provider === "anthropic") {
      res = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(10000),
      });
    } else if (provider === "google") {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(10000) },
      );
    } else if (provider === "openai") {
      res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      });
    } else {
      return null; // Unknown provider — skip
    }

    if (res.status === 401 || res.status === 403) return false;
    if (res.ok) return true;
    // 5xx or other — inconclusive, don't false-alarm
    return null;
  } catch {
    // Network error, timeout — inconclusive
    return null;
  }
}

/**
 * Extract the API key from a running container's environment.
 */
async function extractKeyFromContainer(
  containerName: string,
  envVar: string,
): Promise<string | null> {
  try {
    const envOutput = await runCommandSilent("docker", ["exec", containerName, "env"]);
    const line = envOutput.split("\n").find((l) => l.startsWith(`${envVar}=`));
    if (line) return line.split("=").slice(1).join("=").trim();
  } catch {
    // Container may not be running
  }
  return null;
}

/**
 * Validate a single instance's API key.
 * Can be called on-demand (e.g. after PATCH) or by the background loop.
 */
export async function validateInstanceKey(instanceId: string): Promise<KeyStatus | undefined> {
  const instance = instances.get(instanceId);
  if (!instance || instance.status !== "running" || !instance.provider) return undefined;

  const providerCfg = PROVIDER_CONFIG[instance.provider];
  if (!providerCfg) return undefined;

  const apiKey = await extractKeyFromContainer(instance.containerName, providerCfg.envVar);
  if (!apiKey) return undefined;

  const result = await checkKey(instance.provider, apiKey);
  if (result === null) {
    // Inconclusive — don't update status
    return keyStatusMap.get(instanceId);
  }

  const status: KeyStatus = { valid: result, checkedAt: new Date().toISOString() };
  const previousStatus = keyStatusMap.get(instanceId);
  keyStatusMap.set(instanceId, status);

  // Notify on transition to invalid (don't spam on every check)
  if (!result && (previousStatus === undefined || previousStatus.valid)) {
    console.log(`[key-validator] API key invalid for instance ${instanceId} (${instance.provider})`);
    try {
      const linked = instance.userId ? dbGetLinkedByWebUser(instance.userId) : undefined;
      if (linked) {
        await sendPlivoMessage(
          linked.wa_phone,
          "your API key appears to be invalid or expired. update it at clawgent.ai or use /key to update.",
        );
      }
    } catch (err) {
      console.error(`[key-validator] Failed to notify WA for instance ${instanceId}:`, err);
    }
  }

  return status;
}

/**
 * Get the cached key validation status for an instance.
 */
export function getKeyStatus(instanceId: string): KeyStatus | undefined {
  return keyStatusMap.get(instanceId);
}

/**
 * Clear key status for an instance (e.g. after provider change).
 */
export function clearKeyStatus(instanceId: string): void {
  keyStatusMap.delete(instanceId);
}

/**
 * Run validation for all running instances.
 */
async function validateAllKeys(): Promise<void> {
  for (const instance of instances.values()) {
    if (instance.status === "running" && instance.provider) {
      try {
        await validateInstanceKey(instance.id);
      } catch (err) {
        console.error(`[key-validator] Error validating instance ${instance.id}:`, err);
      }
    }
  }
}

const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY = 60 * 1000; // 60s after startup

/**
 * Start the 24-hour background key validation loop.
 * First check runs after 60s delay to let instances stabilize.
 */
export function startKeyValidator(): void {
  if (intervalTimer) return; // Already running

  console.log("[key-validator] Starting background key validator (24h interval, first check in 60s)");

  // Initial check after 60s
  const startupTimer = setTimeout(() => {
    validateAllKeys().catch((err) =>
      console.error("[key-validator] Initial validation failed:", err),
    );
  }, INITIAL_DELAY);
  if (startupTimer && typeof startupTimer === "object" && "unref" in startupTimer) {
    startupTimer.unref();
  }

  // Recurring check every 24h
  intervalTimer = setInterval(() => {
    validateAllKeys().catch((err) =>
      console.error("[key-validator] Periodic validation failed:", err),
    );
  }, TWENTY_FOUR_HOURS);
  if (intervalTimer && typeof intervalTimer === "object" && "unref" in intervalTimer) {
    intervalTimer.unref();
  }
}
