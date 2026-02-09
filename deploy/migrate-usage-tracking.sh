#!/bin/bash
# Migration: Add usage_tracking table to existing Clawgent DB
# Run on prod: bash /opt/clawgent/deploy/migrate-usage-tracking.sh
#
# This is a safety-net script. The app code in db.ts will also create
# this table automatically on startup via CREATE TABLE IF NOT EXISTS.
# Run this manually if the table doesn't appear after deployment.

set -euo pipefail

DB_PATH="${1:-/opt/clawgent/app/data/clawgent.db}"

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: Database not found at $DB_PATH"
  exit 1
fi

echo "=== Clawgent DB Migration: usage_tracking ==="
echo "Database: $DB_PATH"
echo ""

echo "Tables BEFORE migration:"
sqlite3 "$DB_PATH" ".tables"
echo ""

sqlite3 "$DB_PATH" <<'SQL'
CREATE TABLE IF NOT EXISTS usage_tracking (
  userId    TEXT NOT NULL,
  date      TEXT NOT NULL,
  callCount INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (userId, date)
);
SQL

echo "Tables AFTER migration:"
sqlite3 "$DB_PATH" ".tables"
echo ""

echo "Schema for usage_tracking:"
sqlite3 "$DB_PATH" ".schema usage_tracking"
echo ""

echo "=== Migration complete ==="
