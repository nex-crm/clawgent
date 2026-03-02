/**
 * Nex plugin config updater.
 *
 * Periodically checks running containers for a Nex API key
 * (written by the agent during registration) and ensures the
 * nex plugin config in openclaw.json stays in sync.
 *
 * Same lifecycle pattern as key-validator.ts / nex-skill-updater.ts:
 *   - 90s startup delay (after skill updater)
 *   - 5-minute recurring interval
 *   - .unref() timers so they don't block process exit
 */

import { writeFileSync, mkdtempSync, rmSync, existsSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { instances, runCommand, runCommandSilent } from "./instances";
import { applyNexPluginConfig } from "./nex-plugin-config";

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
 * Read the current nex plugin apiKey from the container's openclaw.json.
 */
async function readPluginApiKeyFromContainer(containerName: string): Promise<string | null> {
  try {
    const raw = await runCommandSilent("docker", [
      "exec", containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    const config = JSON.parse(raw);
    const key = config?.plugins?.entries?.["nex"]?.config?.apiKey;
    return typeof key === "string" ? key : null;
  } catch {
    return null;
  }
}

/**
 * Update the nex plugin config in a container's openclaw.json.
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

  applyNexPluginConfig(config, nexApiKey);

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
 * Ensure the plugin JS files exist at /plugins/nex inside the container.
 * After an image upgrade the stock OpenClaw image won't have them, so we
 * re-inject from the bundled copy in app/plugins/nex/.
 */
async function ensurePluginFiles(containerName: string): Promise<boolean> {
  // Check if plugin files already exist in the container
  try {
    await runCommandSilent("docker", [
      "exec", containerName, "test", "-f", "/plugins/nex/openclaw.plugin.json",
    ]);
    return false; // Already present
  } catch {
    // Not present — inject
  }

  const pluginSrc = resolve(process.cwd(), "plugins", "nex");
  if (!existsSync(pluginSrc)) {
    return false; // No local plugin bundle available
  }

  await runCommand("docker", [
    "exec", "-u", "root", containerName, "mkdir", "-p", "/plugins/nex",
  ]);
  await runCommand("docker", [
    "cp", `${pluginSrc}/.`, `${containerName}:/plugins/nex/`,
  ]);
  await runCommand("docker", [
    "exec", "-u", "root", containerName, "chown", "-R", "node:node", "/plugins/nex",
  ]);
  return true;
}

/**
 * Check all running containers and sync nex plugin config
 * with the Nex API key the agent registered.
 */
async function syncPluginConfigs(): Promise<void> {
  let synced = 0;

  for (const instance of instances.values()) {
    if (instance.status !== "running") continue;

    try {
      // Ensure plugin JS files are present (may be missing after image upgrade)
      try {
        const injected = await ensurePluginFiles(instance.containerName);
        if (injected) {
          console.log(`[nex-plugin-updater] Injected plugin files into ${instance.containerName}`);
        }
      } catch (err) {
        console.warn(`[nex-plugin-updater] Could not inject plugin files into ${instance.containerName}:`, err);
      }

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
      console.log(`[nex-plugin-updater] Synced nex plugin config for ${instance.containerName}`);
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
