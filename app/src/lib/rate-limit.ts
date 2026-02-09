import { db } from "./db";

const DAILY_LIMIT = 200;

const stmtGetUsage = db.prepare("SELECT callCount FROM usage_tracking WHERE userId = ? AND date = ?");
const stmtUpsertUsage = db.prepare(`
  INSERT INTO usage_tracking (userId, date, callCount) VALUES (?, ?, 1)
  ON CONFLICT(userId, date) DO UPDATE SET callCount = callCount + 1
`);

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

function nextMidnightUTC(): string {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.toISOString();
}

export function getUsageCount(userId: string, date: string): number {
  const row = stmtGetUsage.get(userId, date) as { callCount: number } | undefined;
  return row?.callCount ?? 0;
}

export function incrementUsage(userId: string, date: string): void {
  stmtUpsertUsage.run(userId, date);
}

export function checkRateLimit(userId: string): { allowed: boolean; remaining: number; resetAt: string } {
  const today = todayUTC();
  const count = getUsageCount(userId, today);
  return {
    allowed: count < DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - count),
    resetAt: nextMidnightUTC(),
  };
}
