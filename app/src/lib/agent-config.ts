/**
 * Shared agent persona configuration logic.
 *
 * Extracted from deploy/route.ts so it can be reused for both the
 * "main" agent (at deploy time) and additional agents added later
 * via the /api/instances/[id]/agents endpoint.
 */
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCommand, type Instance } from "./instances";
import { PERSONA_CONFIGS, type SkillConfig } from "./personas";

/**
 * Inject persona files (SOUL.md, IDENTITY.md, skills, HEARTBEAT.md)
 * into an OpenClaw agent workspace inside a running container.
 *
 * Builds the full directory tree locally and copies it in a single
 * `docker cp` call to minimize overhead (~1 docker call instead of ~30).
 *
 * @param instance   The running instance (provides containerName for docker exec)
 * @param personaId  Key into PERSONA_CONFIGS
 * @param wsPath     Absolute path inside the container to the agent's workspace
 *                   e.g. "/home/node/.openclaw/workspace" for main agent
 *                   or   "/home/node/.openclaw/agents/<name>/workspace" for additional agents
 * @param log        Optional callback for status logging
 */
export async function configureAgentPersona(
  instance: Instance,
  personaId: string,
  wsPath: string,
  log?: (message: string) => void,
): Promise<void> {
  const config = PERSONA_CONFIGS[personaId];
  if (!config) {
    log?.(`Warning: unknown persona "${personaId}", skipping config.`);
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-"));

  try {
    // Build the full workspace tree locally
    writeFileSync(join(tmpDir, "SOUL.md"), config.soul);
    writeFileSync(join(tmpDir, "IDENTITY.md"), config.identity);

    // Skills
    if (config.skills.length > 0) {
      log?.(`Loading ${config.skills.length} skills...`);
      for (const skill of config.skills) {
        const skillDir = join(tmpDir, "skills", skill.name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, "SKILL.md"), buildSkillMd(skill));
      }
    }

    // Heartbeat
    if (config.heartbeat) {
      writeFileSync(join(tmpDir, "HEARTBEAT.md"), config.heartbeat);
      mkdirSync(join(tmpDir, "memory"), { recursive: true });
      writeFileSync(join(tmpDir, "memory", "heartbeat-state.json"), JSON.stringify({
        lastChecks: {},
        notes: "Timestamps are unix epoch. null means never checked.",
      }, null, 2));
    }

    // Single docker call: ensure workspace exists + remove BOOTSTRAP.md
    await runCommand("docker", [
      "exec", instance.containerName,
      "sh", "-c", `mkdir -p ${wsPath} && rm -f ${wsPath}/BOOTSTRAP.md`,
    ]);

    // Single docker cp: push entire tree into the workspace
    // The trailing "/." copies contents of tmpDir into wsPath (not tmpDir itself)
    await runCommand("docker", [
      "cp", `${tmpDir}/.`, `${instance.containerName}:${wsPath}/`,
    ]);

    if (config.skills.length > 0) {
      log?.(`Skills loaded: ${config.skills.map(s => s.name).join(", ")}`);
    }

    // Heartbeat interval requires a CLI call (can't be file-based)
    if (config.heartbeat) {
      try {
        await runCommand("docker", [
          "exec", instance.containerName,
          "node", "/app/openclaw.mjs", "config", "set",
          "agents.defaults.heartbeat.every", config.heartbeatInterval,
        ]);
      } catch {
        log?.("Note: heartbeat interval config skipped (non-critical).");
      }
      log?.(`Heartbeat configured (every ${config.heartbeatInterval}).`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function buildSkillMd(skill: SkillConfig): string {
  const metadata: Record<string, unknown> = {
    openclaw: {
      emoji: skill.emoji,
      ...(skill.requires ? { requires: skill.requires } : {}),
    },
  };

  return `---
name: ${skill.name}
description: ${skill.description}
metadata: ${JSON.stringify(metadata)}
---

${skill.instructions}`;
}
