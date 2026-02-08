# Clawgent Clone - Technical Architecture

> Last updated: 2026-02-07
> Status: Research complete, ready for implementation planning

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [OpenClaw Architecture Deep Dive](#2-openclaw-architecture-deep-dive)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [Database Schema](#5-database-schema)
6. [API Routes](#6-api-routes)
7. [Authentication (Google OAuth)](#7-authentication-google-oauth)
8. [VM Provisioning & Automation](#8-vm-provisioning--automation)
9. [OpenClaw Installation Automation](#9-openclaw-installation-automation)
10. [Channel Integration (Telegram & Discord)](#10-channel-integration-telegram--discord)
11. [Infrastructure & Cost Analysis](#11-infrastructure--cost-analysis)
12. [Deployment Pipeline](#12-deployment-pipeline)
13. [MVP Implementation Plan](#13-mvp-implementation-plan)

---

## 1. System Overview

### What We're Building

A web platform that provisions a cloud VM, installs OpenClaw, configures an AI model + messaging channel, and hands users a working AI assistant bot - all in under 60 seconds.

### High-Level Architecture

```
User Browser (Next.js on Vercel)
       |
       | HTTPS
       v
+------------------+       +-------------------+
|  Vercel Edge     |       |  PostgreSQL       |
|  (Next.js App)   |------>|  (Neon / Supabase)|
|  - Pages         |       |  - Users          |
|  - API Routes    |       |  - Deployments    |
|  - Auth (NextAuth)|      |  - Configs        |
+------------------+       +-------------------+
       |
       | REST API
       v
+---------------------------+
|  Cloud Provider API       |
|  (DigitalOcean / Hetzner) |
|  - Create VM              |
|  - cloud-init user-data   |
+---------------------------+
       |
       | VM boots, cloud-init runs
       v
+---------------------------+
|  Provisioned VM           |
|  - Ubuntu 22.04+          |
|  - Node.js 22+            |
|  - OpenClaw installed     |
|  - openclaw.json written  |
|  - Gateway on :18789      |
|  - Channel connected      |
+---------------------------+
```

### Data Flow: Deploy Button to Working Bot

```
1. User clicks "Deploy"
2. Next.js API route receives: { model, channel, channelToken, modelApiKey }
3. API creates deployment record in DB (status: "provisioning")
4. API calls DigitalOcean/Hetzner API:
   - Creates VM with cloud-init user-data script
   - user-data installs Node 22, installs OpenClaw, writes openclaw.json, starts gateway
5. API polls VM for SSH/health readiness (or cloud-init callback)
6. API updates deployment record (status: "running", ip: "x.x.x.x")
7. Frontend polls /api/deployments/:id/status
8. Frontend shows "Your bot is live!" with connection details
```

---

## 2. OpenClaw Architecture Deep Dive

### Core Facts

| Property | Value |
|----------|-------|
| Runtime | Node.js >= 22 (TypeScript) |
| Install | `npm i -g openclaw@latest` |
| Onboard | `openclaw onboard --install-daemon` |
| Config path | `~/.openclaw/openclaw.json` (JSON5 format) |
| Gateway port | 18789 (WebSocket + HTTP multiplexed) |
| Default bind | `127.0.0.1` (loopback) |
| Daemon | launchd (macOS) / systemd (Linux) |
| License | MIT |
| Config reload | Automatic (watches file for changes) |
| Validation | Zod schemas, strict - invalid config prevents startup |

### Gateway Architecture

The Gateway is the central control plane:

```
Messaging Channels (WhatsApp/Telegram/Discord/Slack/etc.)
        |
        v
+---------------------------------------+
| Gateway (ws://127.0.0.1:18789)        |
|---------------------------------------|
| - WebSocket RPC endpoint              |
| - HTTP Control UI                     |
| - Session management                  |
| - Agent runtime (Pi Agent)            |
| - Tool execution                      |
| - Channel multiplexing                |
+---------------------------------------+
        |
        v
  AI Model Provider APIs
  (Anthropic, OpenAI, etc.)
```

### Config File Structure (Key Sections)

```json5
{
  // Agent & model config
  agents: {
    defaults: {
      model: { primary: "anthropic/claude-opus-4-6" },
      workspace: "~/.openclaw/workspace"
    }
  },
  // Gateway settings
  gateway: {
    port: 18789,
    bind: "loopback",     // "loopback" | "lan" | "auto"
    auth: { token: "secret-token" }
  },
  // Auth profiles for AI providers
  auth: {
    profiles: [{
      id: "anthropic-main",
      provider: "anthropic",
      mode: "apiKey",
      apiKey: "${ANTHROPIC_API_KEY}"
    }]
  },
  // Channel integrations
  channels: {
    telegram: {
      mode: "bot",
      accounts: { main: { token: "${TELEGRAM_BOT_TOKEN}" } },
      dmPolicy: "open",
      allowFrom: ["*"]
    },
    discord: {
      mode: "bot",
      accounts: { main: { token: "${DISCORD_BOT_TOKEN}" } },
      dmPolicy: "open",
      allowFrom: ["*"]
    }
  },
  // Environment variable substitution
  env: {
    ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY}",
    OPENAI_API_KEY: "${OPENAI_API_KEY}"
  },
  tools: { profile: "full" }
}
```

### Key Config Resolution

- Environment variables: `${VAR_NAME}` syntax throughout config
- Priority: CLI flags > env vars > config file > defaults
- Config path: overridable via `OPENCLAW_CONFIG_PATH`
- Validation: `openclaw doctor` checks for issues, `--fix` auto-repairs

### Supported AI Models (for our platform)

| Model | Provider | Config ID | API Key Env Var |
|-------|----------|-----------|-----------------|
| Claude Opus 4.5 | Anthropic | `anthropic/claude-opus-4-5` | `ANTHROPIC_API_KEY` |
| GPT-5.2 | OpenAI | `openai/gpt-5.2` | `OPENAI_API_KEY` |
| Gemini 3 Flash | Google | `google/gemini-3-flash` | `GOOGLE_API_KEY` |

### Supported Channels

| Channel | Library | Config Key | Token Env Var |
|---------|---------|-----------|---------------|
| Telegram | grammY | `channels.telegram` | `TELEGRAM_BOT_TOKEN` |
| Discord | discord.js | `channels.discord` | `DISCORD_BOT_TOKEN` |
| WhatsApp | Baileys | `channels.whatsapp` | N/A (QR-based auth) |
| Slack | Bolt | `channels.slack` | `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` |

---

## 3. Frontend Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Auth | NextAuth.js v5 (Auth.js) |
| State | React useState/useReducer (no external state lib needed) |
| Hosting | Vercel |
| HTTP Client | Native fetch (Next.js extended) |

### Page Structure

```
app/
  layout.tsx          # Root layout, dark theme, Inter font
  page.tsx            # Landing page + deploy flow (single page)
  api/
    auth/
      [...nextauth]/
        route.ts      # NextAuth Google OAuth endpoints
    deploy/
      route.ts        # POST - initiate deployment
    deployments/
      [id]/
        status/
          route.ts    # GET - poll deployment status
        route.ts      # GET - deployment details
  components/
    ModelSelector.tsx  # Card-based AI model picker
    ChannelSelector.tsx # Card-based channel picker
    DeployButton.tsx   # Main CTA with loading states
    StatusTracker.tsx  # Deployment progress indicator
    ComparisonTable.tsx # Traditional vs Clawgent
    UseCaseGrid.tsx    # 20+ use case cards
```

### Design System

- Background: `#07080a` (near-black)
- Text: White on dark
- Cards: Dark with subtle borders, selected state with accent color
- Font: Inter (variable weight)
- Layout: Centered, max-width ~1200px container
- Aesthetic: Clean, minimal, developer-tool

---

## 4. Backend Architecture

### API Route Design

All backend logic runs as Next.js API routes on Vercel (serverless functions). No separate backend server needed for MVP.

```
Next.js API Routes (Vercel Serverless)
  |
  |-- /api/auth/*          NextAuth.js handlers
  |-- /api/deploy          VM provisioning orchestrator
  |-- /api/deployments/*   Status polling & management
  |
  |-- lib/
  |     |-- db.ts          Database client (Drizzle ORM)
  |     |-- cloud.ts       Cloud provider API wrapper
  |     |-- openclaw.ts    OpenClaw config generator
  |     |-- channels.ts    Channel validation helpers
  |
  |-- services/
        |-- provisioner.ts  VM creation + cloud-init orchestration
```

### Backend Service Responsibilities

**Provisioner Service** (`lib/cloud.ts` + `services/provisioner.ts`):
- Constructs cloud-init user-data script from user selections
- Calls cloud provider API to create VM
- Stores deployment record with VM ID, IP, status
- Handles cleanup on failure

**OpenClaw Config Generator** (`lib/openclaw.ts`):
- Takes model choice + channel choice + API keys
- Generates valid `openclaw.json` content
- Injects into cloud-init user-data as heredoc

---

## 5. Database Schema

### Provider: Neon (Serverless PostgreSQL)

Neon is the recommended choice: serverless Postgres, generous free tier (0.5 GB storage, 190 compute hours/month), works perfectly with Vercel serverless functions (connection pooling via HTTP driver), and scales to zero when inactive.

### ORM: Drizzle

Drizzle is lightweight, TypeScript-native, and has excellent Neon/Vercel integration.

### Schema

```sql
-- Users table (populated by NextAuth)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  image         TEXT,
  google_id     TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OAuth accounts (managed by NextAuth adapter)
CREATE TABLE accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                TEXT NOT NULL,          -- "oauth"
  provider            TEXT NOT NULL,          -- "google"
  provider_account_id TEXT NOT NULL,
  access_token        TEXT,
  refresh_token       TEXT,
  expires_at          INTEGER,
  token_type          TEXT,
  scope               TEXT,
  id_token            TEXT,
  UNIQUE(provider, provider_account_id)
);

-- Sessions (managed by NextAuth adapter)
CREATE TABLE sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT NOT NULL UNIQUE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires       TIMESTAMPTZ NOT NULL
);

-- Deployments
CREATE TABLE deployments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- VM details
  cloud_provider  TEXT NOT NULL DEFAULT 'digitalocean',  -- "digitalocean" | "hetzner"
  vm_id           TEXT,                                   -- provider's VM/droplet ID
  vm_ip           INET,                                   -- public IP
  vm_region       TEXT NOT NULL,                          -- "nyc3", "fsn1", etc.
  vm_size         TEXT NOT NULL,                          -- "s-1vcpu-2gb", "cx22", etc.

  -- OpenClaw config
  model_provider  TEXT NOT NULL,      -- "anthropic" | "openai" | "google"
  model_id        TEXT NOT NULL,      -- "anthropic/claude-opus-4-5"
  channel_type    TEXT NOT NULL,      -- "telegram" | "discord"

  -- Status tracking
  status          TEXT NOT NULL DEFAULT 'pending',
  -- Possible statuses: pending | provisioning | installing | configuring | running | error | destroyed
  status_message  TEXT,
  gateway_healthy BOOLEAN DEFAULT FALSE,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provisioned_at  TIMESTAMPTZ,        -- VM created
  ready_at        TIMESTAMPTZ,        -- OpenClaw gateway healthy
  destroyed_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Channel credentials (encrypted at rest)
-- Stored separately so they can be rotated/revoked independently
CREATE TABLE channel_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id   UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  channel_type    TEXT NOT NULL,       -- "telegram" | "discord"

  -- Encrypted credential blob (bot token, etc.)
  -- Encrypted with AES-256-GCM using ENCRYPTION_KEY env var
  encrypted_token TEXT NOT NULL,
  token_iv        TEXT NOT NULL,

  -- Metadata (not sensitive)
  bot_username    TEXT,                -- "@my_bot" for Telegram
  bot_id          TEXT,                -- Discord application ID

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Model API keys (encrypted at rest)
CREATE TABLE model_credentials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id   UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  provider        TEXT NOT NULL,       -- "anthropic" | "openai" | "google"

  -- Encrypted API key
  encrypted_key   TEXT NOT NULL,
  key_iv          TEXT NOT NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_deployments_user_id ON deployments(user_id);
CREATE INDEX idx_deployments_status ON deployments(status);
CREATE INDEX idx_channel_credentials_deployment ON channel_credentials(deployment_id);
CREATE INDEX idx_model_credentials_deployment ON model_credentials(deployment_id);
```

### Encryption Strategy

Sensitive fields (bot tokens, API keys) are encrypted with AES-256-GCM before storage. The encryption key lives in `ENCRYPTION_KEY` environment variable, never in code or DB.

```typescript
// lib/encryption.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, 'hex'); // 32 bytes

export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { encrypted: encrypted + ':' + tag, iv: iv.toString('hex') };
}

export function decrypt(encrypted: string, iv: string): string {
  const [data, tag] = encrypted.split(':');
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

---

## 6. API Routes

### Route Map

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| `*` | `/api/auth/[...nextauth]` | Public | NextAuth.js OAuth handlers |
| `POST` | `/api/deploy` | Required | Initiate new deployment |
| `GET` | `/api/deployments` | Required | List user's deployments |
| `GET` | `/api/deployments/[id]` | Required | Get deployment details |
| `GET` | `/api/deployments/[id]/status` | Required | Poll deployment status (lightweight) |
| `DELETE` | `/api/deployments/[id]` | Required | Destroy deployment (teardown VM) |
| `POST` | `/api/deployments/[id]/restart` | Required | Restart OpenClaw on VM |

### POST /api/deploy - Request/Response

**Request:**
```json
{
  "model": "anthropic/claude-opus-4-5",
  "modelApiKey": "sk-ant-...",
  "channel": "telegram",
  "channelToken": "123456:ABC-DEF...",
  "region": "nyc3"
}
```

**Response (201 Created):**
```json
{
  "id": "dep_abc123",
  "status": "provisioning",
  "estimatedSeconds": 45
}
```

### GET /api/deployments/[id]/status - Polling Response

```json
{
  "id": "dep_abc123",
  "status": "running",
  "vmIp": "167.71.123.45",
  "gatewayHealthy": true,
  "channel": "telegram",
  "botUsername": "@my_openclaw_bot",
  "createdAt": "2026-02-07T12:00:00Z",
  "readyAt": "2026-02-07T12:00:42Z"
}
```

### Status Progression

```
pending → provisioning → installing → configuring → running
                                                        |
                                                     (healthy)
Any state → error (with statusMessage explaining what failed)
running → destroyed (user-initiated teardown)
```

---

## 7. Authentication (Google OAuth)

### Implementation: NextAuth.js v5 (Auth.js)

NextAuth.js handles the entire OAuth flow, session management, and database adapter integration.

### Google Cloud Console Setup

1. Create project in Google Cloud Console
2. Enable Google+ API (or People API)
3. Create OAuth 2.0 credentials (Web application type)
4. Set authorized JavaScript origins: `http://localhost:3000` (dev), `https://clawgent-ai.vercel.app` (prod)
5. Set authorized redirect URIs: `http://localhost:3000/api/auth/callback/google` (dev), `https://clawgent-ai.vercel.app/api/auth/callback/google` (prod)
6. Copy Client ID and Client Secret

### NextAuth Configuration

```typescript
// app/api/auth/[...nextauth]/route.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

export const { GET, POST } = handlers;
```

### Environment Variables

```env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
NEXTAUTH_URL=http://localhost:3000        # Dev
NEXTAUTH_SECRET=<random-32-byte-hex>      # Generate with: openssl rand -hex 32
```

### OAuth Flow

```
1. User clicks "Sign in with Google"
2. Redirect to Google consent screen
3. User grants permissions
4. Google redirects to /api/auth/callback/google with auth code
5. NextAuth exchanges code for tokens
6. NextAuth creates/updates user in DB via Drizzle adapter
7. Session cookie set, user is authenticated
8. Subsequent API calls include session cookie → auth middleware validates
```

---

## 8. VM Provisioning & Automation

### Primary Provider: DigitalOcean

**Why DigitalOcean over Hetzner for MVP:**
- Better API documentation and SDK ecosystem
- Node.js SDK available (`digitalocean-js` or direct REST)
- Per-second billing (as of Jan 2026) - great for short-lived instances
- US-based data centers (lower latency for US users)
- Marketplace images with Node.js pre-installed

**Fallback Provider: Hetzner** (for cost optimization later)
- Significantly cheaper (CX22 at ~$4.50/mo vs DO's $6/mo for similar specs)
- European data centers
- Good API, but less mature SDK ecosystem

### VM Specifications

| Spec | Value | Rationale |
|------|-------|-----------|
| OS | Ubuntu 24.04 LTS | Long-term support, cloud-init built-in |
| Size | 1 vCPU, 2 GB RAM | OpenClaw + Node.js minimum viable |
| Disk | 50 GB SSD | Enough for OpenClaw + workspace + logs |
| Region | User-selected (default: nyc3) | Latency optimization |
| Image | Ubuntu 24.04 (slug: `ubuntu-24-04-x64`) | Standard, cloud-init ready |

### DigitalOcean Pricing (as of Feb 2026)

| Plan | Specs | Monthly | Hourly |
|------|-------|---------|--------|
| s-1vcpu-1gb | 1 vCPU, 1 GB, 25 GB SSD | $6/mo | $0.00893/hr |
| s-1vcpu-2gb | 1 vCPU, 2 GB, 50 GB SSD | $12/mo | $0.01786/hr |
| s-2vcpu-2gb | 2 vCPU, 2 GB, 60 GB SSD | $18/mo | $0.02679/hr |

**Recommended: `s-1vcpu-2gb` ($12/mo)** - 2 GB RAM provides headroom for Node.js + OpenClaw gateway + channel processes.

### DigitalOcean API Integration

```typescript
// lib/cloud.ts

const DO_API_BASE = "https://api.digitalocean.com/v2";
const DO_TOKEN = process.env.DIGITALOCEAN_API_TOKEN!;

interface CreateDropletParams {
  name: string;
  region: string;
  size: string;
  userData: string;
  tags: string[];
}

export async function createDroplet(params: CreateDropletParams) {
  const response = await fetch(`${DO_API_BASE}/droplets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DO_TOKEN}`,
    },
    body: JSON.stringify({
      name: params.name,
      region: params.region,
      size: params.size,
      image: "ubuntu-24-04-x64",
      ssh_keys: [process.env.DO_SSH_KEY_ID!],
      backups: false,
      ipv6: false,
      monitoring: true,
      tags: params.tags,
      user_data: params.userData,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`DigitalOcean API error: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  return {
    dropletId: data.droplet.id,
    status: data.droplet.status,
  };
}

export async function getDroplet(dropletId: string) {
  const response = await fetch(`${DO_API_BASE}/droplets/${dropletId}`, {
    headers: { Authorization: `Bearer ${DO_TOKEN}` },
  });
  const data = await response.json();
  return {
    id: data.droplet.id,
    status: data.droplet.status,
    ip: data.droplet.networks.v4.find(
      (n: any) => n.type === "public"
    )?.ip_address,
  };
}

export async function destroyDroplet(dropletId: string) {
  await fetch(`${DO_API_BASE}/droplets/${dropletId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${DO_TOKEN}` },
  });
}
```

### Polling for VM Readiness

DigitalOcean droplets take 30-60 seconds to boot. We poll the API until we get a public IP:

```typescript
export async function waitForDropletReady(
  dropletId: string,
  timeoutMs = 120000
): Promise<{ ip: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const droplet = await getDroplet(dropletId);
    if (droplet.status === "active" && droplet.ip) {
      return { ip: droplet.ip };
    }
    await new Promise((r) => setTimeout(r, 3000)); // Poll every 3s
  }
  throw new Error("Droplet creation timed out");
}
```

---

## 9. OpenClaw Installation Automation

### Cloud-Init User-Data Script

This is the core automation. When DigitalOcean creates the VM, it executes this script on first boot via cloud-init.

```bash
#!/bin/bash
set -euo pipefail

# =============================================================================
# OpenClaw Automated Installation Script (cloud-init user-data)
# =============================================================================
# Variables injected by the provisioner:
#   MODEL_ID        - e.g., "anthropic/claude-opus-4-5"
#   MODEL_PROVIDER  - e.g., "anthropic"
#   MODEL_API_KEY   - e.g., "sk-ant-..."
#   CHANNEL_TYPE    - e.g., "telegram"
#   CHANNEL_TOKEN   - e.g., "123456:ABC..."
#   GATEWAY_TOKEN   - Random auth token for gateway
#   CALLBACK_URL    - URL to POST status updates back to our API
#   DEPLOYMENT_ID   - Our deployment record ID
# =============================================================================

LOGFILE="/var/log/openclaw-setup.log"
exec > >(tee -a "$LOGFILE") 2>&1

echo "[$(date -u +%FT%TZ)] Starting OpenClaw installation..."

# --- Status callback helper ---
report_status() {
  local status="$1"
  local message="${2:-}"
  curl -sf -X POST "__CALLBACK_URL__" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer __CALLBACK_SECRET__" \
    -d "{\"deploymentId\":\"__DEPLOYMENT_ID__\",\"status\":\"$status\",\"message\":\"$message\"}" \
    || true
}

report_status "installing" "Installing Node.js 22..."

# --- Install Node.js 22 ---
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
node --version
npm --version

report_status "installing" "Installing OpenClaw..."

# --- Install OpenClaw ---
npm install -g openclaw@latest

# --- Create OpenClaw user (don't run as root) ---
useradd -m -s /bin/bash openclaw
mkdir -p /home/openclaw/.openclaw/workspace
mkdir -p /home/openclaw/.openclaw/credentials

report_status "configuring" "Writing OpenClaw configuration..."

# --- Write openclaw.json ---
cat > /home/openclaw/.openclaw/openclaw.json << 'OCEOF'
__OPENCLAW_CONFIG_JSON__
OCEOF

# --- Set environment variables ---
cat > /home/openclaw/.openclaw/.env << 'ENVEOF'
__ENV_VARS__
ENVEOF

# --- Fix permissions ---
chown -R openclaw:openclaw /home/openclaw/.openclaw

report_status "configuring" "Starting OpenClaw gateway..."

# --- Create systemd service ---
cat > /etc/systemd/system/openclaw.service << 'SVCEOF'
[Unit]
Description=OpenClaw Gateway
After=network.target

[Service]
Type=simple
User=openclaw
EnvironmentFile=/home/openclaw/.openclaw/.env
ExecStart=/usr/bin/openclaw gateway --port 18789
Restart=always
RestartSec=5
WorkingDirectory=/home/openclaw

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable openclaw
systemctl start openclaw

# --- Wait for gateway to be healthy ---
echo "[$(date -u +%FT%TZ)] Waiting for gateway health..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:18789/ > /dev/null 2>&1; then
    echo "[$(date -u +%FT%TZ)] Gateway is healthy!"
    report_status "running" "OpenClaw gateway is healthy"
    exit 0
  fi
  sleep 2
done

echo "[$(date -u +%FT%TZ)] Gateway failed to start within 60 seconds"
report_status "error" "Gateway failed to start within 60 seconds"
exit 1
```

### Config Generator (Server-Side)

```typescript
// lib/openclaw.ts

interface OpenClawConfigParams {
  modelId: string;       // "anthropic/claude-opus-4-5"
  modelProvider: string; // "anthropic"
  channelType: string;   // "telegram" | "discord"
  gatewayToken: string;  // Random token for gateway auth
}

export function generateOpenClawConfig(params: OpenClawConfigParams): string {
  const config: Record<string, any> = {
    agents: {
      defaults: {
        model: { primary: params.modelId },
        workspace: "~/.openclaw/workspace",
      },
    },
    gateway: {
      port: 18789,
      bind: "lan",  // Bind to 0.0.0.0 so we can health-check remotely
      auth: { token: params.gatewayToken },
    },
    tools: { profile: "full" },
  };

  // Add channel config
  if (params.channelType === "telegram") {
    config.channels = {
      telegram: {
        mode: "bot",
        accounts: { main: { token: "${TELEGRAM_BOT_TOKEN}" } },
        dmPolicy: "open",
        allowFrom: ["*"],
      },
    };
  } else if (params.channelType === "discord") {
    config.channels = {
      discord: {
        mode: "bot",
        accounts: { main: { token: "${DISCORD_BOT_TOKEN}" } },
        dmPolicy: "open",
        allowFrom: ["*"],
      },
    };
  }

  return JSON.stringify(config, null, 2);
}

export function generateEnvVars(params: {
  modelProvider: string;
  modelApiKey: string;
  channelType: string;
  channelToken: string;
}): string {
  const lines: string[] = [];

  // Model API key
  const keyMap: Record<string, string> = {
    anthropic: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    google: "GOOGLE_API_KEY",
  };
  const envVar = keyMap[params.modelProvider];
  if (envVar) {
    lines.push(`${envVar}=${params.modelApiKey}`);
  }

  // Channel token
  if (params.channelType === "telegram") {
    lines.push(`TELEGRAM_BOT_TOKEN=${params.channelToken}`);
  } else if (params.channelType === "discord") {
    lines.push(`DISCORD_BOT_TOKEN=${params.channelToken}`);
  }

  return lines.join("\n");
}
```

### Cloud-Init Assembly

```typescript
// services/provisioner.ts

import { generateOpenClawConfig, generateEnvVars } from "@/lib/openclaw";
import { createDroplet, waitForDropletReady } from "@/lib/cloud";
import { randomBytes } from "crypto";

export async function provisionDeployment(params: {
  deploymentId: string;
  modelId: string;
  modelProvider: string;
  modelApiKey: string;
  channelType: string;
  channelToken: string;
  region: string;
}) {
  const gatewayToken = randomBytes(32).toString("hex");

  const openclawConfig = generateOpenClawConfig({
    modelId: params.modelId,
    modelProvider: params.modelProvider,
    channelType: params.channelType,
    gatewayToken,
  });

  const envVars = generateEnvVars({
    modelProvider: params.modelProvider,
    modelApiKey: params.modelApiKey,
    channelType: params.channelType,
    channelToken: params.channelToken,
  });

  // Read the user-data template and inject values
  let userData = CLOUD_INIT_TEMPLATE;
  userData = userData.replace("__OPENCLAW_CONFIG_JSON__", openclawConfig);
  userData = userData.replace("__ENV_VARS__", envVars);
  userData = userData.replace(/__CALLBACK_URL__/g, `${process.env.NEXTAUTH_URL}/api/webhooks/vm-status`);
  userData = userData.replace(/__CALLBACK_SECRET__/g, process.env.VM_CALLBACK_SECRET!);
  userData = userData.replace(/__DEPLOYMENT_ID__/g, params.deploymentId);

  const droplet = await createDroplet({
    name: `oc-${params.deploymentId.slice(0, 8)}`,
    region: params.region,
    size: "s-1vcpu-2gb",
    userData,
    tags: ["openclaw", `deploy:${params.deploymentId}`],
  });

  return {
    dropletId: droplet.dropletId,
    gatewayToken,
  };
}
```

### Health Check Strategy

Two complementary approaches:

1. **Callback from VM**: The cloud-init script POSTs status updates to `/api/webhooks/vm-status` as it progresses through installation stages.

2. **Polling from frontend**: The frontend polls `/api/deployments/[id]/status` every 3 seconds. The API route checks:
   - DB status (updated by VM callbacks)
   - If status is "running", optionally verifies by hitting `http://<vm-ip>:18789/` directly

```typescript
// Lightweight gateway health check
export async function checkGatewayHealth(ip: string, token: string): Promise<boolean> {
  try {
    const response = await fetch(`http://${ip}:18789/`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
```

---

## 10. Channel Integration (Telegram & Discord)

### Telegram Bot Setup

**What the user needs to do before deploying:**
1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Choose a name (e.g., "My AI Assistant")
4. Choose a username (must end in `bot`, e.g., `my_ai_openclaw_bot`)
5. Copy the bot token (e.g., `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

**What our system does with the token:**
- Writes it to `openclaw.json` under `channels.telegram.accounts.main.token`
- Sets `TELEGRAM_BOT_TOKEN` env var
- OpenClaw's grammY integration handles polling/webhook connection automatically
- Bot starts responding to messages within seconds of gateway startup

**Telegram Bot API details:**
- Base URL: `https://api.telegram.org/bot<token>/`
- Update methods: Long polling (default in OpenClaw) or Webhooks
- No special server-side setup needed - OpenClaw handles everything
- Users message the bot directly in Telegram to interact with their AI assistant

### Discord Bot Setup

**What the user needs to do before deploying:**
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application", name it
3. Go to "Bot" tab, click "Add Bot"
4. Copy the bot token
5. Under "Privileged Gateway Intents", enable:
   - Message Content Intent
   - Server Members Intent (optional)
6. Go to "OAuth2" > "URL Generator"
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Read Message History`, `Embed Links`
7. Copy the generated invite URL and add bot to their server

**What our system does with the token:**
- Writes it to `openclaw.json` under `channels.discord.accounts.main.token`
- Sets `DISCORD_BOT_TOKEN` env var
- OpenClaw's discord.js integration connects and starts listening
- Bot responds in DMs and/or server channels based on config

**Discord Bot API details:**
- Uses WebSocket gateway for real-time events
- Requires intents: `DirectMessages`, `GuildMessages`, `MessageContent`
- discord.js (used by OpenClaw) handles gateway connection, heartbeat, reconnection

### Channel Setup UX (Future Enhancement)

For v2, we could automate bot creation:
- **Telegram**: Not automatable (BotFather requires human interaction)
- **Discord**: Partially automatable via Discord OAuth2 - we could create the application and bot programmatically, but the user still needs to invite the bot to their server

For MVP, users provide their own bot tokens via a text input in the deploy form.

---

## 11. Infrastructure & Cost Analysis

### Per-Deployment Costs

| Component | Provider | Monthly Cost | Notes |
|-----------|----------|-------------|-------|
| VM (per user deployment) | DigitalOcean | $12/mo | s-1vcpu-2gb, per-second billing |
| VM (budget option) | Hetzner | ~$4.50/mo | CX22, EU only |
| Bandwidth | Included | $0 | 2 TB/mo included with DO droplet |
| Gateway port | N/A | $0 | Just a process on the VM |

### Platform Operating Costs

| Component | Provider | Monthly Cost | Notes |
|-----------|----------|-------------|-------|
| Frontend hosting | Vercel | $0 (Hobby) / $20 (Pro) | Free tier: 100 GB bandwidth |
| Database | Neon | $0 (Free) / $19 (Launch) | Free: 0.5 GB, 190 compute hours |
| Domain | Any registrar | ~$12/year | clawgent-ai.com or similar |
| DigitalOcean API | DigitalOcean | $0 | API usage is free |

### Cost Per User (Estimated)

| Scenario | Monthly Cost | Revenue Needed |
|----------|-------------|----------------|
| Free tier (1 VM) | $12 | N/A (loss leader) |
| Basic ($X/mo subscription) | $12 + platform overhead | $15-20/mo to be profitable |
| Pay-as-you-go (hourly) | ~$0.018/hr | $0.025/hr to be profitable |

### Scaling Considerations

- Each user gets their own VM (isolation by default)
- No shared infrastructure between users (simplifies security)
- Scaling is linear: 100 users = 100 VMs = ~$1,200/mo in infra
- DigitalOcean API rate limit: 5,000 requests/hour (sufficient for hundreds of deployments/day)

---

## 12. Deployment Pipeline

### Frontend (Vercel)

```
GitHub Push → Vercel Auto-Deploy
  main branch → Production (clawgent-ai.vercel.app)
  feature branches → Preview deployments
```

### Environment Variables (Vercel Dashboard)

| Variable | Scope | Description |
|----------|-------|-------------|
| `GOOGLE_CLIENT_ID` | All | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | All | Google OAuth secret |
| `NEXTAUTH_SECRET` | All | Random 32-byte hex for session encryption |
| `NEXTAUTH_URL` | Production | `https://clawgent-ai.vercel.app` |
| `DATABASE_URL` | All | Neon PostgreSQL connection string |
| `DIGITALOCEAN_API_TOKEN` | All | DO API token for provisioning |
| `DO_SSH_KEY_ID` | All | SSH key fingerprint registered with DO |
| `ENCRYPTION_KEY` | All | 32-byte hex for encrypting stored credentials |
| `VM_CALLBACK_SECRET` | All | Secret for VM → API status callbacks |

### CI/CD Checks (Future)

```yaml
# .github/workflows/ci.yml
- Lint (ESLint + Prettier)
- Type check (tsc --noEmit)
- Unit tests (Vitest)
- E2E tests (Playwright) - against preview deployment
- Deploy (automatic via Vercel)
```

---

## 13. MVP Implementation Plan

Based on the spec's MVP scope (no auth, no channel integration, just VM + OpenClaw gateway):

### MVP Scope Reminder

- Landing page on localhost
- "Deploy" button
- Backend provisions VM, installs OpenClaw
- Gateway comes up healthy on `ws://<VM_IP>:18789`
- Total time < 60 seconds
- Verified with Playwright tests

### MVP Tech Stack (Minimal)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, Tailwind CSS |
| Backend | Next.js API routes |
| Database | SQLite via better-sqlite3 (localhost only, no need for Postgres yet) |
| Cloud | DigitalOcean API (direct fetch calls) |
| Auth | None (MVP) |
| Testing | Playwright + Vitest |

### MVP File Structure

```
clawgent-ai/
  app/
    layout.tsx
    page.tsx                    # Landing page with Deploy button
    api/
      deploy/
        route.ts                # POST - create VM
      deployments/
        [id]/
          status/
            route.ts            # GET - poll status
  lib/
    cloud.ts                    # DigitalOcean API wrapper
    openclaw.ts                 # Config generator
    db.ts                       # SQLite for deployment tracking
  scripts/
    cloud-init.sh               # User-data template
  tests/
    e2e/
      deploy.spec.ts            # Playwright E2E test
    unit/
      openclaw-config.test.ts   # Config generator tests
      cloud.test.ts             # Cloud API wrapper tests
  .env.local                    # Local env vars (gitignored)
  .env.example                  # Template
```

### MVP Implementation Sequence

1. **Set up Next.js project** with Tailwind
2. **Build landing page** with Deploy button and status display
3. **Implement `/api/deploy`** - creates DO droplet with cloud-init
4. **Write cloud-init script** - installs Node 22, installs OpenClaw, starts gateway
5. **Implement `/api/deployments/[id]/status`** - polls DO API + gateway health
6. **Add callback webhook** `/api/webhooks/vm-status` for VM to report status
7. **Write E2E test** - Playwright clicks deploy, waits for gateway health
8. **Write unit tests** - config generator, API wrapper

### Post-MVP Roadmap

1. **Auth**: Add Google OAuth with NextAuth.js
2. **Database**: Migrate from SQLite to Neon PostgreSQL
3. **Channels**: Add Telegram/Discord bot token input + channel config
4. **Model selection**: UI for choosing Claude/GPT/Gemini
5. **Dashboard**: List user's deployments, restart, destroy
6. **Encryption**: Encrypt stored credentials
7. **Multi-region**: Let users choose VM region
8. **Hetzner support**: Add as alternative (cheaper) provider
9. **Monitoring**: VM health monitoring, auto-restart on failure
10. **Billing**: Stripe integration for subscription/pay-as-you-go

---

## Appendix A: OpenClaw CLI Commands Reference

| Command | Purpose |
|---------|---------|
| `openclaw onboard --install-daemon` | Interactive setup wizard + daemon install |
| `openclaw gateway --port 18789` | Start gateway (foreground) |
| `openclaw doctor` | Validate config, diagnose issues |
| `openclaw doctor --fix` | Auto-repair config issues |
| `openclaw update --channel stable` | Update to latest stable |
| `openclaw pairing approve <channel> <code>` | Approve DM pairing request |

## Appendix B: Environment Variable Reference

| Variable | Used By | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | OpenClaw on VM | Anthropic API key for Claude models |
| `OPENAI_API_KEY` | OpenClaw on VM | OpenAI API key for GPT models |
| `GOOGLE_API_KEY` | OpenClaw on VM | Google API key for Gemini models |
| `TELEGRAM_BOT_TOKEN` | OpenClaw on VM | Telegram bot token from BotFather |
| `DISCORD_BOT_TOKEN` | OpenClaw on VM | Discord bot token from Developer Portal |
| `DIGITALOCEAN_API_TOKEN` | Our API | DigitalOcean API token for VM provisioning |
| `ENCRYPTION_KEY` | Our API | AES-256 key for encrypting stored credentials |
| `VM_CALLBACK_SECRET` | VM → Our API | Shared secret for VM status callbacks |

## Appendix C: Security Considerations

1. **API keys in transit**: User submits API keys over HTTPS only. Keys are encrypted before DB storage.
2. **API keys on VM**: Stored in `/home/openclaw/.openclaw/.env` with `600` permissions, owned by `openclaw` user.
3. **Gateway auth**: Every VM gets a unique gateway token. Gateway rejects unauthenticated WebSocket connections.
4. **VM isolation**: Each user gets their own VM. No shared compute, no shared network.
5. **OpenClaw DM policy**: Default to `open` + `allowFrom: ["*"]` for simplicity in MVP. Users can restrict later.
6. **SSH access**: Platform SSH key on all VMs for emergency access. User does not get SSH access in MVP.
7. **Cleanup**: Destroyed deployments trigger `destroyDroplet()` - VM is permanently deleted.

## Appendix D: Open Questions Resolved

| Question | Answer |
|----------|--------|
| Which cloud provider for VMs? | DigitalOcean (primary), Hetzner (future cost optimization) |
| How to verify gateway health remotely? | HTTP GET to `http://<ip>:18789/` + cloud-init callback to our API |
| What minimal OpenClaw config for working gateway? | `agents.defaults.model.primary` + `gateway.port` + `gateway.auth.token` |
| How to handle VM cleanup/teardown? | `DELETE /api/deployments/[id]` calls `destroyDroplet(vmId)` via DO API |
| How does OpenClaw bind for remote access? | Set `gateway.bind: "lan"` (0.0.0.0) instead of default `loopback` |
| How to pass config without interactive onboard? | Write `openclaw.json` directly + set env vars + start `openclaw gateway` |
