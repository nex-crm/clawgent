import { NextResponse } from "next/server";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, runCommand, runCommandSilent, reconcileWithDocker } from "@/lib/instances";
import { type ChannelType, CHANNEL_TYPES } from "@/lib/channels";
import { getPostHogClient } from "@/lib/posthog-server";

const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

/**
 * DELETE /api/instances/[id]/channels/[channelType]
 * Disconnect a channel from a running instance.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; channelType: string }> },
) {
  const { id, channelType } = await params;

  // Authenticate
  let userId: string;
  if (isWorkOSConfigured) {
    const { withAuth } = await import("@workos-inc/authkit-nextjs");
    const session = await withAuth({ ensureSignedIn: true });
    userId = session.user.id;
  } else {
    userId = DEV_USER_ID;
  }

  if (!CHANNEL_TYPES.includes(channelType as ChannelType)) {
    return NextResponse.json(
      { error: `Invalid channel type: ${channelType}. Valid: ${CHANNEL_TYPES.join(", ")}` },
      { status: 400 },
    );
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
      return NextResponse.json(
        { error: `Channel ${channelType} is not configured` },
        { status: 404 },
      );
    }

    const channels = (fullConfig.channels || {}) as Record<string, unknown>;
    if (!channels[channelType]) {
      return NextResponse.json(
        { error: `Channel ${channelType} is not configured` },
        { status: 404 },
      );
    }

    // Remove the channel from config
    delete channels[channelType];
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

    // Try CLI logout for clean disconnect
    try {
      await runCommandSilent("docker", [
        "exec", instance.containerName,
        "node", "/app/openclaw.mjs", "channels", "logout", "--channel", channelType, "--force",
      ]);
    } catch {
      // logout may not be available — config removal is sufficient
    }

    // Signal gateway to reload via SIGUSR1
    try {
      await runCommandSilent("docker", [
        "exec", instance.containerName, "kill", "-USR1", "1",
      ]);
    } catch {
      // Non-fatal: gateway will pick up config on next restart
    }

    // Track channel disconnected (server-side)
    const posthog = getPostHogClient();
    posthog?.capture({
      distinctId: userId,
      event: 'channel_disconnected',
      properties: {
        instance_id: id,
        channel_type: channelType,
      },
    });

    return NextResponse.json({
      type: channelType,
      enabled: false,
      status: "disconnected" as const,
      message: `${channelType} channel disconnected.`,
    });
  } catch (err) {
    console.error(`[api] Error disconnecting channel ${channelType} for instance ${id}:`, err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
