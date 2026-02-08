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
    // Ensure workspace directory exists (gateway creates it lazily)
    await runCommand("docker", [
      "exec", instance.containerName, "mkdir", "-p", wsPath,
    ]);

    // --- 1. SOUL.md + IDENTITY.md ---
    writeFileSync(join(tmpDir, "SOUL.md"), config.soul);
    writeFileSync(join(tmpDir, "IDENTITY.md"), config.identity);

    await runCommand("docker", [
      "cp", join(tmpDir, "SOUL.md"), `${instance.containerName}:${wsPath}/SOUL.md`,
    ]);
    await runCommand("docker", [
      "cp", join(tmpDir, "IDENTITY.md"), `${instance.containerName}:${wsPath}/IDENTITY.md`,
    ]);

    // Remove BOOTSTRAP.md so the agent doesn't run the first-run wizard
    await runCommand("docker", [
      "exec", instance.containerName, "rm", "-f", `${wsPath}/BOOTSTRAP.md`,
    ]);

    // --- 2. Skills ---
    if (config.skills.length > 0) {
      log?.(`Loading ${config.skills.length} skills...`);
      for (const skill of config.skills) {
        await installSkill(instance.containerName, tmpDir, wsPath, skill);
      }
      log?.(`Skills loaded: ${config.skills.map(s => s.name).join(", ")}`);
    }

    // --- 3. HEARTBEAT.md + heartbeat interval ---
    if (config.heartbeat) {
      writeFileSync(join(tmpDir, "HEARTBEAT.md"), config.heartbeat);
      await runCommand("docker", [
        "cp", join(tmpDir, "HEARTBEAT.md"), `${instance.containerName}:${wsPath}/HEARTBEAT.md`,
      ]);

      // Set heartbeat interval in openclaw.json via config CLI
      try {
        await runCommand("docker", [
          "exec", instance.containerName,
          "openclaw", "config", "set",
          "agents.defaults.heartbeat.every", config.heartbeatInterval,
        ]);
      } catch {
        log?.("Note: heartbeat interval config skipped (non-critical).");
      }

      // Create memory directory + initial heartbeat-state.json
      await runCommand("docker", [
        "exec", instance.containerName, "mkdir", "-p", `${wsPath}/memory`,
      ]);
      writeFileSync(join(tmpDir, "heartbeat-state.json"), JSON.stringify({
        lastChecks: {},
        notes: "Timestamps are unix epoch. null means never checked.",
      }, null, 2));
      await runCommand("docker", [
        "cp", join(tmpDir, "heartbeat-state.json"),
        `${instance.containerName}:${wsPath}/memory/heartbeat-state.json`,
      ]);

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

async function installSkill(
  containerName: string,
  tmpDir: string,
  wsPath: string,
  skill: SkillConfig,
) {
  const skillDir = join(tmpDir, `skill-${skill.name}`);
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(skillDir, "SKILL.md"), buildSkillMd(skill));

  // Create the skill directory in the container, then copy SKILL.md into it
  await runCommand("docker", [
    "exec", containerName, "mkdir", "-p", `${wsPath}/skills/${skill.name}`,
  ]);
  await runCommand("docker", [
    "cp", join(skillDir, "SKILL.md"),
    `${containerName}:${wsPath}/skills/${skill.name}/SKILL.md`,
  ]);
}
