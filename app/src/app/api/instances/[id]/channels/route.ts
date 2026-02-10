import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, runCommand, runCommandSilent, reconcileWithDocker } from "@/lib/instances";
import {
  type ChannelType,
  CHANNEL_TYPES,
  validateChannelConfig,
  buildChannelConfig,
} from "@/lib/channels";
import { getPostHogClient } from "@/lib/posthog-server";

const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

/**
 * GET /api/instances/[id]/channels
 * List all configured channels and their status on a running instance.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let instance = instances.get(id);
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.status !== "running") {
    return NextResponse.json(
      { error: `Instance is ${instance.status}, not running` },
      { status: 409 },
    );
  }

  try {
    // Try `openclaw channels status --json` first
    let channelStatuses: Record<string, { connected: boolean; error?: string }> = {};
    try {
      const statusOutput = await runCommandSilent("docker", [
        "exec", instance.containerName,
        "node", "/app/openclaw.mjs", "channels", "status", "--json",
      ]);
      channelStatuses = JSON.parse(statusOutput);
    } catch {
      // channels status may not exist in all versions — fall back to config read
    }

    // Read current config to see which channels are configured
    let configChannels: Record<string, Record<string, unknown>> = {};
    try {
      const configOutput = await runCommandSilent("docker", [
        "exec", instance.containerName,
        "cat", OPENCLAW_CONFIG_PATH,
      ]);
      const fullConfig = JSON.parse(configOutput);
      configChannels = fullConfig.channels || {};
    } catch {
      // Config file may not exist yet
    }

    const channels = CHANNEL_TYPES.map((type) => {
      const channelConfig = configChannels[type];
      const isConfigured = !!channelConfig && channelConfig.enabled !== false;
      const statusInfo = channelStatuses[type];

      let status: "connected" | "disconnected" | "error" = "disconnected";
      let error: string | undefined;

      if (isConfigured) {
        if (statusInfo) {
          status = statusInfo.connected ? "connected" : "error";
          error = statusInfo.error;
        } else {
          // Configured but no status info — assume connected (gateway manages lifecycle)
          status = "connected";
        }
      }

      return {
        type,
        enabled: isConfigured,
        status,
        ...(error ? { error } : {}),
      };
    });

    return NextResponse.json({ channels });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to list channels: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/instances/[id]/channels
 * Connect a new channel to a running instance.
 *
 * Body: { type: "slack"|"telegram"|"discord", config: { botToken: "...", ... } }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Authenticate
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  let instance = instances.get(id);
  if (!instance) {
    await reconcileWithDocker();
    instance = instances.get(id);
  }
  if (!instance) {
    return NextResponse.json({ error: "Instance not found" }, { status: 404 });
  }
  if (instance.userId && instance.userId !== userId) {
    return NextResponse.json(
      { error: "You can only configure channels on your own instance" },
      { status: 403 },
    );
  }
  if (instance.status !== "running") {
    return NextResponse.json(
      { error: `Instance is ${instance.status}, not running` },
      { status: 409 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const channelType = body.type as ChannelType | undefined;
  const channelConfig = body.config as Record<string, string> | undefined;

  if (!channelType || !CHANNEL_TYPES.includes(channelType)) {
    return NextResponse.json(
      { error: `Invalid channel type. Valid: ${CHANNEL_TYPES.join(", ")}` },
      { status: 400 },
    );
  }

  if (!channelConfig || typeof channelConfig !== "object") {
    return NextResponse.json(
      { error: "Missing config object" },
      { status: 400 },
    );
  }

  // Validate required credentials
  const validationError = validateChannelConfig(channelType, channelConfig);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  try {
    // Read existing config
    let fullConfig: Record<string, unknown> = {};
    try {
      const configOutput = await runCommandSilent("docker", [
        "exec", instance.containerName,
        "cat", OPENCLAW_CONFIG_PATH,
      ]);
      fullConfig = JSON.parse(configOutput);
    } catch {
      // Config file may not exist yet — start fresh
    }

    // Merge channel config
    const channels = (fullConfig.channels || {}) as Record<string, unknown>;
    channels[channelType] = buildChannelConfig(channelType, channelConfig);
    fullConfig.channels = channels;

    // Write updated config back to container
    const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-ch-"));
    try {
      const configPath = join(tmpDir, "openclaw.json");
      writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));

      await runCommand("docker", [
        "cp", configPath, `${instance.containerName}:${OPENCLAW_CONFIG_PATH}`,
      ]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }

    // Signal the gateway to reload config via SIGUSR1
    try {
      await runCommandSilent("docker", [
        "exec", instance.containerName, "kill", "-USR1", "1",
      ]);
    } catch {
      // Non-fatal: gateway will pick up config on next restart
    }

    // Track channel connected (server-side)
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: userId,
      event: 'channel_connected',
      properties: {
        instance_id: id,
        channel_type: channelType,
      },
    });

    return NextResponse.json({
      type: channelType,
      enabled: true,
      status: "connected" as const,
      message: `${channelType} channel configured. The gateway will connect shortly.`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to configure ${channelType}: ${message}` },
      { status: 500 },
    );
  }
}
