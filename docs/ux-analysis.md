# Clawgent UX Analysis

> Comprehensive UX and design system analysis of Clawgent.com for cloning purposes.
> Last updated: 2026-02-07

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Information Architecture](#2-information-architecture)
3. [Design System](#3-design-system)
4. [Component Inventory](#4-component-inventory)
5. [User Journey](#5-user-journey)
6. [Interactive Patterns](#6-interactive-patterns)
7. [Content Inventory](#7-content-inventory)
8. [Post-Auth Experience](#8-post-auth-experience)
9. [Developer Implementation Guide](#9-developer-implementation-guide)

---

## 1. Product Overview

**What it is**: Clawgent is a one-click deployment platform for OpenClaw (an open-source personal AI assistant). It eliminates server management, SSH configuration, and manual setup by provisioning a fully configured VM with OpenClaw in under 60 seconds.

**Target users**: Non-technical founders, operators, and remote teams who want an AI assistant on messaging platforms (Telegram, Discord) without DevOps overhead.

**Core value proposition**: "Deploy OpenClaw under 1 minute" -- reducing an estimated 60-minute (or 600-minute for non-technical users) manual process to a single click.

**Business model**: Managed hosting with cloud server plans (pricing details not publicly visible on the landing page -- likely revealed post-auth).

---

## 2. Information Architecture

The page follows a strict top-to-bottom conversion funnel. There is no traditional navigation menu -- the entire page is a single-scroll experience designed to guide the user from awareness to action.

### Page Structure (Top to Bottom)

```
+------------------------------------------------------------------+
| HEADER: Support contact link                                      |
+------------------------------------------------------------------+
| HERO: Headline + subheadline                                      |
+------------------------------------------------------------------+
| SECTION 1: Model Selection (3 cards)                              |
+------------------------------------------------------------------+
| SECTION 2: Channel Selection (3 cards)                            |
+------------------------------------------------------------------+
| SECTION 3: Sign-in CTA (Google OAuth)                             |
+------------------------------------------------------------------+
| SECTION 4: Comparison Table (Traditional vs Clawgent)           |
+------------------------------------------------------------------+
| SECTION 5: Use Cases Grid (5 categories)                          |
+------------------------------------------------------------------+
| FOOTER: Attribution + contact                                     |
+------------------------------------------------------------------+
```

### Above the Fold (First Viewport)

- Header with support email
- Hero headline: "Deploy OpenClaw under 1 minute"
- Hero subheadline/description
- Beginning of model selection cards

### Below the Fold

- Channel selection cards
- Sign-in button
- Comparison table (social proof / objection handling)
- Use case grid (aspiration / imagination)
- Footer

### Design Rationale

The architecture follows a "configure then commit" pattern: the user makes two lightweight choices (model + channel) before encountering the sign-in wall. This reduces friction because by the time users see the auth prompt, they've already mentally committed to their configuration. The comparison table and use cases below the CTA serve as reinforcement for users who scroll past the sign-in without converting.

---

## 3. Design System

### 3.1 Color Palette

| Token | Hex Value | Usage |
|-------|-----------|-------|
| `background-primary` | `#07080a` | Page background, near-black |
| `text-primary` | `#ffffff` | All primary text, headings |
| `text-secondary` | `#a0a0a0` (estimated) | Subtext, descriptions, muted labels |
| `border-card` | `#1a1a2e` (estimated) | Card borders, subtle separators |
| `accent-selection` | TBD (likely a blue or brand color) | Selected card state highlight |
| `badge-coming-soon` | Muted/gray tone | "Coming soon" badge on WhatsApp |
| `heart-red` | Red emoji | Footer heart icon |

**Note**: The site uses an extremely dark background (`#07080a`) which is darker than typical "dark mode" backgrounds (`#121212` or `#1a1a1a`). This creates a premium, high-contrast feel. Exact accent and secondary colors require browser dev tools inspection for precision -- the values above marked "estimated" are inferred from common Tailwind dark theme patterns.

### 3.2 Typography

| Property | Value |
|----------|-------|
| Font Family | Inter (variable font, loaded via `next/font`) |
| Font Fallback | System sans-serif stack |
| Rendering | `antialiased` (Tailwind `antialiased` class) |
| Hero Heading | Large, bold, likely `text-4xl` or `text-5xl`, `font-bold` |
| Section Headings | `text-2xl` or `text-3xl`, `font-semibold` |
| Body Text | `text-base` or `text-lg` |
| Card Titles | `text-lg` or `text-xl`, `font-medium` |
| Labels/Badges | `text-sm`, possibly `font-medium` |

### 3.3 Spacing System

Tailwind default spacing scale used throughout:
- Page horizontal padding: `px-4` to `px-8` (responsive)
- Section vertical spacing: `py-12` to `py-20`
- Card padding: `p-4` to `p-6`
- Card gap: `gap-4` or `gap-6`
- Grid gaps in use case section: `gap-3` to `gap-4`

### 3.4 Layout

- `min-h-dvh` (dynamic viewport height)
- `overflow-x-hidden` (prevents horizontal scroll)
- Content is centered with max-width container
- Responsive grid layouts for cards (likely `grid-cols-1 md:grid-cols-3`)

### 3.5 Border & Radius

- Cards: Rounded corners (likely `rounded-xl` or `rounded-2xl`)
- Buttons: Rounded (likely `rounded-lg` or `rounded-full` for CTA)
- Card borders: Subtle, possibly `border border-white/10` or similar low-opacity white borders

### 3.6 Shadows & Effects

- Dark theme means minimal box-shadows
- Possible subtle glow or border highlight on selected cards
- Potential `backdrop-blur` on any overlay elements

---

## 4. Component Inventory

### 4.1 Header

```
+------------------------------------------------------------------+
| Contact Support (mailto link)                                     |
+------------------------------------------------------------------+
```

**Elements**:
- Text link: "Contact Support" or similar
- Links to: `mailto:savio@clawgent.com`
- Position: Top of page, likely right-aligned or centered
- Minimal -- no logo, no navigation menu

**Implementation notes**: Simple `<header>` with a single `<a>` tag. No hamburger menu, no responsive nav needed.

### 4.2 Hero Section

```
+------------------------------------------------------------------+
|                                                                    |
|          Deploy OpenClaw under 1 minute                           |
|                                                                    |
|   Avoid all technical complexity and one-click deploy your own    |
|   24/7 active OpenClaw instance under 1 minute.                  |
|                                                                    |
+------------------------------------------------------------------+
```

**Elements**:
- Heading: "Deploy OpenClaw under 1 minute"
- Subheading: "Avoid all technical complexity and one-click deploy your own 24/7 active OpenClaw instance under 1 minute."
- Centered text alignment
- Large heading size, standard body size for description

### 4.3 Model Selection Cards

Three horizontally arranged cards (responsive: stacks vertically on mobile).

```
+------------------+  +------------------+  +------------------+
|   [Claude Icon]  |  |  [GPT Icon]      |  |  [Gemini Icon]   |
|                  |  |                   |  |                  |
| Claude Opus 4.5  |  |   GPT-5.2        |  | Gemini 3 Flash   |
|                  |  |                   |  |                  |
+------------------+  +------------------+  +------------------+
```

**Card anatomy**:
- Icon/Logo: SVG icon for each AI provider
  - Claude: Claude AI symbol (sourced from Wikimedia Commons SVG)
  - GPT: ChatGPT icon (external CDN)
  - Gemini: Google Gemini icon (Wikimedia Commons SVG)
- Model name: Bold text label
- Selection state: One card is selected at a time (radio-button behavior)
- Border highlight on selected card (likely brighter border or accent color)

**Layout**: `grid grid-cols-1 md:grid-cols-3 gap-4` (estimated)

**Interaction**: Click to select. Only one can be active. Selected state shows visual distinction (border color change, background subtle shift, or checkmark).

### 4.4 Channel Selection Cards

Three horizontally arranged cards, one with a "Coming soon" badge.

```
+------------------+  +------------------+  +------------------+
|  [Telegram Icon] |  |  [Discord Icon]  |  | [WhatsApp Icon]  |
|                  |  |                   |  |                  |
|    Telegram      |  |    Discord        |  |   WhatsApp       |
|                  |  |                   |  |  "Coming soon"   |
+------------------+  +------------------+  +------------------+
```

**Card anatomy**:
- Icon/Logo: Platform icon
  - Telegram: Standard Telegram icon
  - Discord: Discord icon (external CDN)
  - WhatsApp: WhatsApp icon
- Channel name: Text label
- Badge: "Coming soon" on WhatsApp card
- Disabled state: WhatsApp card is non-interactive, visually muted

**Interaction**: Same radio-button behavior as model cards. WhatsApp is disabled/greyed out with a badge overlay.

### 4.5 Sign-In / CTA Section

```
+------------------------------------------------------------------+
|                                                                    |
|              [ Sign in with Google ]                               |
|                                                                    |
|   Sign in to deploy your AI assistant and connect your channels.  |
|   Checking availability...                                        |
|                                                                    |
+------------------------------------------------------------------+
```

**Elements**:
- Google Sign-In button (likely using Google's OAuth identity button or a styled custom button)
- Descriptive text: "Sign in to deploy your AI assistant and connect your channels."
- Status text: "Checking availability..." (dynamic -- likely checks server/VM availability)

**Implementation notes**:
- Uses Google OAuth for authentication
- The "Checking availability..." text suggests a real-time API call to check if VM slots are available
- Button likely triggers `next-auth` or similar OAuth flow

### 4.6 Comparison Table

```
+------------------------------------------------------------------+
|        Traditional Method vs Clawgent                           |
+------------------------------------------------------------------+
|                                                                    |
|  Traditional Method (60 min):    |    Clawgent:                 |
|  --------------------------------|--------------------------------|
|  1. Purchasing VM: 15 min        |                                |
|  2. SSH keys: 10 min             |    < 1 min                     |
|  3. SSH connection: 5 min        |                                |
|  4. Node.js/NPM: 5 min          |    "Pick model, connect        |
|  5. OpenClaw install: 7 min      |     Telegram, deploy - done"   |
|  6. Setup: 10 min                |                                |
|  7. AI provider: 4 min           |                                |
|  8. Telegram pairing: 4 min      |                                |
|  --------------------------------|--------------------------------|
|  Total: 60 min                   |    < 1 min                     |
|                                                                    |
|  "If non-technical, multiply times by 10"                         |
|                                                                    |
+------------------------------------------------------------------+
```

**Structure**: Two-column comparison layout
- Left column: "Traditional Method" with 8 numbered steps and time for each
- Right column: "Clawgent" with single "<1 min" value
- Footer note: Italicized or smaller text with the "multiply by 10" callout
- Section heading: "Traditional Method vs Clawgent"

**Traditional Method Steps (exact)**:
1. Purchasing VM: 15 min
2. SSH keys: 10 min
3. SSH connection: 5 min
4. Node.js/NPM: 5 min
5. OpenClaw install: 7 min
6. Setup: 10 min
7. AI provider: 4 min
8. Telegram pairing: 4 min
- **Total: 60 min**

**Clawgent Side**:
- Time: "<1 min"
- Description: "Pick model, connect Telegram, deploy -- done"

### 4.7 Use Cases Grid

Five category columns, each with multiple items. Displayed as a grid of small tags or cards.

```
+------------+------------+------------+------------+------------+
|   Email    | Scheduling |  Shopping  |  Business  |   Work     |
+------------+------------+------------+------------+------------+
| Read/      | Reminders  | Payroll    | Contracts  | News       |
| Summarize  | Weekly     | Refunds    | Research   | monitoring |
| Draft      | planning   | Coupons    | Lead       | Goal       |
| replies    | Meeting    | Price      | screening  | tracking   |
| Translate  | notes      | comparison | Invoices   | Outreach   |
| Organize   | Time zones | Discount   | Present-   | Job desc.  |
| Support    | Taxes      | codes      | ations     | Standups   |
| tickets    | Expenses   | Alerts     | Travel     | OKRs       |
| Doc        | Subscript- | Specs      | Recipes    |            |
| summary    | ions       |            | Social     |            |
| Meeting    |            |            | posts      |            |
| notify     |            |            |            |            |
| Schedule   |            |            |            |            |
+------------+------------+------------+------------+------------+
```

**Full item list by category**:

**Email**:
- Read and summarize emails
- Draft replies and follow-ups
- Translate messages
- Organize inbox
- Handle support tickets
- Summarize long documents
- Meeting notifications
- Schedule management

**Scheduling / Planning**:
- Deadline reminders
- Weekly planning
- Meeting notes
- Time zone coordination
- Tax preparation
- Expense tracking
- Insurance management
- Subscription management

**Shopping / Finance**:
- Payroll calculations
- Refund negotiations
- Coupon finding
- Price comparison
- Discount code alerts
- Product spec lookup
- Deal tracking

**Business**:
- Contract review
- Market research
- Lead screening
- Invoice generation
- Presentation creation
- Travel booking
- Recipe management
- Social media posts

**Work / Operations**:
- News monitoring
- Goal tracking
- Outreach campaigns
- Job descriptions
- Daily standups
- OKR tracking

**Footer note**: "PS. You can add as many use cases as you want via natural language"

**Layout**: Multi-column grid, likely `grid-cols-2 md:grid-cols-4 lg:grid-cols-5`, with each item as a small pill/tag or compact card.

### 4.8 Footer

```
+------------------------------------------------------------------+
|                                                                    |
|          Built with [heart] by Savio Martin                       |
|          [X/Twitter link]    [Contact Support]                     |
|                                                                    |
+------------------------------------------------------------------+
```

**Elements**:
- Attribution: "Built with [heart emoji] by Savio Martin"
- Link to creator's X/Twitter: `http://x.com/saviomartin7`
- Contact support link: `mailto:savio@clawgent.com`
- Minimal, centered layout

---

## 5. User Journey

### 5.1 Pre-Auth Flow (Landing Page)

```
ARRIVE at clawgent.com
    |
    v
SEE hero headline ("Deploy OpenClaw under 1 minute")
    |
    v
SCROLL to model selection
    |
    v
SELECT AI model (Claude Opus 4.5 / GPT-5.2 / Gemini 3 Flash)
    |
    v
SELECT channel (Telegram / Discord)
    |
    v
CLICK "Sign in with Google"
    |
    v
GOOGLE OAuth popup/redirect
    |
    v
RETURN to Clawgent (authenticated)
```

### 5.2 Post-Auth Flow (Inferred from research)

```
AUTHENTICATED
    |
    v
SERVER AVAILABILITY CHECK
    |
    +-- If available:
    |       |
    |       v
    |   PLAN/SERVER SELECTION
    |       |
    |       v
    |   ENTER API KEY (for chosen AI model)
    |       |
    |       v
    |   ENTER BOT TOKEN (Telegram/Discord bot token)
    |       |
    |       v
    |   CLICK DEPLOY
    |       |
    |       v
    |   VM PROVISIONED (~60 seconds)
    |       |
    |       v
    |   DASHBOARD URL PROVIDED
    |       |
    |       v
    |   AI ASSISTANT ACTIVE on chosen channel
    |
    +-- If not available:
            |
            v
        WAITLIST / "Check back later" message
```

### 5.3 Post-Deployment Experience

Based on research, after deployment users receive:
- A dashboard URL for their OpenClaw instance
- The ability to verify connectivity
- Settings for API key management
- Automatic SSH, updates, and backup management by Clawgent
- Option to export webhook specs and test custom skills

---

## 6. Interactive Patterns

### 6.1 Card Selection (Radio Group)

**Behavior**: Model and channel cards function as radio button groups.
- Only one card per group can be selected at a time
- Clicking a new card deselects the previous one
- Visual state change on selection (border highlight, background shift, or checkmark icon)

**States**:
| State | Visual Treatment |
|-------|-----------------|
| Default | Subtle border (`border-white/10`), dark background |
| Hover | Slightly brighter border or background lift |
| Selected | Accent border color, possible subtle background tint, possible checkmark |
| Disabled | Reduced opacity (`opacity-50`), "Coming soon" badge, cursor-not-allowed |

### 6.2 Google Sign-In Button

**Behavior**: Standard OAuth flow
- Click triggers Google OAuth consent screen (popup or redirect)
- On success, redirects back to Clawgent with auth token
- The "Checking availability..." text likely shows a loading spinner or pulsing animation

**States**:
| State | Visual Treatment |
|-------|-----------------|
| Default | Google-branded button (white bg with Google logo + text) |
| Hover | Slight shadow or brightness change |
| Loading | "Checking availability..." text, possible spinner |
| Disabled | Greyed out if no model/channel selected |

### 6.3 Scroll Behavior

- Smooth scroll, no snap points
- No sticky header (header is minimal and static)
- Content flows naturally from hero -> cards -> CTA -> social proof -> footer
- No parallax or scroll-triggered animations detected

### 6.4 "Coming Soon" Badge

- Static badge overlaid on WhatsApp card
- Prevents interaction with the card
- Visual: Muted/greyed card appearance with a small text badge

---

## 7. Content Inventory

### 7.1 All Text Strings

**Meta**:
- `<title>`: "Clawgent -- Deploy OpenClaw under 1 Minute"
- `<meta description>`: "Deploy OpenClaw under 1 minute. Avoid technical complexity"
- `<meta keywords>`: "Clawgent, OpenClaw, deploy, AI, Claude, Telegram, bot"

**Hero**:
- Heading: "Deploy OpenClaw under 1 minute"
- Subheading: "Avoid all technical complexity and one-click deploy your own 24/7 active OpenClaw instance under 1 minute."

**Model Cards**:
- "Claude Opus 4.5"
- "GPT-5.2"
- "Gemini 3 Flash"

**Channel Cards**:
- "Telegram"
- "Discord"
- "WhatsApp"
- "Coming soon" (badge on WhatsApp)

**Sign-In Section**:
- "Sign in with Google" (button text)
- "Sign in to deploy your AI assistant and connect your channels."
- "Checking availability..."

**Comparison Section**:
- "Traditional Method vs Clawgent"
- "Purchasing VM: 15 min"
- "SSH keys: 10 min"
- "SSH connection: 5 min"
- "Node.js/NPM: 5 min"
- "OpenClaw install: 7 min"
- "Setup: 10 min"
- "AI provider: 4 min"
- "Telegram pairing: 4 min"
- "60 min" (total)
- "<1 min" (Clawgent time)
- "Pick model, connect Telegram, deploy -- done"
- "If non-technical, multiply times by 10"

**Use Cases Section**:
- (See full list in Section 4.7 above)
- "PS. You can add as many use cases as you want via natural language"

**Footer**:
- "Built with [heart] by Savio Martin"
- "Contact Support"

### 7.2 External Assets

| Asset | Source | Usage |
|-------|--------|-------|
| Claude icon | Wikimedia Commons SVG | Model selection card |
| ChatGPT icon | External CDN | Model selection card |
| Gemini icon | Wikimedia Commons SVG | Model selection card |
| Telegram icon | Standard icon set | Channel selection card |
| Discord icon | External CDN | Channel selection card |
| WhatsApp icon | Standard icon set | Channel selection card |
| Google logo | Google OAuth button standard | Sign-in button |
| Meta image | `clawgent.vercel.app/meta.png` | OG/social share image |
| Favicon | Standard favicon files | Browser tab |

---

## 8. Post-Auth Experience

### What We Know (from external research)

Clawgent's post-authentication experience is not publicly visible on the landing page. Based on third-party documentation and articles:

1. **Server/Plan Selection**: Users choose from available cloud servers. Inventory is limited, implying a capacity-constrained model.

2. **Messaging Provider Connection**: An interface where users paste their bot tokens (Telegram Bot Token from BotFather, or Discord bot token). The system auto-validates these tokens.

3. **AI Model Configuration**: Users input their API key for the chosen AI provider (Anthropic key for Claude, OpenAI key for GPT, Google key for Gemini) and configure basic preferences.

4. **Deployment**: One-click deploy that provisions a VM, installs OpenClaw, configures the environment, and starts the agent.

5. **Dashboard**: Users receive a dashboard URL. The dashboard shows:
   - Agent health status
   - Connection status
   - Settings for token/key management
   - Possibly usage metrics

6. **Ongoing Management**: Clawgent handles SSH access, updates, and backups automatically.

### What We Don't Know

- Exact dashboard UI/layout
- Pricing page design
- Error states and edge cases
- Onboarding tutorial or guided setup flow
- Account settings page
- Billing/subscription management interface

---

## 9. Developer Implementation Guide

### 9.1 Technology Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js (App Router) |
| UI Library | React |
| Styling | Tailwind CSS |
| Font | Inter (via `next/font/google`) |
| Auth | Google OAuth (likely via `next-auth` or similar) |
| Hosting | Vercel |
| Icons | Mix of SVGs from Wikimedia Commons and CDN-hosted icons |

### 9.2 Page Structure (React Components)

```
<html lang="en">
  <body class="bg-[#07080a] text-white font-sans antialiased overflow-x-hidden min-h-dvh">
    <Header />
    <main>
      <HeroSection />
      <ModelSelection />      // 3 selectable cards, radio group
      <ChannelSelection />    // 3 cards (1 disabled), radio group
      <SignInSection />        // Google OAuth + availability check
      <ComparisonTable />      // Two-column traditional vs Clawgent
      <UseCasesGrid />         // Multi-column grid of use case tags
    </main>
    <Footer />
  </body>
</html>
```

### 9.3 State Management

Minimal client-side state needed:
- `selectedModel`: `'claude' | 'gpt' | 'gemini'` (default: `'claude'`)
- `selectedChannel`: `'telegram' | 'discord' | null` (default: `'telegram'`)
- `isAvailable`: `boolean` (result of availability check API call)
- `isAuthenticated`: `boolean` (Google OAuth state)

### 9.4 Component Specifications

#### `<ModelCard />`

```typescript
interface ModelCardProps {
  id: string;               // 'claude' | 'gpt' | 'gemini'
  name: string;             // 'Claude Opus 4.5' | 'GPT-5.2' | 'Gemini 3 Flash'
  icon: ReactNode;          // SVG icon component
  selected: boolean;
  onSelect: (id: string) => void;
}
```

**Tailwind classes (estimated)**:
```
// Base
"relative flex flex-col items-center gap-3 p-6 rounded-xl border cursor-pointer transition-all"

// Default state
"border-white/10 bg-white/5"

// Selected state
"border-blue-500 bg-blue-500/10" (or similar accent)

// Hover state
"hover:border-white/20 hover:bg-white/[0.08]"
```

#### `<ChannelCard />`

```typescript
interface ChannelCardProps {
  id: string;               // 'telegram' | 'discord' | 'whatsapp'
  name: string;
  icon: ReactNode;
  selected: boolean;
  disabled: boolean;         // true for WhatsApp
  badge?: string;            // 'Coming soon'
  onSelect: (id: string) => void;
}
```

#### `<ComparisonTable />`

Two-column layout. Left column is a numbered list of steps with time durations. Right column is a single large "<1 min" with a tagline.

#### `<UseCasesGrid />`

Grid of pill-shaped tags organized by category. Each category has a heading and a list of items rendered as small rounded elements.

```typescript
interface UseCaseCategory {
  title: string;            // 'Email', 'Scheduling', etc.
  items: string[];          // ['Read and summarize', 'Draft replies', ...]
}
```

### 9.5 Responsive Breakpoints

| Breakpoint | Layout Behavior |
|-----------|----------------|
| Mobile (`<640px`) | Single column cards, stacked layout |
| Tablet (`640px-1024px`) | 2-column card grids, adjusted spacing |
| Desktop (`>1024px`) | 3-column card grids, full comparison table side-by-side |

### 9.6 Key Implementation Notes

1. **No traditional navigation**: The page is a single vertical scroll. No router needed for the landing page itself.

2. **Card selection as radio groups**: Use React state to track selection. Only one card per group (model/channel) can be active.

3. **Google OAuth**: Implement via `next-auth` with Google provider. The sign-in button should be disabled until both model and channel are selected (or always enabled with validation).

4. **Availability check**: An API endpoint that checks if VM slots are available. Show "Checking availability..." with a loading state on page load or after auth.

5. **SVG icons**: Host the AI model and channel icons locally rather than depending on external CDNs (Wikimedia, etc.) for reliability.

6. **Meta/SEO**: Include proper `<title>`, `<meta description>`, OpenGraph tags with the meta image.

7. **Dark theme is the only theme**: No light mode toggle needed. The `#07080a` background is hardcoded.

8. **Minimal JavaScript**: The landing page is largely static content with two interactive card groups and one OAuth button. Server-side rendering with minimal client-side hydration.

9. **Emoji in footer**: The heart emoji in "Built with [heart] by..." is a literal emoji character, not an icon component.

10. **"Coming soon" pattern**: Reusable for future channels -- design the card component to accept a `disabled` + `badge` prop.

---

## Appendix A: Visual Mockup Reference

### Full Page Layout (ASCII)

```
================================================================
|  [Contact Support]                                            |
================================================================
|                                                                |
|           Deploy OpenClaw under 1 minute                      |
|                                                                |
|   Avoid all technical complexity and one-click deploy your    |
|   own 24/7 active OpenClaw instance under 1 minute.          |
|                                                                |
================================================================
|                                                                |
|  +----------------+  +----------------+  +----------------+   |
|  | [Claude Icon]  |  | [GPT Icon]     |  | [Gemini Icon]  |   |
|  | Claude         |  | GPT-5.2        |  | Gemini 3       |   |
|  | Opus 4.5       |  |                |  | Flash          |   |
|  +---[SELECTED]---+  +----------------+  +----------------+   |
|                                                                |
================================================================
|                                                                |
|  +----------------+  +----------------+  +----------------+   |
|  | [Telegram]     |  | [Discord]      |  | [WhatsApp]     |   |
|  | Telegram       |  | Discord        |  | WhatsApp       |   |
|  |                |  |                |  | Coming soon    |   |
|  +---[SELECTED]---+  +----------------+  +----[DISABLED]--+   |
|                                                                |
================================================================
|                                                                |
|           [  Sign in with Google  ]                           |
|                                                                |
|   Sign in to deploy your AI assistant and connect your        |
|   channels. Checking availability...                          |
|                                                                |
================================================================
|                                                                |
|        Traditional Method vs Clawgent                       |
|                                                                |
|  Traditional Method:        |  Clawgent:                    |
|  1. Purchasing VM    15 min |                                 |
|  2. SSH keys         10 min |       < 1 min                   |
|  3. SSH connection    5 min |                                 |
|  4. Node.js/NPM      5 min |  Pick model, connect Telegram,  |
|  5. OpenClaw install  7 min |  deploy -- done                 |
|  6. Setup            10 min |                                 |
|  7. AI provider       4 min |                                 |
|  8. Telegram pair     4 min |                                 |
|  Total:              60 min |                                 |
|                                                                |
|  * If non-technical, multiply times by 10                     |
|                                                                |
================================================================
|                                                                |
|  [Email]     [Scheduling] [Shopping]  [Business]   [Work]     |
|  Read/sum    Reminders    Payroll     Contracts    News        |
|  Draft       Planning     Refunds     Research     Goals       |
|  Translate   Notes        Coupons     Leads        Outreach    |
|  Organize    Time zones   Prices      Invoices     Job desc    |
|  Support     Taxes        Discounts   Presents     Standups    |
|  Doc sum     Expenses     Alerts      Travel       OKRs        |
|  Meeting     Subs         Specs       Recipes                  |
|  Schedule                             Social                   |
|                                                                |
|  PS. You can add as many use cases as you want via            |
|  natural language                                              |
|                                                                |
================================================================
|                                                                |
|        Built with [heart] by Savio Martin                     |
|        [X/Twitter]   [Contact Support]                         |
|                                                                |
================================================================
```

---

## Appendix B: Competitive UX Positioning

Clawgent positions itself against:
1. **Manual VM deployment** (the "Traditional Method" in the comparison)
2. **Other OpenClaw hosting services** (Zeabur templates, DigitalOcean tutorials, Cloudflare Workers setups)

Key UX differentiators:
- **Speed**: Under 1 minute vs 60+ minutes
- **No technical knowledge required**: No SSH, no CLI, no config files
- **Pre-configured model selection**: Users choose from a curated list rather than configuring API endpoints manually
- **Channel-first approach**: Users pick their messaging platform upfront, making the value immediately tangible

---

## Appendix C: Unknowns and Recommendations for Further Research

1. **Exact accent colors**: Requires browser DevTools inspection to get precise hex values for selected states, hover states, and accent elements.

2. **Animation details**: No explicit animations detected from HTML analysis, but there may be Framer Motion or CSS transitions on card selection and page load.

3. **Post-auth UI**: The dashboard, deployment progress screen, and account management pages are behind authentication and cannot be analyzed without an account.

4. **Error states**: How the UI handles failed OAuth, unavailable servers, invalid API keys, etc.

5. **Mobile experience**: Exact responsive breakpoints and mobile-specific layouts need device testing or responsive DevTools inspection.

6. **Pricing/plans**: Not visible on the landing page. May be revealed post-auth or on a separate page.

7. **Loading states**: The "Checking availability..." text suggests loading states exist -- full loading/skeleton screen patterns are unknown.
