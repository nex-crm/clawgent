/**
 * Shared Nex plugin configuration builder for OpenClaw containers.
 * Used by deploy route, WhatsApp handler, and nex-plugin-updater.
 */

const NEX_PLUGIN_PATH = "/plugins/nex";
const NEX_PLUGIN_ID = "nex";
const NEX_INTERNAL_BASE_URL = "http://api:8080";

/**
 * Apply Nex memory plugin configuration to an OpenClaw config object.
 * Mutates the config in place — sets load paths, memory slot, and plugin entry.
 *
 * No-op if nexApiKey is falsy (plugin is skipped during initial deploy
 * before the key is obtained — nex-plugin-updater handles it later).
 */
export function applyNexPluginConfig(
  config: Record<string, unknown>,
  nexApiKey: string | undefined,
): void {
  const plugins = (config.plugins || {}) as Record<string, unknown>;

  if (nexApiKey) {
    const load = (plugins.load || {}) as Record<string, unknown>;
    load.paths = [NEX_PLUGIN_PATH];
    plugins.load = load;

    const slots = (plugins.slots || {}) as Record<string, unknown>;
    slots.memory = NEX_PLUGIN_ID;
    plugins.slots = slots;

    const entries = (plugins.entries || {}) as Record<string, unknown>;
    entries[NEX_PLUGIN_ID] = {
      enabled: true,
      config: {
        apiKey: nexApiKey,
        baseUrl: NEX_INTERNAL_BASE_URL,
      },
    };
    plugins.entries = entries;
  }

  config.plugins = plugins;
}
