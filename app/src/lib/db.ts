import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { join, dirname } from "path";
import type { Instance } from "./instances";

const DB_PATH = join(process.cwd(), "data", "clawgent.db");

// Ensure data directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

// Singleton: survive Next.js hot reloads via globalThis
const g = globalThis as unknown as { __clawgent_db?: Database.Database };
if (!g.__clawgent_db) {
  g.__clawgent_db = new Database(DB_PATH);
  g.__clawgent_db.pragma("journal_mode = WAL");
  g.__clawgent_db.pragma("foreign_keys = ON");

  g.__clawgent_db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id            TEXT PRIMARY KEY,
      containerName TEXT NOT NULL,
      port          INTEGER NOT NULL,
      token         TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'starting',
      dashboardUrl  TEXT,
      createdAt     TEXT NOT NULL,
      expiresAt     TEXT,
      logs          TEXT NOT NULL DEFAULT '[]',
      provider      TEXT,
      modelId       TEXT,
      persona       TEXT,
      userId        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_instances_userId ON instances(userId);
    CREATE INDEX IF NOT EXISTS idx_instances_status ON instances(status);
  `);

  // Migration: add expiresAt column if it doesn't exist (for existing DBs)
  const cols = g.__clawgent_db
    .prepare("PRAGMA table_info(instances)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "expiresAt")) {
    g.__clawgent_db.exec("ALTER TABLE instances ADD COLUMN expiresAt TEXT");
  }
}

export const db = g.__clawgent_db;

// --- Prepared statements (cached for performance) ---

const stmtUpsert = db.prepare(`
  INSERT INTO instances (id, containerName, port, token, status, dashboardUrl, createdAt, expiresAt, logs, provider, modelId, persona, userId)
  VALUES (@id, @containerName, @port, @token, @status, @dashboardUrl, @createdAt, @expiresAt, @logs, @provider, @modelId, @persona, @userId)
  ON CONFLICT(id) DO UPDATE SET
    containerName = @containerName,
    port          = @port,
    token         = @token,
    status        = @status,
    dashboardUrl  = @dashboardUrl,
    expiresAt     = @expiresAt,
    logs          = @logs,
    provider      = @provider,
    modelId       = @modelId,
    persona       = @persona,
    userId        = @userId
`);

const stmtGetById = db.prepare("SELECT * FROM instances WHERE id = ?");
const stmtGetByUserId = db.prepare("SELECT * FROM instances WHERE userId = ? LIMIT 1");
const stmtGetAll = db.prepare("SELECT * FROM instances");
const stmtDelete = db.prepare("DELETE FROM instances WHERE id = ?");
const stmtCount = db.prepare("SELECT COUNT(*) as count FROM instances");
const stmtGetIds = db.prepare("SELECT id FROM instances");

function rowToInstance(row: Record<string, unknown>): Instance {
  return {
    id: row.id as string,
    containerName: row.containerName as string,
    port: row.port as number,
    token: row.token as string,
    status: row.status as Instance["status"],
    dashboardUrl: (row.dashboardUrl as string) || null,
    createdAt: row.createdAt as string,
    logs: JSON.parse((row.logs as string) || "[]"),
    provider: (row.provider as string) || undefined,
    modelId: (row.modelId as string) || undefined,
    persona: (row.persona as string) || undefined,
    userId: (row.userId as string) || undefined,
  };
}

function instanceToRow(inst: Instance): Record<string, unknown> {
  return {
    id: inst.id,
    containerName: inst.containerName,
    port: inst.port,
    token: inst.token,
    status: inst.status,
    dashboardUrl: inst.dashboardUrl,
    createdAt: inst.createdAt,
    expiresAt: null, // column retained in schema but no longer populated
    logs: JSON.stringify(inst.logs.slice(-200)), // keep last 200 log entries
    provider: inst.provider ?? null,
    modelId: inst.modelId ?? null,
    persona: inst.persona ?? null,
    userId: inst.userId ?? null,
  };
}

export function dbGetInstance(id: string): Instance | undefined {
  const row = stmtGetById.get(id) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : undefined;
}

export function dbGetInstanceByUserId(userId: string): Instance | undefined {
  const row = stmtGetByUserId.get(userId) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : undefined;
}

export function dbGetAllInstances(): Instance[] {
  const rows = stmtGetAll.all() as Record<string, unknown>[];
  return rows.map(rowToInstance);
}

export function dbUpsertInstance(inst: Instance): void {
  stmtUpsert.run(instanceToRow(inst));
}

export function dbDeleteInstance(id: string): void {
  stmtDelete.run(id);
}

export function dbCount(): number {
  const row = stmtCount.get() as { count: number };
  return row.count;
}

export function dbGetAllIds(): string[] {
  const rows = stmtGetIds.all() as { id: string }[];
  return rows.map((r) => r.id);
}
