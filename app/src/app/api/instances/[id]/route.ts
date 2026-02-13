import { NextResponse } from "next/server";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, destroyInstance, reconcileWithDocker, runCommand, runCommandSilent, startPairingAutoApprover } from "@/lib/instances";
import { getPostHogClient } from "@/lib/posthog-server";
import { dbGetLinkedByWebUser, dbGetWaSession, dbUpsertWaSession, dbDeleteLinkedByPhone } from "@/lib/db";
import { sendPlivoMessage } from "@/lib/whatsapp";
import { stopInstanceListener, startInstanceListener } from "@/lib/instance-listener";
import { validateInstanceKey, clearKeyStatus } from "@/lib/key-validator";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate the user
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  const { id } = await params;
  let instance = instances.get(id);

  // If not found in memory/DB, try reconciling with Docker first
  // (only reconciles running containers to avoid race conditions with destroyed instances)
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Only allow the owner to view their instance details
  if (instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only view your own instances" },
      { status: 403 },
    );
  }

  return NextResponse.json({
    id: instance.id,
    status: instance.status,
    dashboardUrl: instance.dashboardUrl,
    createdAt: instance.createdAt,
    logs: instance.logs,
    provider: instance.provider,
    modelId: instance.modelId,
    persona: instance.persona,
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate the user
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  const { id } = await params;
  const instance = instances.get(id);

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  // Only allow the owner to destroy their instance
  if (instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only destroy your own instances" },
      { status: 403 },
    );
  }

  try {
    // Capture instance info before destroying
    const provider = instance.provider;
    const persona = instance.persona;
    const createdAt = instance.createdAt;

    stopInstanceListener(id);
    await destroyInstance(id);

    // Notify linked WhatsApp user and clean up session (non-fatal)
    try {
      const linked = dbGetLinkedByWebUser(userId);
      if (linked) {
        const waSession = dbGetWaSession(linked.wa_phone);
        if (waSession && waSession.instanceId === id) {
          dbUpsertWaSession({
            ...waSession,
            currentState: "PERSONA_SELECT",
            instanceId: null,
            activeAgent: null,
            selectedPersona: null,
            selectedProvider: null,
            updatedAt: new Date().toISOString(),
          });
          await sendPlivoMessage(
            linked.wa_phone,
            "your instance was shut down from the web dashboard. send any message to start a new one."
          );
        }
        dbDeleteLinkedByPhone(linked.wa_phone);
        console.log(`[api] unlinked WA phone ${linked.wa_phone} after web destroy of instance ${id}`);
      }
    } catch (waErr) {
      console.error(`[api] non-fatal: WA notification failed for instance ${id}:`, waErr);
    }

    // Track instance destroyed (server-side)
    const posthog = getPostHogClient();
    posthog?.capture({
      distinctId: userId,
      event: 'instance_destroyed',
      properties: {
        source: "web",
        instance_id: id,
        provider: provider,
        persona: persona ?? null,
        created_at: createdAt,
      },
    });

    return NextResponse.json({ message: "Instance destroyed", id });
  } catch (err) {
    console.error(`[api] Error destroying instance ${id}:`, err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Provider / API Key Change ──────────────────────────────────────
// Stops the container, removes it (volume persists), recreates with new env.

const PROVIDER_CONFIG: Record<string, { envVar: string; modelId: string }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY", modelId: "anthropic/claude-sonnet-4-5" },
  google:    { envVar: "GEMINI_API_KEY",    modelId: "google/gemini-3-flash-preview" },
  openai:    { envVar: "OPENAI_API_KEY",    modelId: "openai/gpt-5.2" },
};

const OPENCLAW_IMAGE = "clawgent-openclaw";
const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticate the user
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  const { id } = await params;
  const instance = instances.get(id);

  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }

  if (instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only modify your own instances" },
      { status: 403 },
    );
  }

  // Parse body
  let body: { provider?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { provider, apiKey } = body;

  if (!provider || !apiKey) {
    return NextResponse.json(
      { error: "provider and apiKey are required" },
      { status: 400 },
    );
  }

  const config = PROVIDER_CONFIG[provider];
  if (!config) {
    return NextResponse.json(
      { error: `Unknown provider: ${provider}. Valid: ${Object.keys(PROVIDER_CONFIG).join(", ")}` },
      { status: 400 },
    );
  }

  // Basic API key prefix validation
  const prefixValid =
    (provider === "anthropic" && apiKey.startsWith("sk-ant-")) ||
    (provider === "google" && apiKey.startsWith("AIza")) ||
    (provider === "openai" && apiKey.startsWith("sk-"));
  if (!prefixValid) {
    return NextResponse.json(
      { error: `Invalid API key format for ${provider}` },
      { status: 400 },
    );
  }

  try {
    console.log(`[patch] Starting provider change for instance ${id}: ${instance.provider} → ${provider}`);

    // 1. Stop WA listener
    stopInstanceListener(id);

    // 2. Stop + remove container (volume persists)
    try {
      await runCommandSilent("docker", ["stop", instance.containerName]);
    } catch { /* may already be stopped */ }
    try {
      await runCommandSilent("docker", ["rm", "-f", instance.containerName]);
    } catch { /* may already be removed */ }

    // 3. Update instance state
    instance.status = "starting";
    instance.provider = provider;
    instance.modelId = config.modelId;
    instances.set(id, instance);

    // 4. Recreate container with same name/port/token/volume but new API key
    const volumeName = `clawgent-data-${id}`;
    const dockerArgs = [
      "run", "-d",
      "--name", instance.containerName,
      "--pids-limit", "256",
      "--memory", "1024m",
      "--memory-reservation", "768m",
      "--memory-swap", "1024m",
      "--cpus", "0.5",
      "--cap-drop", "SYS_ADMIN",
      "--cap-drop", "NET_ADMIN",
      "--cap-drop", "NET_RAW",
      "--cap-drop", "SYS_PTRACE",
      "--cap-drop", "MKNOD",
      "--cap-drop", "AUDIT_WRITE",
      "--cap-drop", "SYS_MODULE",
      "--cap-drop", "DAC_READ_SEARCH",
      "--cap-drop", "LINUX_IMMUTABLE",
      "--cap-drop", "SYS_RAWIO",
      "--cap-drop", "SYS_BOOT",
      "--security-opt", "no-new-privileges",
      "-p", `127.0.0.1:${instance.port}:18789`,
      "-v", `${volumeName}:/home/node/.openclaw`,
      "-e", `OPENCLAW_GATEWAY_TOKEN=${instance.token}`,
      "-e", "PORT=18789",
      "-e", `${config.envVar}=${apiKey}`,
      "-e", "NODE_OPTIONS=--max-old-space-size=768",
      "--restart", "unless-stopped",
      OPENCLAW_IMAGE,
      "node", "openclaw.mjs", "gateway",
      "--port", "18789", "--allow-unconfigured", "--bind", "lan",
    ];
    await runCommand("docker", dockerArgs);

    // 5. Fix volume ownership
    try {
      await runCommand("docker", [
        "exec", "-u", "root", instance.containerName,
        "chown", "-R", "node:node", "/home/node/.openclaw",
      ]);
    } catch { /* non-fatal */ }

    // 6. Wait for health (30s — config already on volume, faster than fresh)
    const healthy = await waitForHealth(instance.port, 180);
    if (!healthy) {
      instance.status = "error";
      instances.set(id, instance);
      return NextResponse.json(
        { error: "Instance failed to start after provider change" },
        { status: 500 },
      );
    }

    // 7. Update model in openclaw.json
    try {
      await injectModelConfig(instance.containerName, config.modelId);
    } catch (err) {
      console.error(`[patch] Model config injection failed for instance ${id}:`, err);
      // Non-fatal — gateway may still work with previous model config
    }

    // 8. Mark running
    instance.status = "running";
    instance.dashboardUrl = `/i/${id}/`;
    instances.set(id, instance);

    // 9. Clear old key status and validate new key
    clearKeyStatus(id);
    validateInstanceKey(id).catch((err) =>
      console.error(`[patch] Key validation after change failed for ${id}:`, err),
    );

    // 10. Restart pairing auto-approver + WA listener
    startPairingAutoApprover(instance);
    try {
      const linked = instance.userId ? dbGetLinkedByWebUser(instance.userId) : undefined;
      if (linked) {
        startInstanceListener(instance.id, instance.port, instance.token, linked.wa_phone);
        const providerLabel = PROVIDER_CONFIG[provider]
          ? provider.charAt(0).toUpperCase() + provider.slice(1)
          : provider;
        await sendPlivoMessage(
          linked.wa_phone,
          `your agent switched to ${providerLabel}. it's back online and ready to go.`,
        );
      }
    } catch (waErr) {
      console.error(`[patch] Non-fatal: WA notification failed for instance ${id}:`, waErr);
    }

    // Track provider change (server-side)
    const posthog = getPostHogClient();
    posthog?.capture({
      distinctId: userId,
      event: "instance_provider_changed",
      properties: {
        source: "web",
        instance_id: id,
        old_provider: instance.provider,
        new_provider: provider,
        new_model_id: config.modelId,
      },
    });

    console.log(`[patch] Provider change complete for instance ${id}: now ${provider}`);

    return NextResponse.json({
      id: instance.id,
      status: instance.status,
      provider: instance.provider,
      modelId: instance.modelId,
    });
  } catch (err) {
    console.error(`[patch] Error changing provider for instance ${id}:`, err);
    instance.status = "error";
    instances.set(id, instance);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function waitForHealth(port: number, timeoutSeconds: number): Promise<boolean> {
  const start = Date.now();
  const timeout = timeoutSeconds * 1000;
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function injectModelConfig(containerName: string, modelId: string): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    const raw = await runCommandSilent("docker", [
      "exec", containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    config = JSON.parse(raw);
  } catch { /* config may not exist yet */ }

  // Set default model at agents.defaults.model.primary
  const agents = (config.agents || {}) as Record<string, unknown>;
  const defaults = (agents.defaults || {}) as Record<string, unknown>;
  const model = (defaults.model || {}) as Record<string, unknown>;
  model.primary = modelId;
  defaults.model = model;
  agents.defaults = defaults;
  config.agents = agents;

  const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-patch-"));
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

  // Reload gateway
  try {
    await runCommandSilent("docker", [
      "exec", containerName,
      "node", "/app/openclaw.mjs", "gateway", "reload",
    ]);
  } catch { /* non-fatal */ }
}
