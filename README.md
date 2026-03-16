# Clawgent

[![CI](https://github.com/nex-crm/clawgent/actions/workflows/ci.yml/badge.svg)](https://github.com/nex-crm/clawgent/actions/workflows/ci.yml)
[![CD](https://github.com/nex-crm/clawgent/actions/workflows/cd.yml/badge.svg)](https://github.com/nex-crm/clawgent/actions/workflows/cd.yml)

One-click [OpenClaw](https://openclaw.ai) instance deployment platform with a retro arcade UI.

**Live at [clawgent.ai](https://clawgent.ai)**

---

## What is Clawgent?

Clawgent eliminates the friction of deploying OpenClaw. Pick an agent template, choose your LLM provider, enter an API key, and get a fully configured instance running in ~60 seconds -- pre-loaded with identity, skills, and personality.

- **7 agent templates** -- purpose-built personas that replace entire SaaS categories
- **Multi-agent** -- run multiple agents per instance, each with their own identity
- **BYOK** -- bring your own API key for Claude, Gemini, or GPT
- **Deploy from anywhere** -- web UI or WhatsApp
- **One instance per user**, always on, no TTL

---

## Agent Templates

| | Agent | What it does | Replaces |
|---|---|---|---|
| :handshake: | **CRM Agent** | Pipeline, contacts, deals -- your CRM that talks back | HubSpot CRM, Salesforce, Pipedrive |
| :mag: | **Enrichment Engine** | Turns raw leads into qualified prospects | Clay, Clearbit, ZoomInfo |
| :dart: | **Sales Engagement** | Outreach sequences, follow-ups, call prep | Apollo, Salesloft, Outreach |
| :shield: | **Help Desk** | Tickets, SLAs, customer support analytics | Zendesk, Intercom, Freshdesk |
| :green_heart: | **Customer Success** | Health scores, retention, churn prevention | Gainsight, Totango, ChurnZero |
| :loudspeaker: | **Marketing Automation** | Campaigns, segments, email, SEO | ActiveCampaign, Mailchimp, HubSpot Marketing |
| :bar_chart: | **Revenue Intelligence** | Pipeline analytics, forecasting, deal coaching | Clari, InsightSquared, Gong |

Each template injects a SOUL (personality), IDENTITY (name/emoji), skills, and bootstrap scripts into the OpenClaw instance.

---

## How It Works

```
1. Pick a persona (or start from scratch)
2. Choose your LLM provider (Anthropic / Google / OpenAI)
3. Enter your API key
4. Instance deploys in ~60 seconds
5. Chat with your agent in the browser -- or add more agents
```

**WhatsApp deployment**: Text the Clawgent bot and deploy an agent entirely through WhatsApp. Same flow, no browser needed. The bot walks you through persona selection, provider choice, and API key entry, then notifies you when your instance is live.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16, React 19, Tailwind v4, TypeScript |
| Backend | Custom server (`server.ts`) with raw TCP WebSocket proxy |
| Database | SQLite via better-sqlite3 (WAL mode) |
| Auth | WorkOS AuthKit (Magic Auth) |
| Analytics | PostHog |
| Containers | Docker -- one container per user instance |
| Infra | AWS EC2 (t4g.large), Nginx, Let's Encrypt, PM2 |

---

## Getting Started

### Prerequisites

- Node.js v25+
- Docker daemon running
- (Optional) WorkOS account for auth -- dev mode works without it

### Setup

```bash
cd app
cp .env.example .env.local   # edit with your credentials
npm install
npm run dev                   # http://localhost:3001
```

### Commands

All commands run from the `app/` directory.

| Command | Description |
|---------|-------------|
| `npm run dev` | Development server (port 3001) |
| `npm run dev:next` | Next.js dev server only (no custom WS proxy) |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | Type check |

### Environment Variables

See [`app/.env.example`](app/.env.example) for the full list. Key groups:

| Variable | Purpose |
|----------|---------|
| `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD` | Auth (optional in dev) |
| `PLIVO_AUTH_ID`, `PLIVO_AUTH_TOKEN`, `PLIVO_WHATSAPP_NUMBER` | WhatsApp integration |
| `NEXT_PUBLIC_POSTHOG_KEY` | Analytics |

`NEXT_PUBLIC_*` vars are baked at build time -- changing them requires `npm run build`.

---

## Architecture

```
Browser (clawgent.ai)
  |
  +-- HTTP --> server.ts --> Next.js
  |   +-- /               Landing page (public)
  |   +-- /api/deploy     Create Docker container (auth, 1/user)
  |   +-- /api/instances  Instance CRUD + agents + channels
  |   +-- /api/user       Current user + their instance
  |   +-- /api/status     Docker health + instance count (public)
  |   +-- /api/whatsapp   Plivo webhook (public, rate-limited)
  |   +-- /i/{id}/        HTTP reverse proxy to container
  |
  +-- WebSocket --> server.ts intercepts upgrade
      +-- /i/{id}/        Raw TCP proxy to Docker container
      +-- _next/...       Delegated to Next.js HMR
```

Each instance runs in its own Docker container (`clawgent-{id}`) on port `19000+`, with a persistent data volume. The custom server intercepts WebSocket upgrades before Next.js, routing instance traffic directly to containers via raw TCP.

---

## CI/CD

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **CI** (`ci.yml`) | PRs, push to main | Lint, type check, build |
| **CD** (`cd.yml`) | Push to main | Deploy to EC2 via SSM (backup DB, sync S3, build, PM2 reload) |
| **Upgrade OpenClaw** (`upgrade-openclaw.yml`) | Weekly (Sun 04:00 UTC), manual | Pull new image, upgrade containers, inject config, re-register agents |
| **Update Nex Plugin** (`update-nex-plugin.yml`) | Weekly (Wed 04:00 UTC), manual | Build plugin from source, deploy to all containers |

See [`docs/deployment-aws.md`](docs/deployment-aws.md) for the full deployment guide.

---

## Documentation

| Doc | Topic |
|-----|-------|
| [`docs/deployment-aws.md`](docs/deployment-aws.md) | AWS EC2 deployment guide |
| [`docs/spec.md`](docs/spec.md) | Product specification |
| [`docs/whatsapp-ux.md`](docs/whatsapp-ux.md) | WhatsApp conversation flow |
| [`docs/whatsapp-security.md`](docs/whatsapp-security.md) | WhatsApp security assessment |
| [`docs/soc2-compliance-report.md`](docs/soc2-compliance-report.md) | SOC 2 compliance |
| [`docs/security-hardening.md`](docs/security-hardening.md) | Security hardening |
| [`docs/penetration-test-report.md`](docs/penetration-test-report.md) | Penetration test findings |

---

## License

Private. All rights reserved.
