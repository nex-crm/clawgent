import { NextRequest, NextResponse } from "next/server";
import { isWorkOSConfigured, DEV_USER_ID } from "@/lib/auth-config";
import { instances, runCommand, runCommandSilent, reconcileWithDocker } from "@/lib/instances";
import { PERSONA_CONFIGS } from "@/lib/personas";
import { configureAgentPersona } from "@/lib/agent-config";

const MAIN_WORKSPACE = "/home/node/.openclaw/workspace";
const AGENTS_BASE = "/home/node/.openclaw/agents";

interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
  workspace: string;
}

/**
 * GET /api/instances/[id]/agents
 * List all agents on a running instance.
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
    const output = await runCommandSilent("docker", [
      "exec", instance.containerName,
      "openclaw", "agents", "list", "--json",
    ]);

    const agents: AgentInfo[] = JSON.parse(output);

    const result = agents.map((agent) => {
      // Try to match the agent to a known persona by name
      const personaId = matchPersonaByName(agent.name);
      const persona = personaId ? PERSONA_CONFIGS[personaId] : null;

      return {
        agentId: agent.id,
        name: agent.name || agent.id,
        emoji: agent.emoji || persona?.emoji || "",
        persona: personaId,
        deepLink: buildDeepLink(id, instance.token, agent.id),
      };
    });

    return NextResponse.json({ agents: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to list agents: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * POST /api/instances/[id]/agents
 * Add a new agent to a running instance.
 *
 * Request body: { "persona": "marketing-pro" } or { "persona": null } for blank agent
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
      { error: "You can only add agents to your own instance" },
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
  const personaId = body.persona as string | null | undefined;

  // Validate persona if provided
  if (personaId && !PERSONA_CONFIGS[personaId]) {
    return NextResponse.json(
      { error: `Unknown persona: ${personaId}. Valid: ${Object.keys(PERSONA_CONFIGS).join(", ")}` },
      { status: 400 },
    );
  }

  const persona = personaId ? PERSONA_CONFIGS[personaId] : null;

  // Agent name: use persona name in kebab-case, or generate a generic name
  const agentName = personaId || `agent-${Date.now().toString(36)}`;
  const wsPath = `${AGENTS_BASE}/${agentName}/workspace`;

  try {
    // Step 1: Create the agent via OpenClaw CLI
    await runCommand("docker", [
      "exec", instance.containerName,
      "openclaw", "agents", "add", agentName,
      "--workspace", wsPath,
      "--non-interactive", "--json",
    ]);

    // Step 2: If persona specified, inject config files into the agent's workspace
    if (personaId && persona) {
      await configureAgentPersona(instance, personaId, wsPath);

      // Step 3: Set agent identity (name + emoji)
      try {
        await runCommand("docker", [
          "exec", instance.containerName,
          "openclaw", "agents", "set-identity",
          "--agent", agentName,
          "--name", persona.name,
          "--emoji", persona.emoji,
        ]);
      } catch {
        // Non-critical: identity can be set manually
      }
    }

    return NextResponse.json({
      agentId: agentName,
      name: persona?.name || agentName,
      emoji: persona?.emoji || "",
      persona: personaId || null,
      deepLink: buildDeepLink(id, instance.token, agentName),
      status: personaId ? "configured" : "created",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Failed to add agent: ${message}` },
      { status: 500 },
    );
  }
}

/**
 * Build a deep link URL for an agent session.
 * Format: /i/{instanceId}/?token={token}&session=agent:{agentId}:main
 */
function buildDeepLink(instanceId: string, token: string, agentId: string): string {
  if (agentId === "main") {
    return `/i/${instanceId}/?token=${token}`;
  }
  return `/i/${instanceId}/?token=${token}&session=agent:${agentId}:main`;
}

/**
 * Try to match an agent's display name back to a PERSONA_CONFIGS key.
 * Returns the persona ID or null if no match.
 */
function matchPersonaByName(agentName: string): string | null {
  // Direct key match (agent ID is the persona key)
  if (PERSONA_CONFIGS[agentName]) return agentName;

  // Match by display name
  for (const [key, config] of Object.entries(PERSONA_CONFIGS)) {
    if (config.name.toLowerCase() === agentName.toLowerCase()) return key;
  }

  return null;
}
