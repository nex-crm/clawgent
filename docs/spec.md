# Clawgent - Product Specification

> Last updated: 2026-02-08 (Iteration 6 — GTM Engineer persona, 25 marketing skills, WorkOS auth, persona injection)

## 1. What is Clawgent?

Clawgent is a web app that lets anyone deploy isolated [OpenClaw](https://github.com/openclaw) instances with one click. Each deploy spins up an isolated Docker container running the OpenClaw gateway, accessible via a unique URL path `/i/{id}/`.

**Inspired by**: openclaw.com ecosystem
**Our repo**: nex-crm/clawgent (GitHub, private)
**Local path**: /Users/najmuzzaman/Documents/clawgent

## 2. Core User Flow (Current MVP)

The UI uses a retro arcade visual aesthetic (Street Fighter 2-inspired) with CRT scanlines, pixel fonts (Press Start 2P), and neon colors — but all labels use clear agent/deployment terminology (no game jargon). The flow is a 4-screen state machine:

1. **Start Screen** (`http://localhost:3001`) — Auth-aware: unauthenticated users see "SIGN IN WITH GOOGLE"; authenticated users with no instance see "DEPLOY OPENCLAW"; authenticated users with an active instance see "OPEN DASHBOARD"
2. **Agent Select** — Pick one of 9 AI personas, each with recommended model, skills, and neon color (SF2-style character select grid):
   - Marketing Pro (25 skills from coreyhaines31/marketingskills), Sales Assistant, Lead Gen Machine, Dev Copilot, Support Agent, Ops Automator, Founder Sidekick, Data Analyst, GTM Engineer (6 skills from josephdeville/GTMClaudSkills)
3. **API Key Entry** — Select model provider (Claude Sonnet 4.5 / Gemini 3 Flash / GPT-5.2), enter API key (masked password input)
4. **Deploy** — Triggers POST /api/deploy, shows deployment progress with health-bar animation
5. **Active Agents** — Instance list showing persona, status, and actions (Open Dashboard, Destroy)
6. **Open Dashboard** — Navigates to `/i/{id}/` → proxy serves OpenClaw dashboard
7. **Destroy when done** — Click "Destroy" to stop and remove container

Full persona config is injected into the container after gateway health check. This includes: SOUL.md (role, expertise, personality), IDENTITY.md (name, emoji, vibe), workspace skills (3 SKILL.md files per persona in `skills/<name>/SKILL.md`), HEARTBEAT.md (persona-specific periodic checks), heartbeat interval config, and BOOTSTRAP.md removal (skips first-run wizard). Definitions live in `app/src/lib/personas.ts`. Skill mapping sourced from `docs/openclaw-skills-by-persona.md`.

**NAMING RULE**: Keep SF2 visual style (CRT scanlines, pixel font, neon colors, thick grid borders). Remove ALL game jargon (no Fighter, Insert Coin, Fight!, K.O., Winner!, High Scores, Game Over, Round, Press Start, Play, New Game).

## 3. Technical Architecture (Current)

### Stack
- **Frontend**: Next.js 16.1.6 (App Router), React 19, Tailwind v4, TypeScript
- **Auth**: Google Sign-In via WorkOS AuthKit (`@workos-inc/authkit-nextjs` v2.13.0)
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

**State Management**:
- `globalThis.__clawgent_instances` Map survives Next.js hot reloads
- `reconcileWithDocker()` recovers state from Docker containers after full restart
- Extracts tokens from running containers via `docker exec env`
- Instances tagged with `userId` for ownership tracking

## 4. Known Issues

### FIXED: "pairing required" (1008) in all browsers

**Status**: Fixed. Two issues were resolved:

1. **Device pairing auto-approval**: OpenClaw requires device pairing even with `--allow-unconfigured`. The gateway creates a pending pairing request when a new device connects, but only auto-approves if `silent: true` (which the web UI doesn't set). Fix: added `startPairingAutoApprover()` in `deploy/route.ts` that polls `pending.json` every 2s via `docker exec` and approves any pending requests. First-time connect takes ~6s (initial failure → auto-approve → reconnect).

2. **localStorage injection**: Now injects both `gatewayUrl` AND `token` on ALL proxied HTML pages (not just root), and clears all `openclaw*` keys to remove stale pairing data from previous instances.

**Previous e2e test was a false positive**: `text=connected` matched inside "disconnected". Updated test now properly waits for auto-pairing and verifies `openclaw.device.auth.v1` is set in localStorage.

### Other

- No auto-expiry for instances (2-hour TTL per PRD)
- In-memory state (not persisted to disk — globalThis-backed only)
- No tests beyond the single e2e script

## 5. What's Working (Verified by Playwright E2E)

- [x] Landing page loads with Deploy button
- [x] Deploy creates Docker container, shows progress
- [x] Instance reaches "running" state (health check passes)
- [x] Dashboard link navigates to `/i/{id}/`
- [x] Proxy serves OpenClaw HTML + all assets (no 404s)
- [x] `?token=` redirect provides auth to OpenClaw natively
- [x] `gatewayUrl` injected into localStorage via `<script>` in HTML
- [x] WebSocket connects through raw TCP proxy (zero WS errors in Playwright)
- [x] OpenClaw app bootstraps (`<openclaw-app>` renders, device identity created)
- [x] Destroy stops and removes container + volume
- [x] Multiple instances can run simultaneously on different ports
- [x] Docker reconciliation recovers state after server restart
- [x] Google Sign-In via WorkOS AuthKit
- [x] One instance per user (deploy returns 409 for duplicate)
- [x] Auth-aware frontend (sign in → deploy → manage → sign out)
- [x] Persona config injection (SOUL.md, IDENTITY.md, skills, HEARTBEAT.md, BOOTSTRAP.md removal)
- [x] 9 personas including GTM Engineer and Marketing Pro with 25 skills

## 6. File Map

| File | Purpose |
|------|---------|
| `app/server.ts` | Custom HTTP server, raw TCP WS proxy, Next.js HMR delegation |
| `app/src/middleware.ts` | WorkOS AuthKit middleware (protects API routes) |
| `app/src/app/page.tsx` | Auth-aware multi-screen arcade frontend (~1080 lines) |
| `app/src/app/layout.tsx` | Root layout with AuthKitProvider + Press Start 2P font |
| `app/src/app/globals.css` | Retro arcade CSS design system |
| `app/src/app/actions/auth.ts` | Server actions for sign-in URL and sign-out |
| `app/src/app/auth/callback/route.ts` | WorkOS AuthKit callback handler |
| `app/src/app/api/user/route.ts` | Returns current user info + their instance |
| `app/src/app/api/deploy/route.ts` | POST: create instance (auth, 1/user), GET: list instances |
| `app/src/app/api/instances/[id]/route.ts` | GET: detail+logs, DELETE: destroy (owner only) |
| `app/src/app/api/status/route.ts` | Docker availability + instance count (public) |
| `app/src/app/i/[id]/proxy.ts` | Shared HTTP reverse proxy logic, HTML injection |
| `app/src/app/i/[id]/route.ts` | Root path proxy handler (GET/POST/PUT/DELETE) |
| `app/src/app/i/[id]/[...path]/route.ts` | Catch-all sub-path proxy |
| `app/src/lib/instances.ts` | Instance types, globalThis store, Docker reconciliation, findInstanceByUserId |
| `app/src/lib/personas.ts` | 9 persona configs with SOUL.md/IDENTITY.md/skills/HEARTBEAT.md templates |
| `app/.env.example` | WorkOS env var template |
| `app/test-e2e.mjs` | Playwright e2e test script |
| `app/next.config.ts` | `skipTrailingSlashRedirect: true` |
| `docs/product-requirements.md` | Full PRD (Lenny-style) |
| `docs/routing-architecture.md` | Proxy architecture research |
| `docs/architecture-review.md` | Security/scalability review |
| `docs/frontend-design.md` | UX design spec for next iteration |

## 7. MVP Scope

### What's IN
- Retro arcade visual aesthetic (SF2-inspired style, no game jargon in labels)
- Auth-aware 4-screen flow: Start → Agent Select (9 personas) → API Key → Deploy
- Google Sign-In via WorkOS AuthKit (one instance per user)
- 9 AI persona templates with recommended models, skills, and neon colors
  - Marketing Pro with all 25 skills from coreyhaines31/marketingskills
  - GTM Engineer with 6 skills from josephdeville/GTMClaudSkills (gtm-context-os, copywriting, clay-automation, hubspot-operations, data-orchestration, technical-writing)
  - Sales Assistant, Lead Gen Machine, Dev Copilot, Support Agent, Ops Automator, Founder Sidekick, Data Analyst (3 skills each)
- Persona-specific Docker config injection after health check (SOUL.md, IDENTITY.md, workspace skills, HEARTBEAT.md, BOOTSTRAP.md removal)
- Model provider selection (Claude Sonnet 4.5, Gemini 3 Flash, GPT-5.2)
- API key input (masked password field, required before deploy)
- Landing page on localhost (port 3001)
- One-click deploy (Docker containers)
- Unique dashboard URLs at `/i/{id}/`
- Full reverse proxy (HTTP + WebSocket)
- Instance list as "Active Agents" panel
- Deployment log panel
- System status header

### What's NOT IN
- No channel integration (Telegram/Discord/WhatsApp)
- No pricing/billing
- No production hosting
- No persistent storage (in-memory only, globalThis-backed)

## 8. Open Items (Priority Order)

1. **Auto-expiry for instances** — 2-hour TTL per PRD
2. **Replace in-memory Map with SQLite** — Persist userId-instance mapping across restarts
3. **AWS VM deployment** — Future session, eliminates proxy complexity

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
