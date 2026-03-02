/**
 * Memory-nex plugin config updater.
 *
 * Periodically checks running containers for a Nex API key
 * (written by the agent during registration) and ensures the
 * memory-nex plugin config in openclaw.json stays in sync.
 *
 * Same lifecycle pattern as key-validator.ts / nex-skill-updater.ts:
 *   - 90s startup delay (after skill updater)
 *   - 5-minute recurring interval
 *   - .unref() timers so they don't block process exit
 */

import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { instances, runCommand, runCommandSilent } from "./instances";

const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const FIVE_MINUTES = 5 * 60 * 1000;
const INITIAL_DELAY = 90 * 1000; // 90s after startup

let intervalTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Read the Nex API key from the container's openclaw.json.
 * The agent writes it to skills.entries.nex.env.NEX_API_KEY during registration.
 */
async function readNexApiKeyFromContainer(containerName: string): Promise<string | null> {
  try {
    const raw = await runCommandSilent("docker", [
      "exec", containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    const config = JSON.parse(raw);
    const key = config?.skills?.entries?.nex?.env?.NEX_API_KEY;
    return typeof key === "string" && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Read the current memory-nex plugin apiKey from the container's openclaw.json.
 */
async function readPluginApiKeyFromContainer(containerName: string): Promise<string | null> {
  try {
    const raw = await runCommandSilent("docker", [
      "exec", containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    const config = JSON.parse(raw);
    const key = config?.plugins?.entries?.["memory-nex"]?.config?.apiKey;
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

/**
 * Update the memory-nex plugin config in a container's openclaw.json.
 */
async function updatePluginConfig(containerName: string, nexApiKey: string): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    const raw = await runCommandSilent("docker", [
      "exec", containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    config = JSON.parse(raw);
  } catch {
    // Config may not exist — create from scratch
  }

  const plugins = (config.plugins || {}) as Record<string, unknown>;
  const load = (plugins.load || {}) as Record<string, unknown>;
  load.paths = ["/plugins/memory-nex"];
  plugins.load = load;

  const slots = (plugins.slots || {}) as Record<string, unknown>;
  slots.memory = "memory-nex";
  plugins.slots = slots;

  const entries = (plugins.entries || {}) as Record<string, unknown>;
  entries["memory-nex"] = {
    enabled: true,
    config: {
      apiKey: nexApiKey,
      baseUrl: "http://api:8080",
    },
  };
  plugins.entries = entries;
  config.plugins = plugins;

  const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-plugin-"));
  try {
    const configPath = join(tmpDir, "openclaw.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await runCommand("docker", [
      "cp", configPath, `${containerName}:${OPENCLAW_CONFIG_PATH}`,
    ]);
    await runCommand("docker", [
      "exec", "-u", "root", containerName,
      "chown", "node:node", OPENCLAW_CONFIG_PATH,
    ]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Reload gateway config
  try {
    await runCommandSilent("docker", [
      "exec", containerName,
      "node", "/app/openclaw.mjs", "gateway", "reload",
    ]);
  } catch {
    // Non-fatal
  }
}

/**
 * Check all running containers and sync memory-nex plugin config
 * with the Nex API key the agent registered.
 */
async function syncPluginConfigs(): Promise<void> {
  let synced = 0;

  for (const instance of instances.values()) {
    if (instance.status !== "running") continue;

    try {
      // Read the Nex API key from the container (set by agent registration)
      const nexApiKey = await readNexApiKeyFromContainer(instance.containerName);
      if (!nexApiKey) continue;

      // Store on instance for use in future gateway config writes
      if (instance.nexApiKey !== nexApiKey) {
        instance.nexApiKey = nexApiKey;
      }

      // Check if plugin config already has the correct key
      const currentPluginKey = await readPluginApiKeyFromContainer(instance.containerName);
      if (currentPluginKey === nexApiKey) continue;

      // Key mismatch or plugin not configured — push updated config
      await updatePluginConfig(instance.containerName, nexApiKey);
      synced++;
      console.log(`[nex-plugin-updater] Synced memory-nex plugin config for ${instance.containerName}`);
    } catch (err) {
      console.error(`[nex-plugin-updater] Failed to sync ${instance.containerName}:`, err);
    }
  }

  if (synced > 0) {
    console.log(`[nex-plugin-updater] Updated plugin config in ${synced} container(s)`);
  }
}

/**
 * Start the 5-minute background plugin config sync loop.
 * First check runs after 90s delay to let instances stabilize.
 */
export function startNexPluginUpdater(): void {
  if (intervalTimer) return;

  console.log("[nex-plugin-updater] Starting background updater (5m interval, first check in 90s)");

  const startupTimer = setTimeout(() => {
    syncPluginConfigs().catch((err) =>
      console.error("[nex-plugin-updater] Initial sync failed:", err),
    );
  }, INITIAL_DELAY);
  if (startupTimer && typeof startupTimer === "object" && "unref" in startupTimer) {
    startupTimer.unref();
  }

  intervalTimer = setInterval(() => {
    syncPluginConfigs().catch((err) =>
      console.error("[nex-plugin-updater] Periodic sync failed:", err),
    );
  }, FIVE_MINUTES);
  if (intervalTimer && typeof intervalTimer === "object" && "unref" in intervalTimer) {
    intervalTimer.unref();
  }
}
