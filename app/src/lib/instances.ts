import { spawn } from "child_process";
import {
  dbGetInstance,
  dbGetAllInstances,
  dbUpsertInstance,
  dbDeleteInstance,
  dbCount,
  dbGetAllIds,
  dbGetInstanceByUserIdActive,
  dbGetInstanceByTokenActive,
  dbGetOrphanedInstances,
  dbDeleteOldStaleInstances,
  dbGetLinkedByWebUser,
  dbGetLinkedByPhone,
} from "./db";

export interface Instance {
  id: string;
  containerName: string;
  port: number;
  token: string;
  status: "starting" | "running" | "stopped" | "error";
  dashboardUrl: string | null;
  createdAt: string;
  logs: string[];
  provider?: string;
  modelId?: string;
  persona?: string;
  userId?: string;
}

/**
 * SQLite-backed Map that presents the same interface as the old
 * globalThis Map<string, Instance>.
 *
 * Design:
 * - An in-memory cache holds instances that are being actively
 *   mutated (e.g. during deployment when logs are appended and
 *   status changes). This avoids serializing to SQLite on every
 *   single log line.
 * - `get()` checks in-memory cache first, then SQLite.
 * - `set()` writes to both cache and SQLite.
 * - `delete()` removes from both.
 * - A periodic flush (every 5s) persists dirty in-memory instances
 *   to SQLite so mutations (status changes, log appends) are saved.
 * - `values()`, `keys()`, `size` always read from SQLite for
 *   consistency (the authoritative store).
 */
class InstanceStore {
  private cache = new Map<string, Instance>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Hydrate cache from SQLite on startup so active instances are
    // immediately available (e.g. for server.ts resolveInstance)
    for (const inst of dbGetAllInstances()) {
      this.cache.set(inst.id, inst);
    }

    // Periodic flush: persist dirty in-memory instances to SQLite
    this.flushTimer = setInterval(() => this.flush(), 5000);
    // Don't block process exit
    if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  get(id: string): Instance | undefined {
    // Check in-memory cache first (active deployments)
    const cached = this.cache.get(id);
    if (cached) return cached;

    // Fall back to SQLite
    const fromDb = dbGetInstance(id);
    if (fromDb) {
      this.cache.set(fromDb.id, fromDb);
    }
    return fromDb;
  }

  set(id: string, instance: Instance): this {
    this.cache.set(id, instance);
    dbUpsertInstance(instance);
    return this;
  }

  has(id: string): boolean {
    return this.cache.has(id) || dbGetInstance(id) !== undefined;
  }

  delete(id: string): boolean {
    this.cache.delete(id);
    dbDeleteInstance(id);
    return true;
  }

  get size(): number {
    return dbCount();
  }

  keys(): IterableIterator<string> {
    // Merge cache keys with DB keys
    const allIds = new Set([...this.cache.keys(), ...dbGetAllIds()]);
    return allIds.values();
  }

  values(): IterableIterator<Instance> {
    // Authoritative: merge DB instances with cache (cache wins for active ones)
    const dbInstances = dbGetAllInstances();
    const merged = new Map<string, Instance>();
    for (const inst of dbInstances) {
      merged.set(inst.id, inst);
    }
    // Overlay cache (has fresher data for active instances)
    for (const [id, inst] of this.cache) {
      merged.set(id, inst);
    }
    return merged.values();
  }

  entries(): IterableIterator<[string, Instance]> {
    const dbInstances = dbGetAllInstances();
    const merged = new Map<string, Instance>();
    for (const inst of dbInstances) {
      merged.set(inst.id, inst);
    }
    for (const [id, inst] of this.cache) {
      merged.set(id, inst);
    }
    return merged.entries();
  }

  forEach(callbackfn: (value: Instance, key: string, map: Map<string, Instance>) => void): void {
    const all = new Map<string, Instance>();
    for (const [k, v] of this.entries()) {
      all.set(k, v);
    }
    all.forEach(callbackfn);
  }

  /**
   * Persist all cached instances to SQLite.
   * Since consumers mutate instance objects directly (e.g. status changes,
   * log appends during deployment), we flush ALL cached instances rather
   * than tracking individual mutations. With at most a few dozen instances
   * this is negligible overhead.
   */
  flush(): void {
    for (const [, inst] of this.cache) {
      dbUpsertInstance(inst);
    }
  }

  [Symbol.iterator](): IterableIterator<[string, Instance]> {
    return this.entries();
  }
}

// Singleton: survive Next.js hot reloads via globalThis.
// IMPORTANT: Do NOT use `instanceof InstanceStore` here. In dev mode, Next.js
// HMR re-evaluates this module, creating a new InstanceStore class object.
// `instanceof` would fail against the old singleton (different class identity),
// causing a new store to be created that loses in-memory state from the async
// deployInstance function. This was the root cause of deployments appearing
// stuck: the deploy mutated the old store's object, but API reads hit the new store.
const g = globalThis as unknown as { __clawgent_instances?: InstanceStore };
if (!g.__clawgent_instances) {
  g.__clawgent_instances = new InstanceStore();
}
export const instances = g.__clawgent_instances;

// Bootstrap proactive WA listeners after store hydration.
// Uses a flag on globalThis to avoid re-bootstrapping on Next.js HMR.
// Dynamic import avoids circular dependency: instances.ts ↔ instance-listener.ts
const gb = globalThis as unknown as { __clawgent_listeners_bootstrapped?: boolean };
if (!gb.__clawgent_listeners_bootstrapped) {
  gb.__clawgent_listeners_bootstrapped = true;
  import("./instance-listener")
    .then((m) => m.bootstrapListeners())
    .catch((err) => console.error("[instances] Failed to bootstrap listeners:", err));
  import("./key-validator")
    .then((m) => m.startKeyValidator())
    .catch((err) => console.error("[instances] Failed to start key validator:", err));
  import("./nex-skill-updater")
    .then((m) => m.startNexSkillUpdater())
    .catch((err) => console.error("[instances] Failed to start nex skill updater:", err));
}

const CONTAINER_PREFIX = "clawgent-";

// Reconcile in-memory state with Docker. Called by API routes to recover
// after server restart or if globalThis gets cleared.
let reconciling = false;
export async function reconcileWithDocker(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    // Only reconcile RUNNING containers to avoid race conditions with destroyed containers
    const output = await runCommandSilent("docker", [
      "ps",  // Changed from "ps -a" to only show running containers
      "--filter", `name=${CONTAINER_PREFIX}`,
      "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}",
    ]);
    const knownIds = new Set(instances.keys());

    for (const line of (output.trim() ? output.trim().split("\n") : [])) {
      const [name, dockerStatus, ports] = line.split("\t");
      if (!name?.startsWith(CONTAINER_PREFIX)) continue;

      const id = name.replace(CONTAINER_PREFIX, "");
      // Skip if already tracked in memory OR in database (don't overwrite existing records)
      if (knownIds.has(id) || dbGetInstance(id)) continue;

      // Parse port from docker output like "0.0.0.0:19000->18789/tcp"
      let port = 0;
      const portMatch = ports?.match(/(?:0\.0\.0\.0|127\.0\.0\.1):(\d+)->/);
      if (portMatch) port = parseInt(portMatch[1], 10);

      const isUp = dockerStatus?.startsWith("Up");

      // Recover auth token from container environment
      let token = "";
      if (isUp) {
        try {
          const envOutput = await runCommandSilent("docker", ["exec", name, "env"]);
          const tokenLine = envOutput.split("\n").find(l => l.startsWith("OPENCLAW_GATEWAY_TOKEN="));
          if (tokenLine) token = tokenLine.split("=")[1].trim();
        } catch {
          // container may not support exec
        }
      }

      const now = new Date();
      const instance: Instance = {
        id,
        containerName: name,
        port,
        token,
        status: isUp ? "running" : "stopped",
        dashboardUrl: isUp ? `/i/${id}/` : null,
        createdAt: now.toISOString(),
        logs: ["[recovered] Instance reconciled from Docker state."],
      };

      instances.set(id, instance);
      if (isUp && token) startPairingAutoApprover(instance);
    }

    // Ensure auto-approver is running for all active instances (survives PM2 restart)
    for (const inst of instances.values()) {
      if (inst.status === "running" && inst.token) {
        startPairingAutoApprover(inst);
      }
    }

    // Clean up orphaned DB records: instances in DB but not running in Docker
    const runningContainerIds = new Set<string>();
    for (const line of (output.trim() ? output.trim().split("\n") : [])) {
      const [name] = line.split("\t");
      if (name?.startsWith(CONTAINER_PREFIX)) {
        runningContainerIds.add(name.replace(CONTAINER_PREFIX, ""));
      }
    }

    // Mark DB instances as stopped if their container is no longer running
    const allDbInstances = dbGetAllInstances();
    for (const inst of allDbInstances) {
      if ((inst.status === "running" || inst.status === "starting") && !runningContainerIds.has(inst.id)) {
        inst.status = "stopped";
        inst.dashboardUrl = null;
        dbUpsertInstance(inst);
        // Also update cache if present
        const cached = instances.get(inst.id);
        if (cached) {
          cached.status = "stopped";
          cached.dashboardUrl = null;
        }
        console.log(`[reconcile] Marked instance ${inst.id} as stopped (container not running)`);
      }

      // Recover error instances whose containers are actually running
      if (inst.status === "error" && runningContainerIds.has(inst.id)) {
        inst.status = "running";
        inst.dashboardUrl = `/i/${inst.id}/`;
        dbUpsertInstance(inst);
        const cached = instances.get(inst.id);
        if (cached) {
          cached.status = "running";
          cached.dashboardUrl = `/i/${inst.id}/`;
        }
        console.log(`[reconcile] Recovered error instance ${inst.id} (container is running)`);
      }
    }

    // Delete stale instances (error/stopped) older than 1 hour
    // First, collect IDs to evict from cache
    const staleToEvict = dbGetOrphanedInstances()
      .filter(inst => inst.createdAt < new Date(Date.now() - 60 * 60 * 1000).toISOString())
      .map(inst => inst.id);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const deleted = dbDeleteOldStaleInstances(oneHourAgo);
    if (deleted > 0) {
      console.log(`[reconcile] Cleaned up ${deleted} stale instance(s) older than 1 hour`);
      for (const id of staleToEvict) {
        instances.delete(id);
      }
    }
  } catch {
    // Docker not available or command failed — nothing to reconcile
  } finally {
    reconciling = false;
  }
}

export function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin` },
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(
          new Error(
            `Command "${cmd} ${args.join(" ")}" failed (code ${code}): ${stderr.trim()}`
          )
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn "${cmd}": ${err.message}`));
    });
  });
}

/** Find the active instance belonging to a given user (at most one). */
export function findInstanceByUserId(userId: string): Instance | undefined {
  // Check cache first, only return running/starting instances
  for (const inst of instances.values()) {
    if (inst.userId === userId && (inst.status === "running" || inst.status === "starting")) return inst;
  }
  // Also check DB directly for active instances only
  return dbGetInstanceByUserIdActive(userId);
}

/**
 * Find an active instance by userId, also checking linked accounts.
 * If the user has no direct instance, checks if they're linked to
 * another identity (web↔WA) and returns that instance instead.
 */
export function findInstanceByAnyLinkedUserId(userId: string): Instance | undefined {
  // 1. Direct lookup
  const direct = findInstanceByUserId(userId);
  if (direct) return direct;

  // 2. Check linked accounts for the other identity
  if (userId.startsWith("wa-")) {
    const phone = userId.replace("wa-", "");
    const linked = dbGetLinkedByPhone(phone);
    if (linked) return findInstanceByUserId(linked.web_user_id);
  } else {
    const linked = dbGetLinkedByWebUser(userId);
    if (linked) return findInstanceByUserId(`wa-${linked.wa_phone}`);
  }

  return undefined;
}

/**
 * Check if a userId owns an instance — directly or via linked account.
 * Used by API routes for ownership checks on linked WA↔web instances.
 */
export function isInstanceOwner(instance: Instance, userId: string): boolean {
  if (instance.userId === userId) return true;

  // Check linked accounts: web user accessing a WA-deployed instance (or vice versa)
  if (userId.startsWith("wa-")) {
    const phone = userId.replace("wa-", "");
    const linked = dbGetLinkedByPhone(phone);
    return !!linked && instance.userId === linked.web_user_id;
  } else {
    const linked = dbGetLinkedByWebUser(userId);
    return !!linked && instance.userId === `wa-${linked.wa_phone}`;
  }
}

/** Find an active instance by its gateway token. Used by LLM proxy to validate requests. */
export function findInstanceByToken(token: string): Instance | undefined {
  // Check cache first, only return running/starting instances
  for (const inst of instances.values()) {
    if (inst.token === token && (inst.status === "running" || inst.status === "starting")) return inst;
  }
  // Fall back to DB
  return dbGetInstanceByTokenActive(token);
}

export function runCommandSilent(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin` },
      shell: false,
    });

    let stdout = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Command failed with code ${code}`));
    });

    proc.on("error", reject);
  });
}

// ─── Pairing Auto-Approver ───────────────────────────────────────
// Runs in background for each active instance, approving device
// pairing requests so browser connections work without manual approval.
// Tracked by Map to avoid duplicates and support fast-mode re-entry
// when the user visits the instance page.

const activeApprovers = new Map<string, { lastVisit: number }>();

export function startPairingAutoApprover(instance: Instance): void {
  const existing = activeApprovers.get(instance.id);
  if (existing) {
    // Already running — bump lastVisit so it switches back to fast polling
    existing.lastVisit = Date.now();
    return;
  }

  const state = { lastVisit: Date.now() };
  activeApprovers.set(instance.id, state);

  const FAST_INTERVAL = 1000;  // 1s for 30s after last visit
  const SLOW_INTERVAL = 5000;  // 5s otherwise

  async function checkAndApprove(): Promise<void> {
    if (!instances.has(instance.id) || instances.get(instance.id)?.status !== "running") {
      activeApprovers.delete(instance.id);
      return;
    }

    try {
      // Read pending requests directly from the filesystem.
      // We avoid the `openclaw devices approve` CLI because it connects via
      // WebSocket to the running gateway, which hangs indefinitely.
      const approved = await runCommandSilent("docker", [
        "exec", instance.containerName,
        "node", "-e", `
          const fs = require('fs');
          const DEVICES = '/home/node/.openclaw/devices';
          const pendingPath = DEVICES + '/pending.json';
          const pairedPath = DEVICES + '/paired.json';
          try { fs.mkdirSync(DEVICES, { recursive: true }); } catch {}
          let pending = {};
          try { pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8')); } catch { process.exit(0); }
          const ids = Object.keys(pending);
          if (ids.length === 0) { process.exit(0); }
          let paired = {};
          try { paired = JSON.parse(fs.readFileSync(pairedPath, 'utf8')); } catch {}
          for (const entry of Object.values(pending)) {
            paired[entry.deviceId] = {
              deviceId: entry.deviceId,
              publicKey: entry.publicKey,
              platform: entry.platform,
              clientId: entry.clientId,
              clientMode: entry.clientMode,
              role: entry.role,
              roles: entry.roles,
              scopes: entry.scopes,
              approvedAt: Date.now(),
            };
          }
          fs.writeFileSync(pairedPath, JSON.stringify(paired, null, 2));
          fs.writeFileSync(pendingPath, JSON.stringify({}, null, 2));
          console.log(ids.length);
        `,
      ]);

      if (approved.trim() && parseInt(approved.trim(), 10) > 0) {
        // Signal gateway to reload so it picks up the newly paired devices
        try {
          await runCommandSilent("docker", [
            "exec", instance.containerName, "kill", "-USR1", "1",
          ]);
        } catch {
          // Non-fatal
        }
      }
    } catch {
      // Container not ready or devices dir doesn't exist yet
    }

    // Schedule next check — fast for 30s after most recent visit, then slow
    if (!activeApprovers.has(instance.id)) return;
    const sinceVisit = Date.now() - state.lastVisit;
    const delay = sinceVisit < 30000 ? FAST_INTERVAL : SLOW_INTERVAL;
    const timer = setTimeout(checkAndApprove, delay);
    if (timer && typeof timer === "object" && "unref" in timer) timer.unref();
  }

  // Run first check immediately
  checkAndApprove();
}

/**
 * Destroy an instance: stop + remove container, remove volume, update store.
 * Used by both manual DELETE and the automatic expiry checker.
 */
export async function destroyInstance(id: string): Promise<void> {
  const instance = instances.get(id);
  if (!instance) return;

  const containerName = instance.containerName;
  const volumeName = `clawgent-data-${id}`;

  try {
    await runCommandSilent("docker", ["stop", containerName]);
  } catch {
    // Container may already be stopped
  }
  try {
    await runCommandSilent("docker", ["rm", "-f", containerName]);
  } catch {
    // Container may already be removed
  }
  try {
    await runCommandSilent("docker", ["volume", "rm", volumeName]);
  } catch {
    // Volume may not exist
  }

  instance.status = "stopped";
  instance.dashboardUrl = null;
  instances.delete(id);
  console.log(`[destroy] Instance ${id} destroyed`);
}
