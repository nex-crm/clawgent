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
    CREATE INDEX IF NOT EXISTS idx_instances_token ON instances(token);

    CREATE TABLE IF NOT EXISTS usage_tracking (
      userId    TEXT NOT NULL,
      date      TEXT NOT NULL,
      callCount INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (userId, date)
    );

    CREATE TABLE IF NOT EXISTS whatsapp_sessions (
      phone           TEXT PRIMARY KEY,
      userId          TEXT NOT NULL,
      currentState    TEXT NOT NULL DEFAULT 'WELCOME',
      selectedPersona TEXT,
      selectedProvider TEXT,
      instanceId      TEXT,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      phone     TEXT NOT NULL,
      direction TEXT NOT NULL,
      content   TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS linked_accounts (
      web_user_id TEXT NOT NULL,
      wa_phone    TEXT NOT NULL,
      linked_at   TEXT NOT NULL,
      PRIMARY KEY (web_user_id, wa_phone),
      UNIQUE (web_user_id),
      UNIQUE (wa_phone)
    );

    CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_userId ON whatsapp_sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(phone);
  `);

  // Migration: add expiresAt column if it doesn't exist (for existing DBs)
  const cols = g.__clawgent_db
    .prepare("PRAGMA table_info(instances)")
    .all() as { name: string }[];
  if (!cols.some((c) => c.name === "expiresAt")) {
    g.__clawgent_db.exec("ALTER TABLE instances ADD COLUMN expiresAt TEXT");
  }

  // Migration: add activeAgent column to whatsapp_sessions
  const waCols = g.__clawgent_db
    .prepare("PRAGMA table_info(whatsapp_sessions)")
    .all() as { name: string }[];
  if (!waCols.some((c) => c.name === "activeAgent")) {
    g.__clawgent_db.exec("ALTER TABLE whatsapp_sessions ADD COLUMN activeAgent TEXT");
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
const stmtGetByUserIdActive = db.prepare("SELECT * FROM instances WHERE userId = ? AND status IN ('running', 'starting') LIMIT 1");
const stmtGetByTokenActive = db.prepare("SELECT * FROM instances WHERE token = ? AND status IN ('running', 'starting') LIMIT 1");
const stmtGetOrphaned = db.prepare("SELECT * FROM instances WHERE status IN ('error', 'stopped')");
const stmtDeleteOldStale = db.prepare("DELETE FROM instances WHERE status IN ('error', 'stopped') AND createdAt < ?");
const stmtGetAll = db.prepare("SELECT * FROM instances");
const stmtDelete = db.prepare("DELETE FROM instances WHERE id = ?");
const stmtCount = db.prepare("SELECT COUNT(*) as count FROM instances");
const stmtGetIds = db.prepare("SELECT id FROM instances");

// --- WhatsApp prepared statements ---

const stmtGetWaSession = db.prepare("SELECT * FROM whatsapp_sessions WHERE phone = ?");
const stmtUpsertWaSession = db.prepare(`
  INSERT INTO whatsapp_sessions (phone, userId, currentState, selectedPersona, selectedProvider, instanceId, activeAgent, createdAt, updatedAt)
  VALUES (@phone, @userId, @currentState, @selectedPersona, @selectedProvider, @instanceId, @activeAgent, @createdAt, @updatedAt)
  ON CONFLICT(phone) DO UPDATE SET
    currentState    = @currentState,
    selectedPersona = @selectedPersona,
    selectedProvider = @selectedProvider,
    instanceId      = @instanceId,
    activeAgent     = @activeAgent,
    updatedAt       = @updatedAt
`);
const stmtDeleteWaSession = db.prepare("DELETE FROM whatsapp_sessions WHERE phone = ?");
const stmtInsertWaMessage = db.prepare(`
  INSERT INTO whatsapp_messages (phone, direction, content, createdAt)
  VALUES (@phone, @direction, @content, @createdAt)
`);
const stmtGetWaMessages = db.prepare("SELECT * FROM whatsapp_messages WHERE phone = ? ORDER BY id DESC LIMIT ?");

// --- Linked accounts prepared statements ---

const stmtGetLinkedByWebUser = db.prepare("SELECT * FROM linked_accounts WHERE web_user_id = ?");
const stmtGetLinkedByPhone = db.prepare("SELECT * FROM linked_accounts WHERE wa_phone = ?");
const stmtInsertLinked = db.prepare("INSERT INTO linked_accounts (web_user_id, wa_phone, linked_at) VALUES (?, ?, ?)");
const stmtDeleteLinkedByPhone = db.prepare("DELETE FROM linked_accounts WHERE wa_phone = ?");
const stmtUpdateInstanceUserId = db.prepare("UPDATE instances SET userId = ? WHERE id = ?");

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

export function dbGetInstanceByUserIdActive(userId: string): Instance | undefined {
  const row = stmtGetByUserIdActive.get(userId) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : undefined;
}

export function dbGetInstanceByTokenActive(token: string): Instance | undefined {
  const row = stmtGetByTokenActive.get(token) as Record<string, unknown> | undefined;
  return row ? rowToInstance(row) : undefined;
}

export function dbGetOrphanedInstances(): Instance[] {
  const rows = stmtGetOrphaned.all() as Record<string, unknown>[];
  return rows.map(rowToInstance);
}

export function dbDeleteOldStaleInstances(cutoffISO: string): number {
  const result = stmtDeleteOldStale.run(cutoffISO);
  return result.changes;
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

// --- WhatsApp types & CRUD ---

export interface WhatsAppSession {
  phone: string;
  userId: string;
  currentState: string;
  selectedPersona: string | null;
  selectedProvider: string | null;
  instanceId: string | null;
  activeAgent: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WhatsAppMessage {
  id: number;
  phone: string;
  direction: string;
  content: string;
  createdAt: string;
}

export function dbGetWaSession(phone: string): WhatsAppSession | undefined {
  const row = stmtGetWaSession.get(phone) as WhatsAppSession | undefined;
  return row ?? undefined;
}

export function dbUpsertWaSession(session: WhatsAppSession): void {
  stmtUpsertWaSession.run({
    ...session,
    selectedPersona: session.selectedPersona ?? null,
    selectedProvider: session.selectedProvider ?? null,
    instanceId: session.instanceId ?? null,
    activeAgent: session.activeAgent ?? null,
  });
}

export function dbDeleteWaSession(phone: string): void {
  stmtDeleteWaSession.run(phone);
}

export function dbInsertWaMessage(msg: Omit<WhatsAppMessage, "id">): void {
  stmtInsertWaMessage.run(msg);
}

export function dbGetWaMessages(phone: string, limit = 50): WhatsAppMessage[] {
  return stmtGetWaMessages.all(phone, limit) as WhatsAppMessage[];
}

// --- Linked accounts types & CRUD ---

export interface LinkedAccount {
  web_user_id: string;
  wa_phone: string;
  linked_at: string;
}

export function dbGetLinkedByWebUser(webUserId: string): LinkedAccount | undefined {
  return stmtGetLinkedByWebUser.get(webUserId) as LinkedAccount | undefined;
}

export function dbGetLinkedByPhone(phone: string): LinkedAccount | undefined {
  return stmtGetLinkedByPhone.get(phone) as LinkedAccount | undefined;
}

export function dbInsertLinkedAccount(webUserId: string, phone: string): void {
  stmtInsertLinked.run(webUserId, phone, new Date().toISOString());
}

export function dbDeleteLinkedByPhone(phone: string): void {
  stmtDeleteLinkedByPhone.run(phone);
}

export function dbUpdateInstanceUserId(instanceId: string, newUserId: string): void {
  stmtUpdateInstanceUserId.run(newUserId, instanceId);
}
