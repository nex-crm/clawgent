import { spawn } from "child_process";
import {
  dbGetInstance,
  dbGetAllInstances,
  dbUpsertInstance,
  dbDeleteInstance,
  dbCount,
  dbGetAllIds,
  dbGetInstanceByUserId,
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

// Singleton: survive Next.js hot reloads via globalThis
const g = globalThis as unknown as { __clawgent_instances?: InstanceStore };
if (!g.__clawgent_instances || !(g.__clawgent_instances instanceof InstanceStore)) {
  g.__clawgent_instances = new InstanceStore();
}
export const instances = g.__clawgent_instances;

const CONTAINER_PREFIX = "clawgent-";

// Reconcile in-memory state with Docker. Called by API routes to recover
// after server restart or if globalThis gets cleared.
let reconciling = false;
export async function reconcileWithDocker(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    const output = await runCommandSilent("docker", [
      "ps", "-a",
      "--filter", `name=${CONTAINER_PREFIX}`,
      "--format", "{{.Names}}\t{{.Status}}\t{{.Ports}}",
    ]);
    if (!output.trim()) return;

    const knownIds = new Set(instances.keys());

    for (const line of output.trim().split("\n")) {
      const [name, dockerStatus, ports] = line.split("\t");
      if (!name?.startsWith(CONTAINER_PREFIX)) continue;

      const id = name.replace(CONTAINER_PREFIX, "");
      if (knownIds.has(id)) continue; // already tracked

      // Parse port from docker output like "0.0.0.0:19000->18789/tcp"
      let port = 0;
      const portMatch = ports?.match(/0\.0\.0\.0:(\d+)->/);
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

/** Find the instance belonging to a given user (at most one). */
export function findInstanceByUserId(userId: string): Instance | undefined {
  // Check cache first (via instances.values()), then DB
  for (const inst of instances.values()) {
    if (inst.userId === userId) return inst;
  }
  // Also check DB directly (in case cache doesn't have it)
  return dbGetInstanceByUserId(userId);
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
