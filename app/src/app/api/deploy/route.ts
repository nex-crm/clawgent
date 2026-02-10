import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, type Instance, runCommand, runCommandSilent, reconcileWithDocker, findInstanceByUserId, startPairingAutoApprover } from "@/lib/instances";
import { PERSONA_CONFIGS } from "@/lib/personas";
import { configureAgentPersona } from "@/lib/agent-config";
import { getPostHogClient } from "@/lib/posthog-server";

const OPENCLAW_IMAGE = "clawgent-openclaw";
const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const PORT_RANGE_START = 19000;
const CONTAINER_PREFIX = "clawgent-";

const PROVIDER_CONFIG: Record<string, { envVar: string; modelId: string }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY", modelId: "anthropic/claude-sonnet-4-5" },
  google:    { envVar: "GEMINI_API_KEY",    modelId: "google/gemini-3-flash-preview" },
  openai:    { envVar: "OPENAI_API_KEY",    modelId: "openai/gpt-5.2" },
};

export async function POST(request: NextRequest) {
  try {
    // Authenticate the user
    let userId: string;
    if (isWorkOSConfigured) {
      const { withAuth } = await import("@workos-inc/authkit-nextjs");
      const session = await withAuth({ ensureSignedIn: true });
      userId = session.user.id;
    } else {
      // Dev mode: anonymous user
      userId = DEV_USER_ID;
    }

    // Enforce one instance per user
    await reconcileWithDocker();
    const existing = findInstanceByUserId(userId);
    if (existing) {
      return NextResponse.json(
        {
          error: "You already have an instance running. One at a time -- this isn't a server farm.",
          existingInstanceId: existing.id,
          dashboardUrl: existing.dashboardUrl,
        },
        { status: 409 },
      );
    }

    // Global instance cap to prevent resource exhaustion
    const MAX_INSTANCES = 20;
    const runningCount = [...instances.values()].filter(i => i.status === "running" || i.status === "starting").length;
    if (runningCount >= MAX_INSTANCES) {
      return NextResponse.json(
        { error: "Platform capacity reached. Please try again later." },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const provider = body.provider as string | undefined;
    const apiKey = body.apiKey as string | undefined;
    const persona = body.persona as string | undefined;

    if (!provider) {
      return NextResponse.json(
        { error: "provider is required" },
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

    // BYOK providers require an API key
    if (!apiKey) {
      return NextResponse.json(
        { error: "apiKey is required for this provider" },
        { status: 400 },
      );
    }

    // Allocate a unique port
    const port = await allocatePort();
    const token = randomBytes(16).toString("hex");
    const id = randomBytes(12).toString("hex");
    const containerName = `${CONTAINER_PREFIX}${id}`;
    const volumeName = `${CONTAINER_PREFIX}data-${id}`;

    const now = new Date();
    const instance: Instance = {
      id,
      containerName,
      port,
      token,
      status: "starting",
      dashboardUrl: null,
      createdAt: now.toISOString(),
      logs: [],
      provider,
      modelId: config.modelId,
      persona,
      userId,
    };

    instances.set(id, instance);

    addLog(instance, "Spinning up a fresh OpenClaw instance. One sec.");
    if (persona) addLog(instance, `Pre-loading agent template: ${persona}. Skills included.`);

    // Run deployment asynchronously
    deployInstance(instance, volumeName, config.envVar, apiKey, config.modelId).catch((err) => {
      instance.status = "error";
      addLog(instance, `Fatal error: ${err.message}`);
    });

    return NextResponse.json({
      id: instance.id,
      status: instance.status,
      message: `Deployment started. Poll GET /api/instances/${id} for progress.`,
    });
  } catch (err) {
    const message = sanitizeMessage(err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


/** Strip known API key patterns from error messages (defense-in-depth). */
function sanitizeMessage(msg: string): string {
  return msg
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}/g, "sk-ant-***")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "sk-***")
    .replace(/\bAIza[A-Za-z0-9_-]{30,}/g, "AIza***")
    .replace(/\bkey-[A-Za-z0-9_-]{20,}/g, "key-***");
}

function addLog(instance: Instance, message: string) {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  instance.logs.push(`[${timestamp}] ${sanitizeMessage(message)}`);
}

async function deployInstance(
  instance: Instance,
  volumeName: string,
  apiKeyEnvVar: string,
  apiKey: string,
  modelId: string,
) {
  try {
    // Step 1: Pull image if needed
    addLog(instance, `Image: ${OPENCLAW_IMAGE} (pre-built, no pulling required)`);
    addLog(instance, `Model: ${modelId} (the brains of the operation)`);

    // Step 2: Create and start container
    addLog(instance, `Starting instance on port ${instance.port}... (it gets its own sandbox, very fancy)`);
    const dockerArgs = [
      "run", "-d",
      "--name", instance.containerName,
      "--pids-limit", "256",
      "--memory", "1536m",
      "--memory-swap", "1536m",
      "--cpus", "1",
      "-p", `127.0.0.1:${instance.port}:18789`,
      "-v", `${volumeName}:/home/node/.openclaw`,
      "-e", `OPENCLAW_GATEWAY_TOKEN=${instance.token}`,
      "-e", "PORT=18789",
      "-e", `${apiKeyEnvVar}=${apiKey}`,
      "-e", "NODE_OPTIONS=--max-old-space-size=1024",
    ];
    dockerArgs.push(
      "--restart", "unless-stopped",
      OPENCLAW_IMAGE,
      "node", "openclaw.mjs", "gateway",
      "--port", "18789", "--allow-unconfigured", "--bind", "lan",
    );
    await runCommand("docker", dockerArgs);

    // Fix volume ownership: Docker volumes are created as root,
    // but the official OpenClaw image runs as `node` (uid 1000).
    try {
      await runCommand("docker", [
        "exec", "-u", "root", instance.containerName,
        "chown", "-R", "node:node", "/home/node/.openclaw",
      ]);
    } catch {
      // Non-fatal: gateway may still work, but canvas/cron could fail
    }

    addLog(instance, "Instance is up. Now we wait for it to get its act together.");

    // Step 3: Wait for gateway to become healthy
    addLog(instance, "Waiting for the instance gateway to respond... (it's booting, not ghosting you)");
    const healthy = await waitForHealth(instance, 60);

    if (healthy) {
      // Run gateway config, model set, and persona injection in parallel
      addLog(instance, "Configuring instance (gateway + model + agent template)...");

      const tasks: Promise<void>[] = [
        // Gateway config: trustedProxies + allowedOrigins
        injectGatewayConfig(instance).catch(() => {
          addLog(instance, "Warning: gateway config injection failed (non-critical).");
        }),

        // Set default model
        runCommand("docker", [
          "exec", instance.containerName,
          "node", "/app/openclaw.mjs", "models", "set", modelId,
        ]).then(() => {
          addLog(instance, `Model set: ${modelId}`);
        }).catch((modelErr) => {
          const msg = modelErr instanceof Error ? modelErr.message : String(modelErr);
          addLog(instance, `Warning: failed to set model (${msg}).`);
        }),
      ];

      // Persona injection (files + skills)
      if (instance.persona) {
        const mainWsPath = "/home/node/.openclaw/workspace";
        tasks.push(
          configureAgentPersona(instance, instance.persona, mainWsPath, (msg) => addLog(instance, msg))
            .then(async () => {
              // Set agent identity (depends on persona injection finishing)
              const personaConfig = PERSONA_CONFIGS[instance.persona!];
              if (personaConfig) {
                try {
                  await runCommand("docker", [
                    "exec", instance.containerName,
                    "node", "/app/openclaw.mjs", "agents", "set-identity",
                    "--agent", "main",
                    "--name", personaConfig.name,
                    "--emoji", personaConfig.emoji,
                  ]);
                } catch {
                  addLog(instance, "Note: agent identity command skipped (non-critical).");
                }
              }
              addLog(instance, "Agent template loaded.");
            })
        );
      }

      await Promise.all(tasks);

      instance.status = "running";
      instance.dashboardUrl = `/i/${instance.id}/`;
      addLog(instance, `Your instance is live at /i/${instance.id}/ -- go check it out.`);

      // Track successful deployment (server-side)
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: instance.userId ?? 'anonymous',
        event: 'instance_deployed',
        properties: {
          instance_id: instance.id,
          provider: instance.provider,
          model_id: modelId,
          persona: instance.persona ?? null,
          port: instance.port,
        },
      });

      // Start background auto-approver for device pairing requests.
      // OpenClaw requires device pairing even with --allow-unconfigured.
      startPairingAutoApprover(instance);
    } else {
      instance.status = "error";
      addLog(instance, "Instance gateway didn't respond in 60s. That's... not great. Check Docker logs.");

      // Track failed deployment (server-side)
      const posthog = getPostHogClient();
      posthog.capture({
        distinctId: instance.userId ?? 'anonymous',
        event: 'instance_deployment_failed',
        properties: {
          instance_id: instance.id,
          provider: instance.provider,
          model_id: modelId,
          persona: instance.persona ?? null,
          error_reason: 'gateway_timeout',
        },
      });

      // Capture container logs for debugging
      try {
        const logs = await runCommandSilent("docker", [
          "logs", "--tail", "20", instance.containerName,
        ]);
        addLog(instance, `Container logs:\n${logs}`);
      } catch {
        // ignore
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addLog(instance, `Error: ${message}`);
    instance.status = "error";

    // Track failed deployment (server-side)
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: instance.userId ?? 'anonymous',
      event: 'instance_deployment_failed',
      properties: {
        instance_id: instance.id,
        provider: instance.provider,
        model_id: modelId,
        persona: instance.persona ?? null,
        error_reason: 'exception',
        error_message: sanitizeMessage(message),
      },
    });
  }
}

async function waitForHealth(instance: Instance, timeoutSeconds: number): Promise<boolean> {
  const start = Date.now();
  const timeout = timeoutSeconds * 1000;

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${instance.port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  return false;
}

async function allocatePort(): Promise<number> {
  const usedPorts = new Set(
    Array.from(instances.values()).map((i) => i.port)
  );

  for (let port = PORT_RANGE_START; port < PORT_RANGE_START + 100; port++) {
    if (!usedPorts.has(port)) {
      // Also check if port is actually free on the host
      const inUse = await isPortInUse(port);
      if (!inUse) return port;
    }
  }

  throw new Error("No available ports in range");
}

/**
 * Inject gateway config into the OpenClaw container so it accepts
 * WebSocket connections from the Nginx reverse proxy.
 *
 * Without this, the gateway rejects connections with:
 *   "origin not allowed (open the Control UI from the gateway host
 *    or allow it in gateway.controlUi.allowedOrigins)"
 */
async function injectGatewayConfig(instance: Instance): Promise<void> {
  // Read existing config (may have been created by gateway startup)
  let config: Record<string, unknown> = {};
  try {
    const raw = await runCommandSilent("docker", [
      "exec", instance.containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    config = JSON.parse(raw);
  } catch {
    // Config may not exist yet
  }

  // Set gateway config: trust Docker bridge proxy + allow clawgent.ai origin
  const gateway = (config.gateway || {}) as Record<string, unknown>;
  gateway.trustedProxies = ["172.17.0.0/16", "127.0.0.1"];

  const controlUi = (gateway.controlUi || {}) as Record<string, unknown>;
  controlUi.allowedOrigins = [
    "https://clawgent.ai",
    "http://localhost:3001",
  ];
  gateway.controlUi = controlUi;
  config.gateway = gateway;

  // Write config into container
  const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-gw-"));
  try {
    const configPath = join(tmpDir, "openclaw.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await runCommand("docker", [
      "cp", configPath, `${instance.containerName}:${OPENCLAW_CONFIG_PATH}`,
    ]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  // Signal gateway to reload the config via SIGUSR1
  // (the `gateway reload` subcommand doesn't exist in 2026.2.x)
  try {
    await runCommandSilent("docker", [
      "exec", instance.containerName, "kill", "-USR1", "1",
    ]);
  } catch {
    // Non-fatal: gateway will pick up config on next restart
  }
}

async function isPortInUse(port: number): Promise<boolean> {
  try {
    await runCommandSilent("lsof", ["-i", `:${port}`]);
    return true;
  } catch {
    return false;
  }
}
