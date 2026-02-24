/**
 * Shared agent persona configuration logic.
 *
 * Extracted from deploy/route.ts so it can be reused for both the
 * "main" agent (at deploy time) and additional agents added later
 * via the /api/instances/[id]/agents endpoint.
 */
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { runCommand, runCommandSilent, type Instance } from "./instances";
import { PERSONA_CONFIGS, type SkillConfig } from "./personas";

const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";

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
    writeFileSync(join(tmpDir, "BOOTSTRAP.md"), config.bootstrap);

    // Skills
    if (config.skills.length > 0) {
      log?.(`Loading ${config.skills.length} skills...`);
      for (const skill of config.skills) {
        const skillDir = join(tmpDir, "skills", skill.name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, "SKILL.md"), buildSkillMd(skill));

        // Write bundled script files (e.g. scripts/nex-api.sh)
        if (skill.files) {
          for (const [relPath, content] of Object.entries(skill.files)) {
            const filePath = join(skillDir, relPath);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, content, { mode: 0o755 });
          }
        }
      }
    }

    // Heartbeat
    if (config.heartbeat) {
      writeFileSync(join(tmpDir, "HEARTBEAT.md"), config.heartbeat);
    }

    // Ensure workspace exists
    await runCommand("docker", [
      "exec", instance.containerName,
      "sh", "-c", `mkdir -p ${wsPath}/memory`,
    ]);

    // Single docker cp: push entire tree into the workspace
    // The trailing "/." copies contents of tmpDir into wsPath (not tmpDir itself)
    await runCommand("docker", [
      "cp", `${tmpDir}/.`, `${instance.containerName}:${wsPath}/`,
    ]);

    // Write memory files only if they don't already exist (preserves agent state)
    const memoryFiles: Record<string, string> = {
      "memory/memory.md": config.memory,
    };
    if (config.heartbeat) {
      memoryFiles["memory/heartbeat-state.json"] = JSON.stringify({
        lastChecks: {},
        notes: "Timestamps are unix epoch. null means never checked.",
      }, null, 2);
    }
    for (const [relPath, content] of Object.entries(memoryFiles)) {
      try {
        await runCommandSilent("docker", [
          "exec", instance.containerName,
          "sh", "-c", `test -f ${wsPath}/${relPath}`,
        ]);
        // File exists — don't overwrite
      } catch {
        // File doesn't exist — write it
        const memTmpDir = mkdtempSync(join(tmpdir(), "clawgent-mem-"));
        try {
          const filePath = join(memTmpDir, "file");
          writeFileSync(filePath, content);
          await runCommand("docker", [
            "cp", filePath, `${instance.containerName}:${wsPath}/${relPath}`,
          ]);
        } finally {
          rmSync(memTmpDir, { recursive: true, force: true });
        }
      }
    }

    if (config.skills.length > 0) {
      log?.(`Skills loaded: ${config.skills.map(s => s.name).join(", ")}`);
    }

    // Heartbeat interval: write directly to openclaw.json instead of
    // spawning `node openclaw.mjs config set` (which OOM-kills in
    // the memory-constrained container when the gateway is already running).
    if (config.heartbeat) {
      try {
        let ocConfig: Record<string, unknown> = {};
        try {
          const raw = await runCommandSilent("docker", [
            "exec", instance.containerName, "cat", OPENCLAW_CONFIG_PATH,
          ]);
          ocConfig = JSON.parse(raw);
        } catch {
          // Config may not exist yet
        }

        const agents = (ocConfig.agents || {}) as Record<string, unknown>;
        const defaults = (agents.defaults || {}) as Record<string, unknown>;
        const heartbeat = (defaults.heartbeat || {}) as Record<string, unknown>;
        heartbeat.every = config.heartbeatInterval;
        defaults.heartbeat = heartbeat;
        agents.defaults = defaults;
        ocConfig.agents = agents;

        const hbTmpDir = mkdtempSync(join(tmpdir(), "clawgent-hb-"));
        try {
          const configPath = join(hbTmpDir, "openclaw.json");
          writeFileSync(configPath, JSON.stringify(ocConfig, null, 2));
          await runCommand("docker", [
            "cp", configPath, `${instance.containerName}:${OPENCLAW_CONFIG_PATH}`,
          ]);
          await runCommand("docker", [
            "exec", "-u", "root", instance.containerName,
            "chown", "node:node", OPENCLAW_CONFIG_PATH,
          ]);
        } finally {
          rmSync(hbTmpDir, { recursive: true, force: true });
        }

        // Reload gateway config
        try {
          await runCommandSilent("docker", [
            "exec", instance.containerName,
            "node", "/app/openclaw.mjs", "gateway", "reload",
          ]);
        } catch {
          // Non-fatal
        }
      } catch {
        log?.("Note: heartbeat interval config skipped (non-critical).");
      }
      log?.(`Heartbeat configured (every ${config.heartbeatInterval}).`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Escape a value for YAML frontmatter (wrap in quotes if it contains special chars). */
function escapeYamlValue(value: string): string {
  // If value contains YAML-special characters, wrap in double quotes and escape internal quotes
  if (/[:#{}[\],&*?|>!%@`"'\n\r]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}

export function buildSkillMd(skill: SkillConfig): string {
  const metadata: Record<string, unknown> = {
    clawdbot: {
      emoji: skill.emoji,
      ...(skill.requires ? { requires: skill.requires } : {}),
      ...(skill.files ? { files: Object.keys(skill.files) } : {}),
    },
  };

  return `---
name: ${escapeYamlValue(skill.name)}
description: ${escapeYamlValue(skill.description)}
metadata: ${JSON.stringify(metadata)}
---

${skill.instructions}`;
}
