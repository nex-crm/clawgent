# Handoff: Clawgent Naming Overhaul

> Created: 2026-02-08 — Continue this work in a new Claude session

## Context

We're building Clawgent — a one-click OpenClaw deployment platform with a retro arcade UI. The backend is fully working (Docker deployment, reverse proxy, WebSocket, device pairing auto-approval). The frontend has a Street Fighter 2-inspired visual theme that works, BUT the previous session took the SF2 theme too literally in the TEXT LABELS — using game jargon like "FIGHTER", "INSERT COIN", "FIGHT!", "K.O.", "WINNER!", "HIGH SCORES", "GAME OVER", etc.

**User's exact words**: "you took the Street Fighter UI quite literally by even naming things that way. Don't describe things the way we can't understand. Just keep the style and vibe like that, not the naming of things. Remove the fighter references, insert coin and everything unrelated. Instead of Press Start, you should say Deploy OpenClaw. Name should be Clawgent. Use the exact style and UI and font of Street Fighter 2. I will generate characters via Gemini. You just give the prompt once you are done with all other changes. The character screen and selector should be exactly like Street Fighter 2."

## What's Already Done

- layout.tsx: Already updated title to "CLAWGENT — Deploy AI Agents" ✅
- All backend APIs working ✅
- globals.css: 373-line retro arcade design system ✅
- page.tsx: 829-line 4-screen state machine with arcade theme ✅ (but needs naming overhaul)

## Immediate Tasks (Priority Order)

### 1. Naming Overhaul in `app/src/app/page.tsx`

Read the MEMORY.md file at `~/.claude/projects/-Users-najmuzzaman-Documents-clawgent/memory/MEMORY.md (legacy path)` for the FULL replacement table with exact current text → replacement text for every string in page.tsx.

Key changes:
- CLAWGENT (already renamed)
- INSERT COIN → remove entirely
- PRESS START → DEPLOY OPENCLAW
- CHOOSE YOUR FIGHTER → SELECT YOUR AGENT
- FIGHT! → DEPLOY (button) / LAUNCHING... (flash)
- ROUND 1 → DEPLOYING
- VS + Docker layout → persona + deploy spinner (no VS concept)
- K.O.! → ONLINE!
- WINNER! → READY!
- NEW GAME → DEPLOY ANOTHER
- GAME OVER → DEPLOY FAILED (error) / DESTROY (button)
- HIGH SCORES → ACTIVE AGENTS
- FIGHTER → AGENT (fallback text)
- PLAY → OPEN
- Rename state vars: showFightFlash→showLaunchFlash, showKO→showOnline, showWinner→showReady
- Confirm dialog: "Destroy this agent?" (not "GAME OVER for this fighter?")
- Footer: CLAWGENT © 2026

### 2. SF2-Exact Character Select Grid

The current character select is a basic 4x2 grid with glow effects. User wants it to look EXACTLY like Street Fighter 2's character select screen:
- Thick bordered cells (like SF2's pixel art borders)
- Animated cursor/selector box that moves to the hovered/selected character
- Character name plate displayed at the bottom of the grid
- Possibly a side info panel showing selected persona's skills/details
- Keep the 4x2 grid layout (8 personas)

### 3. globals.css Comment Update

Line 4: Ensure comment header says `CLAWGENT`.

### 4. Generate Gemini Prompt for Character Images

After ALL code changes are done, generate a detailed prompt for the user to use with Google Gemini to create 8 character portraits in SF2 pixel art style. One prompt per persona:
- Marketing Pro (📢, magenta)
- Sales Assistant (🎯, yellow)
- Lead Gen Machine (🧲, orange)
- Dev Copilot (⌨️, green)
- Support Agent (🛡️, blue)
- Ops Automator (⚙️, purple)
- Founder Sidekick (🚀, orange)
- Data Analyst (📊, blue)

### 5. Update docs/spec.md

Some updates already done. Check MEMORY.md for remaining items.

## Key Technical Details

- **Dev server**: `cd /Users/najmuzzaman/Documents/clawgent/app && npm run dev` (port 3001, local path unchanged)
- **Type check**: `cd app && npx tsc --noEmit` (pre-existing server.ts error is expected, ignore it)
- **E2e test**: `cd app && node test-e2e.mjs` (needs Docker running)
- **Tailwind v4**: Uses `@theme inline` for custom colors, NOT tailwind.config.js
- **Font**: Press Start 2P via `next/font/google`, CSS var `--font-arcade`
- All pixel text uses `.pixel-font` class (from globals.css)
- Arcade panels use `.arcade-panel`, buttons use `.arcade-btn`, inputs use `.arcade-input`

## Files to Read First

1. `~/.claude/projects/-Users-najmuzzaman-Documents-clawgent/memory/MEMORY.md (legacy path)` — Full context + replacement table
2. `app/src/app/page.tsx` — 829 lines, the main file to modify
3. `app/src/app/globals.css` — CSS design system (reference for available classes)
4. `app/src/app/layout.tsx` — Already updated
5. `docs/spec.md` — Partially updated

## Don't Touch

- `app/server.ts` — working custom server, pre-existing type error
- `app/src/app/api/deploy/route.ts` — working deploy API
- `app/src/app/api/instances/[id]/route.ts` — working instance API
- `app/src/lib/instances.ts` — working instance store
- `app/src/app/i/[id]/` — working proxy routes
- Any backend/proxy code
