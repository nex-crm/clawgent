# Clawgent - Product Specification

> Last updated: 2026-02-09 (Iteration 10 — Ghost instance bug fixed, CI/CD pipelines created, ARM64 migration, full deployment LIVE at https://clawgent.ai)

## 1. What is Clawgent?

Clawgent is a web app that lets anyone deploy isolated [OpenClaw](https://github.com/openclaw) instances with one click. Each deploy spins up an isolated Docker container running the OpenClaw gateway, accessible via a unique URL path `/i/{id}/`.

**Inspired by**: openclaw.com ecosystem
**Our repo**: nex-crm/clawgent (GitHub, private)
**Local path**: /Users/najmuzzaman/Documents/clawgent
**Domain**: clawgent.ai (AWS deployment planned)

## 2. Core User Flow (Current MVP)

The UI uses a retro arcade visual aesthetic (Street Fighter 2 / CPS-1 / SNES-inspired) with CRT scanlines, pixel fonts (Press Start 2P), and a CPS-1 authentic color palette — but all labels use clear agent/deployment terminology (no game jargon). The flow is a 4-screen state machine:

1. **Start Screen** (`http://localhost:3001`) — SNES-style select menu with two options:
   - "DEPLOY OPENCLAW IN A MIN" → triggers auth (if needed) then goes to agent select
   - "STAY IRRELEVANT" → snarky joke response with shake animation, snaps back to option 1
   - Keyboard navigable (arrow keys + Enter)
   - If authenticated with running instance: shows instance management panel with agents roster
2. **Agent Select** — SF2 character select screen with 3x3 grid + preview panel:
   - 9 AI personas with per-persona neon colors, emoji icons, skill counts
   - Grid has thick yellow frame, L-shaped corner cursors on active cell
   - Preview panel shows persona name, tagline (pixel font), model, skills count, skill pills (max 4 shown)
   - Fixed-height preview panel (480px) — no layout shift on hover
   - Keyboard nav (arrow keys for 3x3 grid, Enter to select, Esc to go back)
   - "SKIP TEMPLATE" option for blank instance
3. **API Key Entry** — Select model provider (Claude Sonnet 4.5 / Gemini 3 Flash / GPT-5.2), enter API key (masked password input)
4. **Deploy** — Triggers POST /api/deploy, shows deployment progress with health-bar animation
5. **Active Agents** — Instance panel showing agents roster with add/remove, deep links
6. **Open Dashboard** — Navigates to `/i/{id}/` → proxy serves OpenClaw dashboard
7. **Destroy when done** — Click "Destroy" to stop and remove container

Full persona config is injected into the container after gateway health check. This includes: SOUL.md (role, expertise, personality), IDENTITY.md (name, emoji, vibe), workspace skills (3 SKILL.md files per persona in `skills/<name>/SKILL.md`), HEARTBEAT.md (persona-specific periodic checks), heartbeat interval config, and BOOTSTRAP.md removal (skips first-run wizard). Definitions live in `app/src/lib/personas.ts`. Skill mapping sourced from `docs/openclaw-skills-by-persona.md`.

**NAMING RULE**: Keep SF2 visual style (CRT scanlines, pixel font, neon colors, thick grid borders). Remove ALL game jargon (no Fighter, Insert Coin, Fight!, K.O., Winner!, High Scores, Game Over, Round, Press Start, Play, New Game).

## 3. Technical Architecture (Current)

### Stack
- **Frontend**: Next.js 16.1.6 (App Router), React 19, Tailwind v4, TypeScript
- **Auth**: WorkOS AuthKit Magic Auth (`@workos-inc/authkit-nextjs` v2.13.0), dev-mode bypass
- **Storage**: SQLite via better-sqlite3 (`app/data/clawgent.db`, WAL mode)
- **Custom server**: `app/server.ts` — raw TCP WebSocket proxy wrapping Next.js
- **Dev command**: `npm run dev` (runs `tsx server.ts`) on port 3001
- **Container runtime**: Docker (local)
- **OpenClaw image**: `clawgent-openclaw`

### Architecture Diagram

```
Browser (localhost:3001)
   │
   ├── HTTP ──────────────────────────────────────────────┐
   │   ├─ GET  /                     → Next.js landing page (public)
   │   ├─ GET  /auth/callback        → WorkOS AuthKit callback (public)
   │   ├─ GET  /api/user             → current user + their instance (auth)
   │   ├─ POST /api/deploy           → creates Docker container (auth, 1/user)
   │   ├─ GET  /api/deploy           → lists all instances (auth)
   │   ├─ GET  /api/instances/:id    → instance detail + logs (auth)
   │   ├─ DELETE /api/instances/:id  → destroy container (auth, owner only)
   │   ├─ GET  /api/instances/:id/agents    → list agents (auth)
   │   ├─ POST /api/instances/:id/agents    → add agent (auth)
   │   ├─ DELETE /api/instances/:id/agents/:agentId → remove agent (auth)
   │   ├─ GET  /api/instances/:id/channels → list channels (auth)
   │   ├─ POST /api/instances/:id/channels → connect channel (auth)
   │   ├─ DELETE /api/instances/:id/channels/:type → disconnect channel (auth)
   │   ├─ GET  /api/status           → Docker + instance count (public)
   │   │
   │   └─ GET  /i/{id}/              → 302 redirect (adds ?token=)
   │      GET  /i/{id}/?token=xxx    → reverse proxy to container
   │      GET  /i/{id}/assets/...    → reverse proxy (assets)
   │      GET  /i/{id}/chat?...      → reverse proxy (SPA routes)
   │
   └── WebSocket ─────────────────────────────────────────┐
       ws://localhost:3001/i/{id}/    → raw TCP proxy to container
       ws://localhost:3001/_next/...  → Next.js HMR (delegated)

Each Docker container:
   Name:    clawgent-{id}
   Volume:  clawgent-data-{id}
   Port:    {19000+}:18789
   Image:   clawgent-openclaw
   Env:     OPENCLAW_GATEWAY_TOKEN={random_token}
   Cmd:     openclaw gateway --port 18789 --verbose --allow-unconfigured --bind lan
```

### Key Implementation Details

**Custom Server (server.ts)**:
- Wraps Next.js with `createServer` from `http`
- Intercepts `server.on('upgrade')` BEFORE Next.js can register its own handler
- Captures Next.js's lazy auto-handler via `server.on` monkey-patch
- Routes `/i/{id}/` WS upgrades to Docker containers via raw TCP proxy
- Delegates all other WS upgrades (HMR) to Next.js via `app.getUpgradeHandler()`

**HTTP Proxy (proxy.ts)**:
- Next.js API route handlers at `/i/[id]/route.ts` and `/i/[id]/[...path]/route.ts`
- Forwards HTTP requests to `http://127.0.0.1:{port}`
- Root path: redirects to add `?token=` (OpenClaw reads natively from URL)
- Root HTML: injects `<script>` to set `gatewayUrl` in localStorage (WS proxy path)
- Clears stale `openclaw-device-identity-v1` when `gatewayUrl` changes
- Deletes `Content-Length` header when HTML is modified (prevents truncation)

**WS Proxy (raw TCP)**:
- `net.connect()` to container port
- Rebuilds HTTP upgrade request with modified path + `?token=`
- Strips `sec-websocket-extensions` to avoid compression negotiation
- Pipes sockets bidirectionally

**Auth (WorkOS AuthKit)**:
- `app/src/middleware.ts` protects API routes; allows `/`, `/api/status`, `/auth/callback`, `/i/*`
- `withAuth({ ensureSignedIn: true })` in API routes returns `UserInfo` with `user.id`
- One instance per user enforced in deploy API (returns 409 if user already has an instance)
- Instance destroy requires ownership (userId match)
- Dev-mode bypass: when WorkOS env vars missing, uses `dev-user-local` as userId

**State Management**:
- SQLite-backed InstanceStore with Map-like API (`app/src/lib/instances.ts`)
- Periodic flush for dirty instances, WAL mode for concurrency
- `reconcileWithDocker()` recovers state from Docker containers after full restart
- Extracts tokens from running containers via `docker exec env`
- Instances tagged with `userId` for ownership tracking

## 4. Known Issues

### FIXED: Destroyed instance reappears after page refresh

**Status**: FIXED (2026-02-09). Root cause: `reconcileWithDocker()` was using `docker ps -a` (all containers including stopped/removing ones) and re-adding instances from containers that were in the process of being destroyed. Fixed by changing to `docker ps` (only running containers) and adding DB check to prevent overwriting existing records. Race condition eliminated.

### FIXED: First deploy — agent not detected on home screen

**Status**: FIXED (2026-02-09). Root cause: OpenClaw 2026.2.x changed API response structure for `openclaw agents list --json`. Frontend was looking for `name`/`emoji` fields, but OpenClaw now returns `identityName`/`identityEmoji`. Updated frontend to use correct field names. Bug resolved.

### Slack integration not working

**Status**: Active issue. Slash command returns dispatch_failed error. Needs:
1. Slash command created in Slack app
2. Event Subscriptions enabled
3. Proper OAuth scopes configured

Integrations currently hidden behind SHOW_INTEGRATIONS = false flag until fixed.

### FIXED: "pairing required" (1008) in all browsers

**Status**: Fixed. Two issues were resolved:

1. **Device pairing auto-approval**: OpenClaw requires device pairing even with `--allow-unconfigured`. Fix: `startPairingAutoApprover()` polls `pending.json` every 2s via `docker exec`.

2. **localStorage injection**: Injects both `gatewayUrl` AND `token` on ALL proxied HTML pages, clears all `openclaw*` keys.

### Other
- No auto-expiry for instances (permanent, one per user)
- Legacy `simpleclaw-*` containers/volumes may exist on dev machines — clean with `docker rm -f` and `docker volume rm`
- deploy.sh doesn't pass SSH key — manual rsync needed or update script
- WorkOS production credentials not yet on EC2 (dev-mode bypass active)

## 5. What's Working

- [x] Landing page with SNES-style select menu (Deploy / Stay Irrelevant)
- [x] SF2 character select grid (3x3, keyboard nav, preview panel, SNES-authentic styling)
- [x] Character sprites fill grid cells (object-fit: cover + scale(1.4), name label strip)
- [x] Deploy creates Docker container, shows progress with health bar
- [x] Instance reaches "running" state (health check passes)
- [x] Dashboard link navigates to `/i/{id}/`
- [x] Proxy serves OpenClaw HTML + all assets (no 404s)
- [x] `?token=` redirect provides auth to OpenClaw natively
- [x] `gatewayUrl` injected into localStorage via `<script>` in HTML
- [x] WebSocket connects through raw TCP proxy (zero WS errors)
- [x] Destroy stops and removes container + volume
- [x] Docker reconciliation recovers state after server restart (ghost instance bug fixed)
- [x] WorkOS Magic Auth (dev-mode bypass when unconfigured)
- [x] One instance per user (deploy returns 409 for duplicate)
- [x] Auth-aware frontend (sign in → deploy → manage → sign out)
- [x] Persona config injection (SOUL.md, IDENTITY.md, skills, HEARTBEAT.md, BOOTSTRAP.md removal)
- [x] 9 personas including GTM Engineer (6 skills) and Marketing Pro (25 skills)
- [x] Multi-agent support (add/remove agents to running instances)
- [x] Agent deep linking via `?session=agent:{agentId}:main`
- [x] SQLite persistence (survives restarts)
- [x] Retro arcade sound engine (16 Web Audio API effects + mute toggle)
- [x] Comprehensive e2e test suite (10 sections: status, auth, validation, lifecycle, multi-agent, UI smoke, cleanup)
- [x] AWS deployment infrastructure (Dockerfile, nginx, PM2, setup/deploy scripts, deployment guide)
- [x] AWS EC2 deployment LIVE (i-04df8a4321868b068, t4g.micro ARM64, EIP: 100.31.178.189, HTTPS working)
- [x] Channel integrations backend (Slack/Telegram/Discord API complete, config injection via openclaw.json)
- [x] Channel integrations frontend (full connect/disconnect flow wired, hidden behind SHOW_INTEGRATIONS flag)
- [x] Slack User OAuth Token support (optional xoxp-... token, slashCommand + commands config)
- [x] Setup guide links for each channel (docs.openclaw.ai)
- [x] Power-ups screen (skippable, 9 integrations, status indicators on home screen)
- [x] Nex.ai branding (logo moved to right under CLAWGENT title, UTM link, OG meta tags)
- [x] Subtitle updated ("DEPLOY OPENCLAW UNDER A MINUTE. / GET IT GOING ON DAY-1 WITH PRE-BUILT AGENTS")
- [x] Discord invite link (top-right, fixed, https://discord.gg/YV9pGMpFQJ)
- [x] Character sprites (9 compressed PNGs in public/sprites/, all personas covered including GTM Engineer)
- [x] Agent roster sprites on home screen (character images for all agents)
- [x] Consolidated screens (shared renderPersonaSelect() for deploy + add-agent)
- [x] Product audit complete (PM agent, 7/10 launch readiness, all blockers resolved)
- [x] CI/CD pipelines (.github/workflows/ci.yml + cd.yml)
- [x] 2GB swap file on EC2 (prevents OOM during builds)

## 6. File Map

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Project guide for Claude Code (living document) |
| `app/server.ts` | Custom HTTP server, raw TCP WS proxy, Next.js HMR delegation |
| `app/src/middleware.ts` | WorkOS AuthKit middleware (dev-mode bypass) |
| `app/src/app/page.tsx` | Multi-screen arcade frontend (~1700 lines, integrations wired) |
| `app/src/app/layout.tsx` | Root layout with AuthKitProvider + Press Start 2P font |
| `app/src/app/globals.css` | SNES-authentic retro arcade CSS design system (~1150 lines) |
| `app/src/app/actions/auth.ts` | Server actions for sign-in URL and sign-out |
| `app/src/app/auth/callback/route.ts` | WorkOS AuthKit callback handler |
| `app/src/app/api/user/route.ts` | Returns current user info + their instance |
| `app/src/app/api/deploy/route.ts` | POST: create instance (auth, 1/user), GET: list instances |
| `app/src/app/api/instances/[id]/route.ts` | GET: detail+logs, DELETE: destroy (owner only) |
| `app/src/app/api/instances/[id]/agents/route.ts` | GET: list agents, POST: add agent |
| `app/src/app/api/instances/[id]/agents/[agentId]/route.ts` | DELETE: remove agent |
| `app/src/app/api/instances/[id]/channels/route.ts` | GET: list channels, POST: connect channel |
| `app/src/app/api/instances/[id]/channels/[channelType]/route.ts` | DELETE: disconnect channel |
| `app/src/app/api/status/route.ts` | Docker availability + instance count (public) |
| `app/src/app/i/[id]/proxy.ts` | Shared HTTP reverse proxy logic, HTML injection |
| `app/src/app/i/[id]/route.ts` | Root path proxy handler |
| `app/src/app/i/[id]/[...path]/route.ts` | Catch-all sub-path proxy |
| `app/src/lib/instances.ts` | InstanceStore (SQLite-backed), Docker orchestration, reconcileWithDocker fix |
| `app/src/lib/db.ts` | SQLite database module (WAL mode) |
| `app/src/lib/personas.ts` | 9 persona configs with skills, SOUL.md, IDENTITY.md |
| `app/src/lib/agent-config.ts` | Shared `configureAgentPersona()` for deploy + add-agent |
| `app/src/lib/channels.ts` | Channel types, validation, config builders (Slack/Telegram/Discord) with slashCommand + commands + userToken |
| `app/src/lib/auth-config.ts` | WorkOS config flag, DEV_USER_ID |
| `app/src/lib/use-auth-safe.ts` | Client auth hook (works with/without AuthKitProvider) |
| `app/src/lib/sounds.ts` | Retro arcade sound engine (16 Web Audio API effects) |
| `public/sprites/*.png` | 9 compressed persona sprite images (all personas covered) |
| `public/sprites/character-9.png` | GTM Engineer sprite |
| `public/nex-logo.svg` | Nex.ai logo reference |
| `app/.env.example` | WorkOS + app env var template |
| `app/test-e2e.mjs` | Comprehensive Playwright e2e test (10 sections) |
| `app/Dockerfile` | Production Docker image |
| `app/next.config.ts` | `skipTrailingSlashRedirect: true` |
| `.github/workflows/ci.yml` | CI pipeline (lint, typecheck, build on PR) |
| `.github/workflows/cd.yml` | CD pipeline (auto-deploy to EC2 on push to main) |
| `deploy/setup.sh` | EC2 environment provisioning (ARM64 notes, swap file) |
| `deploy/deploy.sh` | Application deployment automation (needs SSH key fix) |
| `deploy/ecosystem.config.js` | PM2 process management config |
| `deploy/nginx.conf` | Nginx reverse proxy with WS support + SSL + rate limiting |
| `docs/deployment-aws.md` | AWS deployment guide (updated for new instance) |
| `docs/product-requirements.md` | Full PRD |
| `docs/openclaw-skills-by-persona.md` | Complete skill library (9 personas) |

## 7. MVP Scope

### What's IN
- SNES-authentic retro arcade visual aesthetic (CPS-1 palette, pixel font, CRT scanlines, thick grid borders)
- SNES-style start menu (Deploy / Stay Irrelevant with snarky responses)
- SF2 character select grid with preview panel (fixed-height, no layout shift)
- Auth-aware 4-screen flow: Start → Agent Select (9 personas) → API Key → Deploy
- WorkOS Magic Auth (dev-mode bypass when unconfigured)
- 9 AI persona templates with recommended models, skills, and neon colors
- Multi-agent per instance (add/remove agents, deep linking)
- Persona-specific Docker config injection after health check
- Model provider selection (Claude Sonnet 4.5, Gemini 3 Flash, GPT-5.2)
- API key input (masked password field, required before deploy)
- One-click deploy (Docker containers) with progress animation
- Full reverse proxy (HTTP + WebSocket)
- SQLite persistence (survives restarts)
- Arcade sound engine (16 effects + mute toggle)
- Comprehensive e2e test suite
- AWS deployment infrastructure (Nginx, PM2, Let's Encrypt, deploy scripts)

### What's NOT IN
- No channel integration UI yet (backend API complete, frontend pending)
- No power-ups UI yet (design ready, implementation pending)
- No pricing/billing
- AWS EC2 deployment complete, DNS + SSL pending

## 8. Open Items (Priority Order)

### Critical (Post-Launch)
1. **Fix Slack integration** — Slash command dispatch_failed (needs slash command created in Slack app + Event Subscriptions + scopes). Integrations currently hidden (SHOW_INTEGRATIONS = false).
2. **Fix deploy.sh SSH** — Doesn't pass `-i ~/.ssh/clawgent-key.pem`, needs update or SSH config entry
3. **WorkOS production credentials on EC2** — Currently using dev-mode auth bypass

### High Priority
4. ~~**Wire power-ups frontend to backend**~~ — DONE: Connect/disconnect UI wired to channel API (hidden behind SHOW_INTEGRATIONS flag)
5. ~~**GTM Engineer sprite**~~ — DONE: character-9.png added
6. **OG image** — Screenshot of character select for link previews
7. **Build clawgent-openclaw image on new EC2** — ARM64 instance needs fresh image build

### Medium Priority (Future)
8. **E2E tests for channels** — Test Slack/Telegram/Discord integrations
9. **E2E tests for power-ups** — Test activation + status indicators
10. **CI/CD refinement** — CD pipeline needs SSH key management

## 9. OpenClaw Key Facts

- **GitHub stars**: 68,000+
- **License**: MIT
- **Requirements**: Node >= 22
- **Install**: `npm i -g openclaw`
- **Architecture**: Local-first WebSocket control plane on `ws://127.0.0.1:18789`
- **Auth**: `OPENCLAW_GATEWAY_TOKEN` env var + `?token=` URL param
- **Device pairing**: Crypto.subtle key pairs, challenge-response protocol
- **Dashboard**: Web component (`<openclaw-app>`), Shadow DOM, relative asset paths
- **Settings storage**: `localStorage["openclaw.control.settings.v1"]`
- **Device identity**: `localStorage["openclaw-device-identity-v1"]` + separate role token store
