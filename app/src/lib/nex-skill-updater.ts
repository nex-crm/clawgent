/**
 * Daily Nex skill updater.
 *
 * Fetches the latest SKILL.md from the nex-crm/nex-as-a-skill GitHub repo
 * every 24 hours and pushes it to all running containers.
 *
 * Same lifecycle pattern as key-validator.ts:
 *   - 60s startup delay
 *   - 24h recurring interval
 *   - .unref() timers so they don't block process exit
 */

import { createHash } from "crypto";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { instances, runCommand, runCommandSilent } from "./instances";
import { NEX_SKILL, updateNexSkillInstructions } from "./personas";
import { buildSkillMd } from "./agent-config";

const SKILL_URL = "https://raw.githubusercontent.com/nex-crm/nex-as-a-skill/main/SKILL.md";
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY = 60 * 1000; // 60s after startup
const FETCH_TIMEOUT = 10_000; // 10s

let intervalTimer: ReturnType<typeof setInterval> | null = null;
let lastContentHash: string | null = null;

function md5(data: string): string {
  return createHash("md5").update(data).digest("hex");
}

/**
 * Fetch the latest SKILL.md from GitHub.
 * Returns the raw markdown body or null on failure.
 */
async function fetchSkillMd(): Promise<string | null> {
  try {
    const res = await fetch(SKILL_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
    if (!res.ok) {
      console.warn(`[nex-skill-updater] Fetch failed: HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.warn("[nex-skill-updater] Fetch error:", err);
    return null;
  }
}

/**
 * Push the updated nex SKILL.md into a single running container.
 * Updates both the main agent workspace and any additional agents.
 */
async function pushToContainer(containerName: string, skillMdContent: string): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-nex-"));

  try {
    // Write the skill file
    const skillDir = join(tmpDir, "skills", "nex");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, "SKILL.md"), skillMdContent);

    // 1. Push to main agent workspace
    const mainWs = "/home/node/.openclaw/workspace";
    await runCommand("docker", [
      "exec", containerName, "mkdir", "-p", `${mainWs}/skills/nex`,
    ]);
    await runCommand("docker", [
      "cp", `${join(skillDir, "SKILL.md")}`, `${containerName}:${mainWs}/skills/nex/SKILL.md`,
    ]);

    // 2. Push to additional agents (if any)
    try {
      const agentsJson = await runCommandSilent("docker", [
        "exec", containerName, "node", "/app/openclaw.mjs", "agents", "list", "--json",
      ]);
      const agents = JSON.parse(agentsJson);
      if (Array.isArray(agents)) {
        for (const agent of agents) {
          const agentName = agent.name || agent.id;
          if (!agentName) continue;
          const agentWs = `/home/node/.openclaw/agents/${agentName}/workspace`;
          try {
            await runCommand("docker", [
              "exec", containerName, "mkdir", "-p", `${agentWs}/skills/nex`,
            ]);
            await runCommand("docker", [
              "cp", `${join(skillDir, "SKILL.md")}`, `${containerName}:${agentWs}/skills/nex/SKILL.md`,
            ]);
          } catch {
            // Non-fatal: agent workspace may not exist yet
          }
        }
      }
    } catch {
      // No additional agents or command not available — that's fine
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Fetch latest skill and distribute to all running containers.
 */
async function updateNexSkill(): Promise<void> {
  const rawInstructions = await fetchSkillMd();
  if (!rawInstructions) {
    console.warn("[nex-skill-updater] Skipping update — fetch returned no content");
    return;
  }

  // Check if content actually changed
  const hash = md5(rawInstructions);
  if (hash === lastContentHash) {
    console.log("[nex-skill-updater] SKILL.md unchanged, skipping distribution");
    return;
  }

  lastContentHash = hash;

  // Update in-memory skill across all personas
  updateNexSkillInstructions(rawInstructions);
  console.log("[nex-skill-updater] Updated in-memory NEX_SKILL instructions");

  // Build the full SKILL.md with YAML frontmatter for containers
  const fullSkillMd = buildSkillMd(NEX_SKILL);

  // Push to all running containers
  let updated = 0;
  for (const instance of instances.values()) {
    if (instance.status !== "running") continue;
    try {
      await pushToContainer(instance.containerName, fullSkillMd);
      updated++;
    } catch (err) {
      console.error(`[nex-skill-updater] Failed to update container ${instance.containerName}:`, err);
    }
  }

  if (updated > 0) {
    console.log(`[nex-skill-updater] Distributed updated SKILL.md to ${updated} container(s)`);
  }
}

/**
 * Start the 24-hour background Nex skill update loop.
 * First check runs after 60s delay to let instances stabilize.
 */
export function startNexSkillUpdater(): void {
  if (intervalTimer) return; // Already running

  console.log("[nex-skill-updater] Starting background updater (24h interval, first check in 60s)");

  // Initial check after 60s
  const startupTimer = setTimeout(() => {
    updateNexSkill().catch((err) =>
      console.error("[nex-skill-updater] Initial update failed:", err),
    );
  }, INITIAL_DELAY);
  if (startupTimer && typeof startupTimer === "object" && "unref" in startupTimer) {
    startupTimer.unref();
  }

  // Recurring check every 24h
  intervalTimer = setInterval(() => {
    updateNexSkill().catch((err) =>
      console.error("[nex-skill-updater] Periodic update failed:", err),
    );
  }, TWENTY_FOUR_HOURS);
  if (intervalTimer && typeof intervalTimer === "object" && "unref" in intervalTimer) {
    intervalTimer.unref();
  }
}
