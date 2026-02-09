import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, type Instance, runCommand, runCommandSilent, reconcileWithDocker, findInstanceByUserId } from "@/lib/instances";
import { PERSONA_CONFIGS } from "@/lib/personas";
import { configureAgentPersona } from "@/lib/agent-config";
import { checkRateLimit, incrementUsage } from "@/lib/rate-limit";

const OPENCLAW_IMAGE = "clawgent-openclaw";
const PORT_RANGE_START = 19000;
const CONTAINER_PREFIX = "clawgent-";

const PROVIDER_CONFIG: Record<string, { envVar: string; modelId: string }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY", modelId: "anthropic/claude-sonnet-4-5" },
  google:    { envVar: "GEMINI_API_KEY",    modelId: "google/gemini-3-flash-preview" },
  openai:    { envVar: "OPENAI_API_KEY",    modelId: "openai/gpt-5.2" },
  nex:       { envVar: "GEMINI_API_KEY",    modelId: "google/gemini-2.5-flash" },
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

    // Determine the actual API key and any extra env vars for the container
    let resolvedApiKey: string;
    const extraEnvVars: Record<string, string> = {};

    if (provider === "nex") {
      // Free Nex tier: use shared server-side Gemini key, enforce rate limit
      const sharedGeminiKey = process.env.NEX_SHARED_GEMINI_KEY;
      if (!sharedGeminiKey) {
        return NextResponse.json(
          { error: "Free tier is not configured on this server" },
          { status: 503 },
        );
      }

      const { allowed, remaining } = checkRateLimit(userId);
      if (!allowed) {
        return NextResponse.json(
          { error: "Daily free tier limit reached (200 calls/day). Try again tomorrow or use your own API key.", remaining },
          { status: 429 },
        );
      }

      incrementUsage(userId, new Date().toISOString().split("T")[0]);
      resolvedApiKey = sharedGeminiKey;
    } else {
      // BYOK providers require an API key
      if (!apiKey) {
        return NextResponse.json(
          { error: "apiKey is required for this provider" },
          { status: 400 },
        );
      }
      resolvedApiKey = apiKey;
    }

    // Allocate a unique port
    const port = await allocatePort();
    const token = randomBytes(16).toString("hex");
    const id = randomBytes(4).toString("hex");
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
    deployInstance(instance, volumeName, config.envVar, resolvedApiKey, config.modelId, extraEnvVars).catch((err) => {
      instance.status = "error";
      addLog(instance, `Fatal error: ${err.message}`);
    });

    return NextResponse.json({
      id: instance.id,
      status: instance.status,
      message: `Deployment started. Poll GET /api/instances/${id} for progress.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  await reconcileWithDocker();

  const list = Array.from(instances.values()).map((inst) => ({
    id: inst.id,
    status: inst.status,
    port: inst.port,
    dashboardUrl: inst.dashboardUrl,
    createdAt: inst.createdAt,
    persona: inst.persona,
  }));

  return NextResponse.json({ instances: list });
}

function addLog(instance: Instance, message: string) {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  instance.logs.push(`[${timestamp}] ${message}`);
}

async function deployInstance(
  instance: Instance,
  volumeName: string,
  apiKeyEnvVar: string,
  apiKey: string,
  modelId: string,
  extraEnvVars: Record<string, string> = {},
) {
  try {
    // Step 1: Pull image if needed
    addLog(instance, `Image: ${OPENCLAW_IMAGE} (pre-built, no pulling required)`);
    addLog(instance, `Model: ${modelId} (the brains of the operation)`);

    // Step 2: Create and start container
    addLog(instance, `Starting instance on port ${instance.port}... (it gets its own sandbox, very fancy)`);
    const isNexProvider = instance.provider === "nex";
    const dockerArgs = [
      "run", "-d",
      "--name", instance.containerName,
      "-p", `${instance.port}:18789`,
      "-v", `${volumeName}:/home/node/.openclaw`,
      "-e", `OPENCLAW_GATEWAY_TOKEN=${instance.token}`,
      "-e", "PORT=18789",
    ];
    // For BYOK providers, inject API key as env var (user's own key, they know it)
    // For nex (free tier), key is injected into openclaw.json after boot to hide from `env`
    if (!isNexProvider) {
      dockerArgs.push("-e", `${apiKeyEnvVar}=${apiKey}`);
    }
    for (const [key, value] of Object.entries(extraEnvVars)) {
      dockerArgs.push("-e", `${key}=${value}`);
    }
    dockerArgs.push(
      "--restart", "unless-stopped",
      OPENCLAW_IMAGE,
      "bash", "-lc",
      "openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan",
    );
    await runCommand("docker", dockerArgs);
    addLog(instance, "Instance is up. Now we wait for it to get its act together.");

    // Step 3: Wait for gateway to become healthy
    addLog(instance, "Waiting for the instance gateway to respond... (it's booting, not ghosting you)");
    const healthy = await waitForHealth(instance, 60);

    if (healthy) {
      // Step 4a: For free tier, inject API key into openclaw.json (not env vars, so `env` can't expose it)
      if (isNexProvider) {
        addLog(instance, "Injecting API key into instance config... (hidden from env)");
        try {
          const configPath = "/home/node/.openclaw/openclaw.json";
          // Read existing config (may not exist yet)
          let existingConfig: Record<string, unknown> = {};
          try {
            const raw = await runCommandSilent("docker", [
              "exec", instance.containerName, "cat", configPath,
            ]);
            existingConfig = JSON.parse(raw);
          } catch {
            // Config file doesn't exist yet — start fresh
          }
          // Merge the Gemini API key into the config
          const keys = (existingConfig.keys || {}) as Record<string, string>;
          keys[apiKeyEnvVar] = apiKey;
          existingConfig.keys = keys;
          // Write back
          const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-cfg-"));
          try {
            const localConfigPath = join(tmpDir, "openclaw.json");
            writeFileSync(localConfigPath, JSON.stringify(existingConfig, null, 2));
            await runCommand("docker", [
              "cp", localConfigPath, `${instance.containerName}:${configPath}`,
            ]);
          } finally {
            rmSync(tmpDir, { recursive: true, force: true });
          }
          addLog(instance, "API key configured securely.");
        } catch (cfgErr) {
          const msg = cfgErr instanceof Error ? cfgErr.message : String(cfgErr);
          addLog(instance, `Warning: failed to inject API key into config (${msg}).`);
        }
      }

      // Step 4b: Set the default model inside the container
      addLog(instance, `Setting default model to ${modelId}... (plugging in the brain)`);
      try {
        await runCommand("docker", [
          "exec", instance.containerName,
          "openclaw", "models", "set", modelId,
        ]);
        addLog(instance, "Model configured. It can think now.");
      } catch (modelErr) {
        const msg = modelErr instanceof Error ? modelErr.message : String(modelErr);
        addLog(instance, `Warning: failed to set model (${msg}). You may need to set it manually.`);
      }

      // Step 5: Inject agent template configuration (SOUL.md, IDENTITY.md)
      if (instance.persona) {
        addLog(instance, `Configuring agent template: ${instance.persona}... (SOUL.md + IDENTITY.md + skills)`);
        const mainWsPath = "/home/node/.openclaw/workspace";
        await configureAgentPersona(instance, instance.persona, mainWsPath, (msg) => addLog(instance, msg));

        // Set main agent identity
        const personaConfig = PERSONA_CONFIGS[instance.persona];
        if (personaConfig) {
          try {
            await runCommand("docker", [
              "exec", instance.containerName,
              "openclaw", "agents", "set-identity",
              "--agent", "main",
              "--name", personaConfig.name,
              "--emoji", personaConfig.emoji,
            ]);
          } catch {
            addLog(instance, "Note: agent identity command skipped (non-critical).");
          }
        }

        addLog(instance, "Agent template loaded. Your first agent knows who it is and what it does.");
      }

      instance.status = "running";
      instance.dashboardUrl = `/i/${instance.id}/`;
      addLog(instance, `Your instance is live at /i/${instance.id}/ -- go check it out.`);
      addLog(instance, `Auth token: ${instance.token} (auto-applied, you won't need this)`);

      // Start background auto-approver for device pairing requests.
      // OpenClaw requires device pairing even with --allow-unconfigured.
      startPairingAutoApprover(instance);
    } else {
      instance.status = "error";
      addLog(instance, "Instance gateway didn't respond in 60s. That's... not great. Check Docker logs.");

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
    addLog(instance, "Instance not ready yet... retrying in 2s. Patience is a virtue.");
    await new Promise((r) => setTimeout(r, 2000));
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

function startPairingAutoApprover(instance: Instance) {
  const MAX_DURATION = 5 * 60 * 1000; // 5 minutes
  const POLL_INTERVAL = 2000;
  const start = Date.now();

  const interval = setInterval(async () => {
    // Stop if instance was destroyed or timed out
    if (!instances.has(instance.id) || Date.now() - start > MAX_DURATION) {
      clearInterval(interval);
      return;
    }

    try {
      const pendingJson = await runCommandSilent("docker", [
        "exec", instance.containerName,
        "cat", "/home/node/.openclaw/devices/pending.json",
      ]);

      const pending = JSON.parse(pendingJson);
      const requestIds = Object.keys(pending);
      if (requestIds.length === 0) return;

      for (const requestId of requestIds) {
        try {
          await runCommand("docker", [
            "exec", instance.containerName,
            "openclaw", "devices", "approve", requestId,
            "--token", instance.token,
            "--url", "ws://127.0.0.1:18789",
            "--timeout", "5000",
          ]);
          addLog(instance, `Auto-approved device pairing: ${requestId.substring(0, 8)}... (one less popup to click)`);
        } catch {
          // Approval may fail if request already expired or was handled
        }
      }
    } catch {
      // Container may not be ready yet or pending.json doesn't exist
    }
  }, POLL_INTERVAL);
}

async function isPortInUse(port: number): Promise<boolean> {
  try {
    await runCommandSilent("lsof", ["-i", `:${port}`]);
    return true;
  } catch {
    return false;
  }
}
