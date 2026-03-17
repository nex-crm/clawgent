# CLAUDE.md

## What is Clawgent?

Clawgent is a one-click deployment platform for [OpenClaw](https://openclaw.ai) instances. Users pick an agent template (CRM, enrichment, sales, help desk, etc.), choose an LLM provider (Anthropic/Google/OpenAI), enter an API key, and get a running instance in ~60 seconds. Each user gets one persistent instance with support for multiple agents. Deployment is available via web UI or WhatsApp.

Live at [clawgent.ai](https://clawgent.ai).

## Tech Stack

- **Frontend**: Next.js 16, React 19, Tailwind v4, TypeScript
- **Backend**: Custom Node server (`app/server.ts`) with raw TCP WebSocket proxy, Next.js API routes
- **Database**: SQLite via better-sqlite3 (WAL mode) -- single file at `data/clawgent.db`
- **Auth**: WorkOS AuthKit (Magic Auth)
- **Analytics**: PostHog (client + server)
- **Containers**: Docker -- one container per user instance, ports 19000+
- **Infra**: AWS EC2 (t4g.large), Nginx, Let's Encrypt, PM2
- **IaC**: Terraform (in `terraform/`)

## Repository Structure

```
app/                  # Next.js application (all dev commands run from here)
  server.ts           # Custom server: HTTP + WebSocket proxy
  src/app/api/        # API routes: deploy, instances, user, status, whatsapp, llm-proxy
  src/lib/            # Shared libraries (DB, Docker, auth helpers)
  plugins/            # Nex plugin source
deploy/               # Deployment scripts, Nginx config, PM2 ecosystem
terraform/            # AWS infrastructure (EC2, S3, monitoring)
scripts/              # Utility scripts
```

## Key Architectural Patterns

- **Custom server intercepts WebSocket upgrades** before Next.js, routing instance traffic (`/i/{id}/`) directly to Docker containers via raw TCP. HMR WebSockets are delegated to Next.js.
- **One Docker container per user** (`clawgent-{id}`), each with a persistent data volume.
- **HTTP reverse proxy**: requests to `/i/{id}/` are proxied to the corresponding container.
- **API routes** handle deployment, instance CRUD, agent management, and WhatsApp webhooks.
- **Middleware** (`src/middleware.ts`) handles auth gating and routing.

## Development

```bash
cd app
cp .env.example .env.local
npm install
npm run dev          # http://localhost:3001
```

Key commands (all from `app/`):
- `npm run dev` -- full dev server with WebSocket proxy
- `npm run lint` -- ESLint
- `npx tsc --noEmit` -- type check
- `npm run build` -- production build (checkpoints SQLite WAL first)

## Review Guidance

- **Security-sensitive areas**: `src/app/api/deploy/` (container creation), `src/app/api/whatsapp/` (public webhook, rate-limited), `server.ts` (proxy logic), `src/lib/` (DB queries, Docker commands).
- **Environment variables**: `NEXT_PUBLIC_*` vars are baked at build time. See `app/.env.example` for the full list.
- **Database migrations**: SQLite schema changes affect the single `data/clawgent.db` file. No migration framework -- changes are applied inline.
- **Docker operations**: Deploy and instance management shell out to Docker CLI. Watch for injection risks in any user-provided input passed to commands.
- **WhatsApp flow**: Plivo webhooks hit `/api/whatsapp`. The conversation state machine lives in the API route handler.
