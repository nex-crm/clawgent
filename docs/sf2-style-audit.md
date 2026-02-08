# SF2 Visual Authenticity Audit -- Clawgent

> Audited: 2026-02-08
> Auditor: SF2 arcade visual specialist
> Files reviewed: `page.tsx`, `globals.css`, `layout.tsx`

---

## 1. Score Card

| Screen              | Authenticity (1-10) | Notes                                                                                   |
|---------------------|---------------------|-----------------------------------------------------------------------------------------|
| Start Screen        | 4/10                | Reads more like a modern neon web landing page than an SF2 title screen                 |
| Character Select    | 6/10                | Grid layout and cursor corners are the best SF2 element; color palette and nameplate wrong |
| API Key Entry       | 3/10                | No SF2 equivalent; needs to feel like the options/handicap screen                       |
| Deploying           | 5/10                | ONLINE!/READY! text flash has energy; health bar gradient is wrong; no SF2 wipe         |
| Active Agents       | 3/10                | Instance list is pure web UI; no arcade frame, no SF2 chrome                            |
| **Overall**         | **4.2/10**          | Spirit is there, execution is modern web with an arcade skin                            |

---

## 2. What's Already Good

### Cursor Corner Brackets on Character Select
The `.sf2-cursor` implementation with four corner spans and the `sf2-blink` animation is the single most authentically SF2 element in the entire app. SF2 does use animated corner brackets for the selector. The timing (0.4s step-end) is close -- the real arcade runs at approximately 0.33s (5 frames at 15fps effective blink). The step-end function is correct; SF2 cursors do hard-cut, not fade.

### CRT Scanline Overlay
The `body::after` scanline approach is solid. The 2px line spacing is correct for simulating a 15kHz horizontal scan rate on a standard-resolution arcade monitor. The opacity is appropriately subtle at 0.04.

### Text Case Convention
All text is uppercase. SF2 uses uppercase exclusively in its UI. This is correct.

### General Dark Background
The near-black background (`#0a0a0a`) is appropriate. SF2's character select screen background is very dark, typically `#080018` to `#0c0028` (dark navy/indigo, not pure near-black).

### Blink Animation
The 50% duty cycle hard blink (`step-end`) for "INSERT COIN" / "CHOOSE AN AGENT" text is authentic. SF2 title screen text blinks exactly this way.

---

## 3. Critical Fixes (Things That Break the SF2 Illusion)

### 3.1 WRONG: Color Palette Is "Neon Web", Not CPS-1/CPS-2

This is the single biggest problem. The current palette is modern web neon:

| Current Variable     | Current Value | Problem                                           |
|---------------------|---------------|---------------------------------------------------|
| `--arcade-green`    | `#39ff14`     | This is LED/neon green. SF2 uses NO neon green anywhere in its UI. |
| `--arcade-blue`     | `#00f0ff`     | Too cyan/electric. SF2 uses a deeper, more royal blue. |
| `--arcade-pink`     | `#ff2d95`     | Too magenta/hot-pink. SF2 uses a warmer red-pink for P2 cursor. |
| `--arcade-yellow`   | `#ffe66d`     | Too pastel/warm. SF2 yellow is a harder, more saturated arcade yellow. |
| `--arcade-orange`   | `#ff6b35`     | Acceptable, but SF2 oranges tend more toward `#e85820`. |
| `--arcade-purple`   | `#a855f7`     | Too Tailwind-purple. SF2 purples are darker and more indigo. |
| `--arcade-red`      | `#ef4444`     | Tailwind red-500. SF2 reds are deeper: `#d82020` to `#c01818`. |
| `--arcade-bg`       | `#0a0a0a`     | Should be dark navy/indigo, not pure black. |

**SF2 Actual UI Color Reference** (extracted from CPS-1 palette data):

| Element                     | Authentic SF2 Value | Description                           |
|-----------------------------|---------------------|---------------------------------------|
| Character select background | `#080020`           | Very dark navy/indigo                  |
| Player 1 cursor             | `#00a0f8`           | Mid-bright blue                        |
| Player 2 cursor             | `#f83800`           | Warm red-orange                        |
| Selected name text          | `#f8f8f8`           | Near-white                             |
| Stage/country name text     | `#f8d838`           | Strong warm yellow                     |
| Timer digits                | `#f8f8f8`           | White                                  |
| Health bar full              | `#f8d800`           | Golden yellow                          |
| Health bar mid               | `#f8a000`           | Orange                                 |
| Health bar low               | `#f83800`           | Red                                    |
| Title text ("STREET FIGHTER")| `#f8d838`          | Golden yellow with no glow             |
| VS screen background        | `#000000`           | Pure black                             |
| "ROUND 1" text             | `#f8d838`           | Golden yellow                          |
| "FIGHT!" text              | `#f8f8f8`           | White flash                            |
| Grid cell border (default)  | `#383838` to `#484848` | Dark gray, not `#333`               |
| Win marker (star/dot)       | `#f8d838`           | Yellow                                 |

**Why this matters**: The CPS-1 hardware palette is 16-bit (RGB555 with some tricks), which naturally produces slightly desaturated, warm-shifted colors compared to modern hex. The `#39ff14` neon green does not exist anywhere in the CPS-1 color space. Nothing in SF2 glows green. The dominant UI color in SF2 is golden yellow (`#f8d838`) and blue (`#00a0f8`).

### 3.2 WRONG: Text Glow Effect (`.arcade-text`)

```css
/* Current */
.arcade-text {
  text-shadow:
    0 0 4px currentColor,
    0 0 8px currentColor,
    0 0 16px currentColor;
}
```

SF2 text does NOT glow. CRT phosphor produces some natural bloom at high brightness, but it is nothing like a triple-layer CSS text-shadow. The text-shadow approach makes everything look like a Tron Legacy poster, not a 1991 arcade cabinet.

**Authentic CRT text appearance**:
- Slight brightness bloom on white/yellow text: 1px spread, very subtle
- No colored glow halos
- The "glow" people remember from arcades is the CRT phosphor persistence, which is a motion effect, not a static glow

**Correct approach**: Text should be sharp bitmap-style with, at most, a 1px same-color shadow for subtle CRT warmth:
```css
.arcade-text {
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.6);
}
```
For high-intensity moments (FIGHT!, K.O.), a brief white flash bloom is acceptable.

### 3.3 WRONG: Health Bar Gradient Direction

```css
.health-bar {
  background: linear-gradient(90deg, var(--arcade-green), var(--arcade-yellow), var(--arcade-orange));
}
```

Three problems:
1. **SF2 health bars are NOT gradient**. They are a solid color that changes in discrete steps: yellow when full > orange below 50% > red below 25%.
2. **No green**. SF2 health bars are never green. They are yellow (`#f8d800`) when full.
3. **The bar should DEPLETE from the inside edge toward the outside**, not fill left-to-right. In SF2, the health bar starts full and drains. For a deploy progress bar, filling left-to-right is acceptable as a concept, but it should use SF2 colors (yellow) and have a segmented/blocky look.

**Authentic SF2 health bar**: Solid rectangles with a 1px dark outline, no rounded corners, slight inner highlight on the top edge. The bar is divided into tiny segments (approximately 2-3px wide blocks with 1px gaps).

### 3.4 WRONG: `border-radius` Everywhere

SF2 has ZERO rounded corners. Everything is hard pixel edges. The current CSS uses `border-radius: 4px` on `.arcade-panel` and `border-radius: 2px` on `.health-bar`. In the arcade, every UI element is a hard rectangle.

### 3.5 WRONG: No SF2 Frame / Chrome

The character select screen in SF2 has a very specific visual frame:
- A thick outer border (usually golden/yellow, ~4px) around the entire select area
- The grid itself sits inside this border
- Below the grid is a wide nameplate area with the character name in large text, country flag, and a decorative divider line
- Above the grid: "SELECT YOUR FIGHTER" (not "SELECT YOUR AGENT") in yellow

The current app just has a bare grid with a yellow border and some Tailwind spacing. It needs the full chrome treatment: a container that looks like an arcade UI panel, not a web component.

### 3.6 WRONG: Transition Style

The app uses no screen transitions. SF2 screen transitions are:
- **Character select to VS screen**: Hard horizontal wipe (blinds effect, left-to-right), takes approximately 0.5s
- **VS screen to stage**: Quick fade through black
- **Round end to next round**: Flash white, then fade
- **K.O.**: Screen freezes, slight zoom, "K.O." drops in from above

Currently the app just swaps React state with no transition at all. At minimum, a quick horizontal wipe or flash-through-white would sell the illusion.

### 3.7 WRONG: Background is Plain Black

SF2 character select uses a dark blue tiled/patterned background. It is not flat black. The pattern is subtle -- small diamond or cross-hatch tiles in very dark navy blue. The current `#0a0a0a` flat background reads as "modern dark mode website", not "arcade cabinet CRT".

---

## 4. Enhancement Opportunities (Nice-to-Haves)

### 4.1 Add a "1P" Marker Above the Cursor
In SF2, the player 1 selector has "1P" text floating above it in blue. Since Clawgent is single-player, a "1P" marker above the currently hovered cell would be a cheap, high-impact authenticity boost.

### 4.2 Character Name Display Below Grid
SF2 displays the selected character's name in LARGE text (roughly 2x the grid label size) below the grid in a dedicated nameplate bar. The current nameplate implementation exists but uses web-style layout (flexbox with icon + description). It should be a centered, large-text name with a simple underline divider.

### 4.3 Country Flag / Origin Badge
Each SF2 character has a country flag beside their name. The Clawgent personas could have a "type" badge in the same position (e.g., "MARKETING", "ENGINEERING") styled as a small rectangular plate.

### 4.4 Idle Animation on Selected Character
In SF2, the selected character does an idle animation in a large portrait window beside the grid. Without sprite art, a subtle scale-pulse or position-shift on the selected persona's emoji would approximate this.

### 4.5 Timer Element
SF2 has a countdown timer (99 seconds) in the center-top of the screen during character select. Adding a decorative "99" timer that does not actually count down (or does, as a fun pressure element) would be very SF2.

### 4.6 "CAPCOM" / Credits Bar at Bottom
SF2 has a thin bar at the very bottom with copyright text. The current footer is close but needs the pixel font and tighter spacing.

### 4.7 Screen Wipe Transitions
Between screens, implement a horizontal blinds wipe (16-bar horizontal wipe, each bar delayed by ~30ms). This is the canonical SF2 transition.

### 4.8 "PERFECT" / "YOU WIN" Text for Successful Deploy
After deploy succeeds, showing "PERFECT!" (if it was fast) or "YOU WIN!" would be a fun SF2 callback.

### 4.9 Attract Mode
When no one has interacted for 30+ seconds on the start screen, SF2 shows demo gameplay. An equivalent could be cycling through persona descriptions or showing system stats.

---

## 5. Asset Shopping List

### 5.1 Required Sprites/Images

| Asset | Description | SF2 Reference | Priority |
|-------|-------------|---------------|----------|
| 8 persona portraits | 64x64 or 96x96 pixel art portraits in SF2 character select style. Each should show the persona as a head/shoulders shot in the character grid. Think Ryu's portrait: head centered, slight angle, bold outlines, limited palette (~16 colors per portrait). | SF2 character select grid portraits | HIGH |
| Character select background tile | A dark navy/indigo repeating tile pattern (~16x16px), subtle diamond or crosshatch pattern. Colors: `#080020` base, `#101038` pattern. | SF2 character select screen background | HIGH |
| SF2 grid frame border | A decorative border graphic (can be CSS) mimicking the golden ornamental frame around the SF2 select grid. Has corner pieces and edge repeats. | SF2 character select outer frame | MEDIUM |
| Screen transition wipe | 16 horizontal bars for wipe animation (can be pure CSS/JS, no image needed). | SF2 screen transition between character select and VS screen | MEDIUM |
| Health bar segments | A repeating 3x16px tile for the segmented health bar look (can be CSS pattern). | SF2 health bar in-match HUD | LOW |
| "1P" marker graphic | Small blue "1P" text badge that floats above cursor. Can be pure CSS text. | SF2 player indicator above cursor | LOW |
| Lightning/electricity effect | For deploy screen (VS screen equivalent). Can be CSS/canvas animation. Jagged white-blue lines. | SF2 VS screen lightning bolts | MEDIUM |

### 5.2 Sound Effects

| Sound | Description | SF2 Moment | When to Play |
|-------|-------------|------------|--------------|
| Cursor move | Short, bright "tick" sound (~50ms). Pitched wooden click. | Moving cursor in character select | Hovering over a new persona cell |
| Character confirm | Deeper "whomp" or "chunk" sound (~200ms). Decisive. | Pressing a button on character select | Clicking a persona to select |
| Screen wipe | Quick "swoosh" or "shwip" (~300ms). | Transition between screens | Any screen change |
| Deploy start | Low rumble building to a hit. Like SF2 "ROUND 1" announcement. | Round start | Clicking DEPLOY |
| Deploy success | Triumphant short fanfare. "YOU WIN" jingle. (~1.5s) | Victory jingle | Instance reaches "running" |
| Deploy fail | Low descending tone. "CONTINUE?" music feel. (~1s) | Game over descending notes | Instance reaches "error" |
| Text type / input | Very faint keystroke click. | Not in SF2, but arcade-adjacent | Typing API key |
| Instance destroy | "K.O." impact sound. Heavy bass thud. | K.O. hit | Destroying an instance |

### 5.3 Fonts

| Font | Usage | Notes |
|------|-------|-------|
| Press Start 2P | Already in use | Acceptable as a stand-in. Real SF2 uses a custom bitmap font that is slightly wider and has different character shapes (notably the "S" and "R"). Press Start 2P is inspired by Namco fonts, not Capcom. The difference is subtle enough for a web app. |
| SF2 Timer font | Timer display (if added) | SF2 timer uses a wider, blockier digit font than the UI text. Could be achieved with a custom CSS approach or a different pixel font weight. |

---

## 6. CSS Fixes

The following are specific, implementable CSS changes. Changes marked **[APPLIED]** have been made directly in `globals.css`.

### 6.1 Color Palette Overhaul **[APPLIED]**

Replace the current neon web palette with CPS-1/CPS-2 authentic values:

```css
:root {
  --arcade-bg: #080020;         /* Dark navy, not black */
  --arcade-green: #38c830;      /* Toned-down green (for UI elements only, not dominant) */
  --arcade-blue: #00a0f8;       /* SF2 Player 1 blue */
  --arcade-pink: #f83078;       /* SF2 character select accent pink */
  --arcade-yellow: #f8d838;     /* SF2 golden yellow -- THE dominant UI color */
  --arcade-orange: #f88800;     /* SF2 health bar mid-range */
  --arcade-purple: #7838b8;     /* Darker indigo-purple */
  --arcade-red: #d82020;        /* SF2 low-health red */

  --arcade-bg-panel: #0c0030;   /* Panel bg: dark indigo, not gray */
  --arcade-border-color: #282858; /* Border: muted indigo, not gray */
}
```

### 6.2 Remove Neon Glow from Text **[APPLIED]**

```css
.arcade-text {
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.6);
}
```

The triple-layer glow is the most un-SF2 element. CRT text is sharp with a faint shadow from the phosphor mask.

### 6.3 Fix Health Bar **[APPLIED]**

```css
.health-bar {
  height: 100%;
  background: #f8d800;  /* Solid yellow, not gradient */
  animation: health-fill 2s ease-out forwards;
  border-radius: 0;     /* No rounded corners */
  /* Segmented look via repeating gradient overlay */
  background-image: repeating-linear-gradient(
    90deg,
    transparent 0px,
    transparent 4px,
    rgba(0, 0, 0, 0.3) 4px,
    rgba(0, 0, 0, 0.3) 5px
  );
  background-color: #f8d800;
}
```

### 6.4 Remove All border-radius from Arcade Elements **[APPLIED]**

```css
.arcade-panel {
  border-radius: 0;  /* Was 4px */
}
```

### 6.5 Fix Scanline Intensity **[APPLIED]**

Current opacity is 0.04 which is barely visible. Real CRT scanlines are more visible, especially on dark backgrounds. Bumping to 0.08 and adjusting line color:

```css
body::after {
  opacity: 0.08;
}
```

### 6.6 Fix Panel Glow Color **[APPLIED]**

```css
.arcade-panel {
  box-shadow:
    0 0 8px rgba(0, 32, 80, 0.15),
    inset 0 0 12px rgba(0, 0, 0, 0.6);
}
```

The panel glow was green-tinted (`rgba(57, 255, 20, 0.08)`). SF2 panels glow with a very subtle blue tint, not green.

### 6.7 Fix Arcade Button Default Color **[APPLIED]**

The arcade button defaults to green border/text. SF2 UI buttons (if any) use yellow or white. Keeping the button class color-neutral (uses whatever color the element sets) but changing the default:

```css
.arcade-btn {
  color: var(--arcade-yellow);
  border: 2px solid var(--arcade-yellow);
}

.arcade-btn:hover {
  box-shadow:
    0 0 8px var(--arcade-yellow),
    0 0 16px var(--arcade-yellow),
    inset 0 0 8px rgba(248, 216, 56, 0.1);
  text-shadow: 0 0 4px var(--arcade-yellow);
}
```

### 6.8 Fix Input Styling **[APPLIED]**

```css
.arcade-input {
  border: 2px solid var(--arcade-blue);
  color: #f8f8f8;         /* White text, not green */
  border-radius: 0;        /* No rounding */
}

.arcade-input::placeholder {
  color: rgba(0, 160, 248, 0.35);  /* Match border color */
}
```

### 6.9 Fix Scrollbar to Match Palette **[APPLIED]**

```css
* {
  scrollbar-color: var(--arcade-blue) #0c0030;
}
*::-webkit-scrollbar-track {
  background: #0c0030;
}
*::-webkit-scrollbar-thumb {
  background: var(--arcade-blue);
}
```

### 6.10 Add SF2 Background Tile Pattern **[APPLIED]**

```css
body {
  background: var(--arcade-bg);
  background-image:
    radial-gradient(circle at 50% 50%, rgba(40, 40, 100, 0.08) 1px, transparent 1px);
  background-size: 8px 8px;
}
```

This creates a subtle dot/diamond grid pattern similar to the SF2 character select background tile.

### 6.11 Add Screen Wipe Transition Keyframe **[APPLIED]**

```css
@keyframes sf2-wipe {
  0% { clip-path: inset(0 100% 0 0); }
  100% { clip-path: inset(0 0 0 0); }
}

.sf2-wipe-in {
  animation: sf2-wipe 0.4s ease-out forwards;
}
```

### 6.12 SF2 Cursor Timing Fix **[APPLIED]**

The blink is 0.4s. Real SF2 is closer to 0.33s (every 5 frames at ~15fps effective). Adjusting:

```css
.sf2-cursor {
  animation: sf2-blink 0.33s step-end infinite;
}
```

---

## 7. Reference Screenshots to Study

For each fix, here is the specific SF2 moment/screen to reference:

| Fix | What to Search For | Version |
|-----|--------------------|---------|
| Color palette | "Street Fighter 2 character select screen" | Super SF2 Turbo (arcade) |
| Grid layout | "SF2 character select grid all 12 characters" | Super SF2 (arcade, SNES) |
| Cursor corners | "Street Fighter 2 cursor selector animated" | Any version, look for the L-bracket flicker |
| Health bar | "Street Fighter 2 health bar close up" | SF2 Championship Edition |
| Timer | "SF2 timer 99 close up" | Any version |
| Text style | "Street Fighter 2 ROUND 1 FIGHT text" | Arcade version specifically |
| VS screen | "Street Fighter 2 VS screen lightning" | Super SF2 Turbo |
| Background tile | "SF2 character select background pattern dark" | Super SF2, look at the area around the grid |
| Nameplate | "SF2 character name display below grid with flag" | Super SF2, character select bottom bar |
| Title screen | "Street Fighter 2 title screen insert coin" | Arcade, note the logo treatment and text blink |
| Screen transition | "SF2 screen transition wipe effect" | Between select and VS screen, horizontal bars |
| K.O. text | "Street Fighter 2 KO screen" | Note: text drops from above, screen shakes slightly |

---

## 8. Priority Implementation Order

1. **Color palette swap** (globals.css) -- Single biggest impact. Changes the entire feel from "modern neon" to "1991 arcade". **[DONE]**
2. **Remove text glow** -- Second biggest offender. **[DONE]**
3. **Remove border-radius** -- Instant arcade feel. **[DONE]**
4. **Fix health bar** -- Yellow, segmented, no rounded corners. **[DONE]**
5. **Background tile pattern** -- Kills the "dark mode website" feel. **[DONE]**
6. **Pixel art portraits** (external asset) -- Replaces emoji with actual arcade-feel character art
7. **Screen wipe transitions** (JS + CSS) -- Needs React implementation, CSS keyframe provided. **[CSS DONE, JS TODO]**
8. **"1P" cursor marker** (CSS + JSX) -- Small addition, big authenticity
9. **SF2 nameplate redesign** (JSX) -- Center the name, make it large, add divider
10. **Sound effects** (external assets) -- Last because visual comes first

---

## 9. Quick-Reference: SF2 vs Current Comparison

```
ELEMENT              SF2 ARCADE                   CLAWGENT CURRENT
-----------------------------------------------------------------
Background           Dark navy #080020             Near-black #0a0a0a
Dominant UI color    Golden yellow #f8d838         Neon green #39ff14
Text rendering       Sharp, no glow               Triple-layer glow halo
Corners              All hard 90-degree            border-radius: 2-4px
Health bar           Solid yellow, segmented       Green-yellow-orange gradient
Grid borders         Dark gray #383838             #333333 (close but wrong tone)
Selected text        Near-white #f8f8f8            Colored per persona
Panel background     Dark blue-black               Dark gray #111111
Transitions          Horizontal bar wipe           None (instant React swap)
Font                 Custom Capcom bitmap          Press Start 2P (Namco-style)
Sound                Full SFX on every action      None
Cursor               Blue L-brackets, 5-frame blink Color L-brackets, 6-frame blink
```

---

## 10. What NOT to Change

- **The emoji persona icons** work fine as placeholder. They should eventually become pixel art, but they read well in the grid.
- **The overall screen flow** (start > select > config > deploy) maps nicely to SF2's flow (title > select > VS > fight).
- **The "DEPLOY LOG" terminal output** is a good addition that has no SF2 equivalent but works thematically as an arcade debug screen.
- **The DESTROY button in red** is correct -- SF2 uses red for danger/damage.
- **The footer copyright line** matches SF2's bottom-screen credit bar.
- **The `.blink` animation timing** is already correct (50% duty cycle, step-end).
