# Frontend Design Spec

> Last updated: 2026-02-08

---

## v2: Retro Arcade Theme (Current)

> This section documents the current UI. The v1 design spec below is superseded.

### Screen Flow

The frontend is a 4-screen state machine:

```
START SCREEN → CHARACTER SELECT → API KEY ENTRY → DEPLOYING/HIGH SCORES
```

1. **Start Screen** — "PRESS START" blinking text, CRT scanline overlay, arcade cabinet aesthetic
2. **Character Select** — 8 persona cards in a grid, Street Fighter-style selection with neon glow on hover/select
3. **API Key Entry** — Model provider dropdown (3 providers), masked password input for API key
4. **Deploying** — "FIGHT!" transition, health-bar-style progress, deployment logs
5. **High Scores** — Instance list as arcade leaderboard, persona icons, Open/Destroy actions

### 8 Personas

| # | Name | Recommended Model | Neon Color | Skills |
|---|------|-------------------|------------|--------|
| 1 | Marketing Pro | Claude Sonnet 4.5 | Magenta | Content, SEO, campaigns |
| 2 | Sales Assistant | GPT-5.2 | Cyan | Outreach, CRM, follow-ups |
| 3 | Lead Gen Machine | Gemini 3 Flash | Green | Prospecting, qualification, lists |
| 4 | Dev Copilot | Claude Sonnet 4.5 | Blue | Code review, debugging, docs |
| 5 | Support Agent | GPT-5.2 | Orange | Tickets, knowledge base, escalation |
| 6 | Ops Automator | Gemini 3 Flash | Yellow | Workflows, integrations, monitoring |
| 7 | Founder Sidekick | Claude Sonnet 4.5 | Purple | Strategy, pitches, planning |
| 8 | Data Analyst | Gemini 3 Flash | Teal | Dashboards, SQL, reports |

Each persona card shows: name, icon/avatar, skill tags, recommended model badge, and a neon-colored border/glow.

### Model Providers

- Claude Sonnet 4.5 (Anthropic)
- Gemini 3 Flash (Google)
- GPT-5.2 (OpenAI)

Provider is selectable independent of persona recommendation. API key is required (masked password input) before deploy is enabled.

### Color System

Neon arcade palette on dark background (`#07080a`):

| Token | Hex | Usage |
|-------|-----|-------|
| Magenta | `#ff00ff` | Marketing Pro glow, accents |
| Cyan | `#00ffff` | Sales Assistant glow, accents |
| Green | `#00ff41` | Lead Gen, "FIGHT" text, success states |
| Blue | `#4d9fff` | Dev Copilot glow |
| Orange | `#ff6600` | Support Agent glow |
| Yellow | `#ffff00` | Ops Automator glow, warnings |
| Purple | `#bf5fff` | Founder Sidekick glow |
| Teal | `#00ffc8` | Data Analyst glow |

CRT scanline overlay: repeating 2px transparent/semi-transparent black lines via CSS gradient.

### Typography

- **Headers / arcade text**: "Press Start 2P" (Google Font) -- pixel art aesthetic
- **Body / readable text**: Inter -- kept from v1 for legibility
- Tailwind v4 `@theme inline` used for custom color tokens

### Animations

| Name | What | CSS |
|------|------|-----|
| `blink` | "PRESS START" text blinking | `opacity` toggle, 1s interval |
| `glow` | Selected persona card neon pulse | `box-shadow` with persona color, 2s ease-in-out |
| `shake` | Error feedback | translateX shake, 0.5s |
| `health-fill` | Deploy progress bar | width 0% → 100%, stepped |
| `scanlines` | CRT overlay | Static CSS background gradient |

### Persona Metadata on Instances

Persona selection is stored as metadata on each instance (`persona: { name, skills, model, color }`). For MVP this is informational only -- it does not affect the Docker container configuration. Future work: pre-install skills and inject SOUL.md per persona.

---

---

# v1: Original Design (Superseded)

> The content below is the original v1 design spec. It has been superseded by the v2 retro arcade theme above but is preserved for reference.

## 0. Design Philosophy

Clawgent is a developer tool that respects developers. The design should feel like it was built by someone who ships software, not someone who sells marketing automation. Think Linear, not Salesforce. Think Vercel dashboard, not cPanel.

Principles:
- **Information density over whitespace worship.** Show data. Developers like data.
- **Calm confidence.** No exclamation marks. No "Awesome!" confirmations. The product works; that's the excitement.
- **Dark mode is the only mode.** This is a terminal-adjacent tool.
- **Speed is a feature.** Every interaction should feel instant or show honest progress.

---

## 1. Copy and Microcopy

### 1.1 Hero Section

**Headline:**
```
Deploy OpenClaw in 30 seconds
```

**Subheadline:**
```
One click. One container. Your own AI assistant dashboard, running and shareable.
```

Why "30 seconds" instead of "under 1 minute": it's more specific, more confident, and matches the actual Docker container start time. "Under 1 minute" sounds like marketing hedging.

### 1.2 Deploy Button

| State | Label |
|-------|-------|
| Default | `Deploy` |
| Deploying | `Deploying...` |
| Rate limited | `Deploy` (disabled, with limit indicator nearby) |
| Docker unavailable | `Deploy` (disabled, with status message) |

The button says "Deploy" not "Deploy New Instance" or "Launch" or "Create." One word. The action is self-evident.

### 1.3 Status Messages (during deployment)

These appear in the deployment log, one at a time as the deploy progresses:

```
Provisioning container...
Assigning port 19003
Starting OpenClaw gateway
Waiting for health check (attempt 1/20)
Waiting for health check (attempt 3/20)
Instance is live.
```

Tone: factual, lowercase-ish, no emojis, no "Hang tight!" or "Almost there!" nonsense. Just what's happening.

### 1.4 Instance Success State

When the instance goes live, the deploy card transforms. The primary message:

```
Your instance is live
```

Below it, the instance URL displayed prominently:

```
localhost:3001/i/k7x2m9p4
```

And the copy-to-clipboard button labeled: `Copy link`

### 1.5 Instance Card (in the list)

Each running instance shows:
```
k7x2m9p4        Running        1h 42m remaining        [Open]  [Destroy]
```

The ID is monospaced. The status dot is green. The expiry countdown is the most important secondary information.

### 1.6 Error Messages

| Scenario | Message |
|----------|---------|
| Deploy fails (Docker error) | `Deployment failed: {docker error message}` |
| Deploy fails (rate limit) | `Limit reached. You can run up to 3 instances at a time.` |
| Deploy fails (Docker not running) | `Docker is not running. Start Docker Desktop and try again.` |
| Instance not found | `Instance not found. It may have expired or been destroyed.` |
| Instance expired | `This instance expired. Deploy a new one to continue.` |
| Destroy fails | `Could not destroy instance. Try again.` |

No "Oops!" No "Something went wrong." Say what happened and what to do about it.

### 1.7 Empty State (no instances)

When there are zero instances and no active deployment:

**Heading:**
```
No instances running
```

**Body:**
```
Deploy an OpenClaw instance to get a shareable dashboard link.
Each instance runs in an isolated Docker container and expires after 2 hours.
```

Below this, keep the existing comparison cards (Traditional Setup vs Clawgent) as social proof. They're good. Don't change them.

### 1.8 Expiry Warning

At 30 minutes remaining:
```
Expires in 30 minutes
```

At 10 minutes remaining (turns orange/amber):
```
Expires in 10 minutes
```

At 5 minutes remaining (turns red):
```
Expires in 5 minutes
```

No modal. No popup. The countdown text changes color and that's enough. Developers don't need to be nagged.

### 1.9 Rate Limit Indicator

Shown near the deploy button when instances exist:

```
2 of 3 instances used
```

When at limit:
```
3 of 3 instances used -- destroy one to deploy another
```

### 1.10 Footer

```
Clawgent -- deploy OpenClaw without the overhead.
```

Short. No hearts. No "Built with love." The product speaks for itself.

---

## 2. Component Redesign

### 2.1 Page Layout (Top to Bottom)

```
+------------------------------------------------------------------+
| HEADER: "Clawgent" (left)     Rate limit + Docker status (right)|
+------------------------------------------------------------------+
|                                                                    |
|  HERO: Headline + subheadline + Deploy button                     |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  ACTIVE DEPLOY CARD (only visible during/after deploy)            |
|  - Deployment log during provisioning                             |
|  - Instance URL card after success                                |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  INSTANCE LIST: All running instances                             |
|  - Each row: ID, status, expiry countdown, Open, Destroy          |
|                                                                    |
+------------------------------------------------------------------+
|                                                                    |
|  EMPTY STATE / COMPARISON (when no instances)                     |
|                                                                    |
+------------------------------------------------------------------+
|  FOOTER                                                           |
+------------------------------------------------------------------+
```

### 2.2 Header Bar

```
+------------------------------------------------------------------+
| Clawgent                                  2/3 instances | Docker OK |
+------------------------------------------------------------------+
```

- Left: Product name in `text-sm font-medium tracking-wide text-white/60`. Keep the current understated style.
- Right: Two status chips:
  - Instance count: `2/3 instances` in `text-xs text-white/40`
  - Docker status: `Docker OK` in green or `Docker unavailable` in red. Only `text-xs`.

### 2.3 Deploy Card (Pre-Deploy / Hero)

The hero and deploy button are one visual unit. Centered. Above any instance content.

```
+------------------------------------------------------------------+
|                                                                    |
|              Deploy OpenClaw in 30 seconds                        |
|                                                                    |
|   One click. One container. Your own AI assistant dashboard,      |
|   running and shareable.                                          |
|                                                                    |
|                       [ Deploy ]                                  |
|                                                                    |
+------------------------------------------------------------------+
```

The deploy button:
- White background, black text on default
- `bg-white/10 text-white/50` when deploying (with subtle pulse animation on the text)
- `bg-white/10 text-white/30 cursor-not-allowed` when disabled
- Rounded: `rounded-xl`
- Size: `px-8 py-4 text-lg font-semibold`
- Hover: `hover:bg-white/90 hover:scale-[1.02]`
- Active: `active:scale-[0.98]`
- Transition: `transition-all duration-150`

### 2.4 Active Deploy Card (During Deployment)

Replaces the "starting..." skeleton approach. This is a single card that transitions through states.

**State 1: Deploying**

```
+------------------------------------------------------------------+
|  [pulse yellow dot]  Deploying...                        k7x2m9p4 |
|                                                                    |
|  DEPLOYMENT LOG                                                   |
|  ---------------------------------------------------------------  |
|  Provisioning container...                                        |
|  Assigning port 19003                                             |
|  Starting OpenClaw gateway                                        |
|  Waiting for health check (attempt 2/20)                          |
|  ---------------------------------------------------------------  |
+------------------------------------------------------------------+
```

- Background: `bg-white/5 border border-white/10`
- Yellow pulsing dot for "starting" state
- Log panel: `bg-black/30 border border-white/5 rounded-lg` (keep current style)
- Log text: `font-mono text-xs text-white/60`
- Instance ID shown in top-right as `font-mono text-white/40 text-xs`

**State 2: Live (Success)**

This is the "share your instance" moment (see Section 6 for full detail).

```
+------------------------------------------------------------------+
|  [solid green dot]  Your instance is live                k7x2m9p4 |
|                                                                    |
|  +--------------------------------------------------------------+ |
|  |                                                                | |
|  |  localhost:3001/i/k7x2m9p4                    [ Copy link ]   | |
|  |                                                                | |
|  +--------------------------------------------------------------+ |
|                                                                    |
|  [ Open Dashboard ]                                               |
|                                                                    |
|  Expires in 1h 59m                                                |
|                                                                    |
|  > Deployment Log (collapsed)                                     |
+------------------------------------------------------------------+
```

- Background transitions to: `bg-emerald-500/8 border border-emerald-500/20`
- Green solid dot (no pulse once stable)
- URL display: prominent, in its own bordered box (see Section 3.3)
- "Open Dashboard" button: `bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-lg px-6 py-3 w-full`
- Expiry countdown: `text-sm text-white/40`
- Deployment log collapses to a clickable disclosure triangle

**State 3: Error**

```
+------------------------------------------------------------------+
|  [solid red dot]  Deployment failed                      k7x2m9p4 |
|                                                                    |
|  Container exited with code 1: port 19003 already in use          |
|                                                                    |
|  [ Try Again ]                                                    |
|                                                                    |
|  > Deployment Log (expanded)                                      |
+------------------------------------------------------------------+
```

- Background: `bg-red-500/8 border border-red-500/20`
- Error message in `text-sm text-red-400`
- "Try Again" button triggers a new deploy
- Log expanded by default on error

### 2.5 Instance List

Each instance is a row in a list. Not cards -- rows. Denser, more scannable.

```
+------------------------------------------------------------------+
| Running Instances                                                  |
+------------------------------------------------------------------+
| [green] k7x2m9p4   Running   1h 42m left   [ Open ] [ Destroy ]  |
| [green] w3bq8n1r   Running   0h 28m left   [ Open ] [ Destroy ]  |
| [amber] j5t6y2d8   Running   0h 08m left   [ Open ] [ Destroy ]  |
+------------------------------------------------------------------+
```

Row layout:
- Status dot: 8px, color based on time remaining
- Instance ID: `font-mono text-sm text-white/70`
- Status: `text-sm text-white/50`
- Expiry: `text-sm` -- color shifts as time runs out (see Section 3.1)
- "Open" button: `bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-medium rounded-md px-3 py-1.5`
- "Destroy" button: `bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded-md px-3 py-1.5`

Row background: `bg-white/[0.03] hover:bg-white/[0.06] border-b border-white/5`

No "Details" button. Clicking the row (or the ID) opens/expands the detail view inline. Keep it dense.

### 2.6 Log Panel

Keep the current design. It works. Monospace, dark, scrollable. The only change:

- Make it collapsible with a disclosure triangle: `> Deployment Log`
- Default collapsed after instance goes live
- Default expanded during deployment and on error

---

## 3. New Components

### 3.1 Expiry Countdown

A live countdown showing time remaining until auto-expiry.

**Display format:** `1h 42m left` (hours and minutes only, no seconds -- seconds create anxiety)

**Color states:**

| Time Remaining | Color | Token |
|---------------|-------|-------|
| > 30 minutes | `text-white/40` | Neutral, blends in |
| 10-30 minutes | `text-amber-400` | Warning |
| < 10 minutes | `text-red-400` | Urgent |
| < 5 minutes | `text-red-400 animate-pulse` | Critical, subtle pulse |

**Implementation notes:**
- Use `setInterval` at 60-second granularity (not per-second). Minutes are enough.
- Calculate from `expiresAt` timestamp returned by API, not from deploy time + 2h on client.
- When expired: show `Expired` in `text-red-400` (static, no pulse).

### 3.2 Copy-to-Clipboard

A button that copies the instance URL to the clipboard.

**Anatomy:**
```
[ Copy link ]  -->  (click)  -->  [ Copied ]  -->  (2s)  -->  [ Copy link ]
```

**States:**

| State | Label | Style |
|-------|-------|-------|
| Default | `Copy link` | `text-xs text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10 rounded-md px-2.5 py-1` |
| Copied | `Copied` | `text-xs text-emerald-400 bg-emerald-500/10 rounded-md px-2.5 py-1` |

Transition back to default after 2 seconds. Use `navigator.clipboard.writeText()`.

No toast notification. The button label change is sufficient feedback.

### 3.3 Instance URL Display

This is the centerpiece of the success state. The URL needs to feel like a first-class object, not an afterthought.

```
+------------------------------------------------------------------+
|                                                                    |
|   localhost:3001/i/k7x2m9p4                       [ Copy link ]   |
|                                                                    |
+------------------------------------------------------------------+
```

**Design:**
- Container: `bg-white/[0.04] border border-white/10 rounded-lg px-5 py-4`
- URL text: `font-mono text-base text-white/90 tracking-tight`
- The instance ID portion (`k7x2m9p4`) is highlighted: `text-emerald-400`
- Copy button aligned right, vertically centered
- The URL is NOT a clickable link here -- the "Open Dashboard" button below handles navigation. This is a display/copy element.

**Why highlight the ID:** It's the unique part. When someone shares a link or reads it from a bookmark, the ID is the meaningful portion. Highlighting it trains the eye.

**Production version:** When deployed to a real domain, the URL becomes:
```
i-k7x2m9p4.clawgent.com
```
The component should accept the URL as a prop and display whatever format the API returns. No hardcoded localhost assumptions.

### 3.4 Rate Limit Indicator

Shown in the header bar, always visible when at least one instance exists.

**Format:** `{used}/{max} instances`

**States:**

| Count | Display | Color |
|-------|---------|-------|
| 0/3 | Not shown (no indicator when empty) | -- |
| 1/3 | `1/3 instances` | `text-white/40` |
| 2/3 | `2/3 instances` | `text-white/40` |
| 3/3 | `3/3 instances` | `text-amber-400` |

When at 3/3, the deploy button becomes disabled and the indicator text changes to:
```
3/3 instances -- destroy one to deploy
```

### 3.5 Docker Status Indicator

Already exists in the header. Refine it:

| Status | Display | Color |
|--------|---------|-------|
| Available | Omit entirely (don't show "Docker OK" -- absence of error implies health) | -- |
| Unavailable | `Docker unavailable` | `text-red-400` |

Principle: don't celebrate things working. Only speak up when something is broken.

---

## 4. Interaction Design

### 4.1 Deploy Flow

```
User clicks [Deploy]
    |
    v
Button changes to "Deploying..." (disabled, subtle pulse on text)
    |
    v
Active Deploy Card appears below hero with yellow pulsing dot
    |
    v
POST /api/deploy fires
    |
    +-- Success: card shows "Deploying..." + deployment log starts streaming
    |       |
    |       v
    |   Poll GET /api/instances/{id} every 1.5s
    |       |
    |       +-- Each poll: update log entries
    |       |
    |       +-- Status === "running":
    |       |       |
    |       |       v
    |       |   Card transitions to success state
    |       |   - Background fades to emerald tint (CSS transition, 300ms)
    |       |   - Status dot changes yellow->green
    |       |   - URL display fades in
    |       |   - "Open Dashboard" button fades in
    |       |   - Log collapses
    |       |   - Deploy button re-enables
    |       |   - Instance appears in the list below
    |       |
    |       +-- Status === "error":
    |               |
    |               v
    |           Card transitions to error state
    |           - Background fades to red tint
    |           - Error message displayed
    |           - "Try Again" button shown
    |           - Deploy button re-enables
    |
    +-- Failure (network error, rate limit, Docker down):
            |
            v
        Error shown inline (no card, just error text below button)
        Deploy button re-enables
```

**Key transitions:**
- Card background color change: `transition-colors duration-300`
- URL display appearance: `animate-fade-in` (opacity 0->1 over 200ms)
- Log collapse: `transition-all duration-200` on max-height

**No skeletons. No spinners.** The deployment log IS the loading state. It shows real information (what step we're on) instead of gray boxes pretending information exists.

### 4.2 Polling Behavior

- Poll interval: 1.5 seconds (keep current)
- Max polls: 40 (60 seconds total -- current timeout is 60s for health check)
- On each poll response, update the log panel with any new `logs[]` entries
- Stop polling when status is `running`, `error`, or `stopped`
- If 40 polls pass without resolution, show error: `Deployment timed out. The container may still be starting -- check Docker manually.`

### 4.3 Destroy Interaction

```
User clicks [Destroy]
    |
    v
Button text changes to "Destroying..." (disabled)
    |
    v
DELETE /api/instances/{id}
    |
    +-- Success: Row fades out and is removed from list. Instance count decrements.
    |
    +-- Failure: Button re-enables. Show inline error text on that row.
```

No confirmation dialog. This is a temporary, ephemeral instance that expires in 2 hours anyway. A confirmation dialog for destroying a 2-hour sandbox is disrespectful of the user's intent.

If we later add persistent instances (V2), add confirmation then.

### 4.4 Row Expansion (Instance Details)

Clicking the instance ID in the list expands that row to show:

```
+------------------------------------------------------------------+
| [green] k7x2m9p4   Running   1h 42m left   [ Open ] [ Destroy ]  |
|   +--------------------------------------------------------------+|
|   | localhost:3001/i/k7x2m9p4                    [ Copy link ]    ||
|   +--------------------------------------------------------------+|
|   | Auth token: gw_abc123...def                  [ Copy token ]   ||
|   +--------------------------------------------------------------+|
|   | Created: 2:15 PM   Expires: 4:15 PM   Port: 19003            ||
|   +--------------------------------------------------------------+|
+------------------------------------------------------------------+
```

This replaces the current separate "Details" view. Everything is inline. Click the row again to collapse.

---

## 5. Color System

### 5.1 Base Palette

Keep the current dark background. It's good.

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#07080a` | Page background |
| `--bg-surface` | `rgba(255,255,255,0.03)` | Card/row backgrounds |
| `--bg-surface-hover` | `rgba(255,255,255,0.06)` | Hover state on surfaces |
| `--bg-elevated` | `rgba(255,255,255,0.05)` | Elevated cards (deploy card) |
| `--border-subtle` | `rgba(255,255,255,0.10)` | Default borders |
| `--border-hover` | `rgba(255,255,255,0.20)` | Hover borders |
| `--text-primary` | `#ffffff` | Headings, primary text |
| `--text-secondary` | `rgba(255,255,255,0.60)` | Body text, descriptions |
| `--text-tertiary` | `rgba(255,255,255,0.40)` | Labels, metadata, timestamps |
| `--text-muted` | `rgba(255,255,255,0.30)` | Least-important text |

### 5.2 Status Colors

| Status | Dot Color | Background Tint | Border Tint | Text Color |
|--------|-----------|-----------------|-------------|------------|
| Starting/Deploying | `bg-amber-400` | `bg-amber-500/5` | `border-amber-500/15` | `text-amber-400` |
| Running | `bg-emerald-500` | `bg-emerald-500/8` | `border-emerald-500/20` | `text-emerald-400` |
| Error | `bg-red-500` | `bg-red-500/8` | `border-red-500/20` | `text-red-400` |
| Expired | `bg-zinc-500` | `bg-zinc-500/5` | `border-zinc-500/15` | `text-zinc-400` |
| Stopped | `bg-zinc-500` | same as expired | same as expired | `text-zinc-400` |

### 5.3 Accent Color

The primary action color is **white** (deploy button). This is intentional. On a near-black background, a white button is the highest-contrast element on the page. It says "click me" without needing a brand color.

The secondary action color is **emerald** (`emerald-500` / `emerald-600`). Used for:
- "Open Dashboard" button
- Success states
- Instance URL ID highlight
- Running status dot

Why emerald over green: it's slightly cooler and more saturated than Tailwind's `green`. Reads as "alive" without reading as "go" (traffic light). Looks better on dark backgrounds.

### 5.4 Animation

Minimal animation. This is not a marketing site.

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Status dot (starting) | `animate-pulse` | Tailwind default | ease-in-out |
| Status dot (running) | None (solid) | -- | -- |
| Card background transition | `transition-colors` | 300ms | ease |
| Button scale on hover | `hover:scale-[1.02]` | 150ms | ease |
| Button scale on active | `active:scale-[0.98]` | 100ms | ease |
| URL display fade-in | opacity 0 -> 1 | 200ms | ease-out |
| Row expand/collapse | max-height transition | 200ms | ease |
| Countdown pulse (< 5 min) | `animate-pulse` | Tailwind default | ease-in-out |
| Row destroy fade-out | opacity 1 -> 0 | 150ms | ease |

No confetti. No fireworks. No "tada" animations.

---

## 6. The "Share Your Instance" Moment

This is the most important UX moment. The user just waited 15-30 seconds. The container is live. They get their URL. This has to feel good without being performative.

### 6.1 The Transition

When the polling detects `status: "running"`:

1. **Background shift** (300ms): The deploy card's background smoothly transitions from the neutral deploying state (`bg-white/5`) to the success tint (`bg-emerald-500/8`).

2. **Status update** (instant): Dot turns green (solid, no pulse). Header text changes from "Deploying..." to "Your instance is live".

3. **URL reveal** (200ms fade): The URL display box fades in. This is the star of the show. It's in its own bordered container, monospaced, with the instance ID highlighted in emerald.

4. **Action buttons** (200ms fade, 100ms delay after URL): "Open Dashboard" button and "Copy link" button appear.

5. **Log collapse** (200ms): The deployment log panel smoothly collapses to a disclosure triangle. The user can expand it if they want to see what happened, but it's not cluttering the success state.

6. **Countdown appears** (instant): Expiry countdown shown below the action buttons. Subtle, not alarming.

### 6.2 URL Display Design Detail

The URL is the hero of this moment. Design it to be:

```
+------------------------------------------------------------------+
|                                                                    |
|   localhost:3001/i/k7x2m9p4                       [ Copy link ]   |
|                                                                    |
+------------------------------------------------------------------+
```

- The entire URL is monospaced (`font-mono`).
- The instance ID (`k7x2m9p4`) is colored `text-emerald-400`. The rest of the URL is `text-white/80`.
- The container has a subtle left border accent: `border-l-2 border-l-emerald-500`.
- Background: `bg-white/[0.04]`
- The URL is selectable (user can manually select and copy).
- The "Copy link" button is a one-click alternative.

### 6.3 What Gets Copied

When the user clicks "Copy link", the full URL is copied including the token:

```
http://localhost:3001/i/k7x2m9p4/?token=gw_abc123
```

In production this becomes:
```
https://i-k7x2m9p4.clawgent.com
```

(No token in production URL because the reverse proxy handles auth injection.)

### 6.4 Bookmark Prompt

No explicit "Bookmark this" prompt. It's patronizing. Developers know how to bookmark. The URL is displayed prominently, copiable, and that's enough.

### 6.5 What Not to Do

- No celebration animation. No confetti. No "You did it!" message.
- No modal or overlay. The success state is inline, part of the page flow.
- No sound effects.
- No sharing buttons (Twitter, LinkedIn, etc.). This isn't a product launch, it's a dev tool.
- No redirect. The user stays on the Clawgent page and can choose when to open the dashboard.

The reward is the thing working. Show the URL, show the "Open Dashboard" button, get out of the way.

---

## 7. Responsive Considerations

### 7.1 Breakpoints

| Breakpoint | Layout Changes |
|-----------|----------------|
| < 640px (mobile) | Hero text smaller (`text-3xl`). Instance list becomes cards instead of rows. Deploy button full width. URL display wraps. |
| 640px-1024px (tablet) | Current layout mostly works. Instance list stays as rows. |
| > 1024px (desktop) | Max-width container (`max-w-5xl mx-auto`). Current layout. |

### 7.2 Mobile Instance Card

On mobile (< 640px), instance list rows become stacked cards:

```
+----------------------------------+
|  [green] k7x2m9p4     1h 42m    |
|                                  |
|  [ Open ]      [ Destroy ]      |
+----------------------------------+
```

The URL display on mobile wraps naturally since it's in a flex container with `break-all` or `overflow-wrap: anywhere`.

---

## 8. Data Requirements (API Contract)

The frontend expects these fields from the API. Some are new.

### 8.1 Instance Object (from `GET /api/instances/{id}`)

```typescript
interface Instance {
  id: string;                    // nanoid 8 chars, e.g. "k7x2m9p4"
  status: "starting" | "running" | "stopped" | "error" | "expired";
  port: number;
  token: string;
  dashboardUrl: string;          // "/i/k7x2m9p4/?token=gw_abc123" (path-based)
  instanceUrl: string;           // NEW: "/i/k7x2m9p4" (without token, for display/sharing)
  createdAt: string;             // ISO 8601
  expiresAt: string;             // NEW: ISO 8601, createdAt + 2h
  logs: string[];
}
```

### 8.2 System Status (from `GET /api/status`)

```typescript
interface SystemStatus {
  dockerAvailable: boolean;
  totalInstances: number;
  runningInstances: number;
  maxInstances: number;          // NEW: rate limit cap (3)
  instances: InstanceSummary[];
}
```

### 8.3 Instance Summary (in status response)

```typescript
interface InstanceSummary {
  id: string;
  status: "starting" | "running" | "stopped" | "error" | "expired";
  port: number;
  dashboardUrl: string | null;
  instanceUrl: string;           // NEW
  createdAt: string;
  expiresAt: string;             // NEW
}
```

---

## 9. Component Tree

```
<Home>
  <Header>
    <Logo />
    <StatusBar>
      <RateLimitIndicator />     // "2/3 instances"
      <DockerStatus />           // only shows on error
    </StatusBar>
  </Header>

  <main>
    <HeroSection>
      <Headline />
      <Subheadline />
      <DeployButton />
    </HeroSection>

    <ActiveDeployCard>            // only visible during/after deploy
      <StatusHeader>
        <StatusDot />
        <StatusText />
        <InstanceId />
      </StatusHeader>

      // When deploying:
      <DeploymentLog />

      // When live:
      <InstanceUrlDisplay>
        <UrlText />               // with highlighted ID
        <CopyButton />
      </InstanceUrlDisplay>
      <OpenDashboardButton />
      <ExpiryCountdown />
      <CollapsibleLog />
    </ActiveDeployCard>

    <InstanceList>                // only visible when instances exist
      <InstanceRow>               // one per instance
        <StatusDot />
        <InstanceId />
        <StatusLabel />
        <ExpiryCountdown />
        <OpenButton />
        <DestroyButton />
        <ExpandedDetail />        // toggle on click
          <InstanceUrlDisplay />
          <TokenDisplay />
          <Metadata />            // created, expires, port
      </InstanceRow>
    </InstanceList>

    <EmptyState>                  // only when no instances + no active deploy
      <ComparisonCards />         // keep existing
    </EmptyState>
  </main>

  <Footer />
</Home>
```

---

## 10. Implementation Notes

### 10.1 Do Not Change

- The overall page structure (single-page, centered max-width container)
- The dark theme colors (background `#07080a`)
- The Inter font
- The comparison cards component (it's fine as-is)
- The polling mechanism (1.5s interval, stop on terminal states)
- The API endpoints (same routes, just updated response shapes)

### 10.2 Do Change

- Dashboard URL format: from `http://127.0.0.1:{port}/?token=...` to `/i/{id}/?token=...`
- "Open Dashboard" link: from `target="_blank"` to same-tab navigation (since it's now a path on the same host, not an external port)
- Hero copy and button label (see Section 1)
- Instance card layout (rows instead of cards for the list)
- Add expiry countdown
- Add copy-to-clipboard
- Add rate limit indicator
- Add instance URL display component
- Add collapsible deployment log
- Add `expiresAt` to instance data model
- Add `instanceUrl` (token-free URL) to instance data model
- Add `maxInstances` to system status

### 10.3 Priorities

If implementing incrementally:

1. **Must have (P0):** Updated dashboard URL format, instance URL display, copy-to-clipboard, deploy button rename, updated status messages
2. **Should have (P1):** Expiry countdown, rate limit indicator, collapsible log, row-based instance list
3. **Nice to have (P2):** Row expansion, transition animations, mobile-specific layout, status color refinements

---

## 11. Appendix: State Diagram

```
                    +-------------+
                    |   IDLE      |
                    | (no deploy) |
                    +------+------+
                           |
                     [Click Deploy]
                           |
                           v
                    +-------------+
                    |  DEPLOYING  |
                    |  (polling)  |
                    +------+------+
                           |
              +------------+------------+
              |                         |
              v                         v
       +-------------+          +-------------+
       |   RUNNING   |          |   ERROR     |
       | (live, URL  |          | (show error |
       |  visible)   |          |  + retry)   |
       +------+------+          +------+------+
              |                         |
              |                   [Click Retry]
              |                         |
              |                         v
              |                  Back to DEPLOYING
              |
       +------+------+
       |  EXPIRING   |
       | (countdown  |
       |  < 30 min)  |
       +------+------+
              |
              v
       +-------------+
       |  EXPIRED    |
       | (gray, no   |
       |  actions)   |
       +-------------+
```
