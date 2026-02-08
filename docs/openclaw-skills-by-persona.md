# OpenClaw Skills & Capabilities by Business Persona

> **Purpose**: This document maps OpenClaw's actual capabilities and community-built skills to specific business personas. It informs Clawgent's product positioning, pre-configured instance templates, and marketing messaging. Each persona section is grounded in real OpenClaw features, ClawHub skills (5,700+ in the registry as of Feb 2026), and documented community workflows.
>
> **Last Updated**: 2026-02-08 (v2 -- added community research from Hacker News, X, Substack, and review sites)

---

## Table of Contents

1. [How OpenClaw Works (Quick Primer)](#how-openclaw-works)
2. [Marketing Teams](#1-marketing-teams)
3. [Sales Teams](#2-sales-teams)
4. [Lead Generation Agencies](#3-lead-generation-agencies)
5. [Software Development Teams](#4-software-development-teams)
6. [Customer Support](#5-customer-support)
7. [Operations / Admin](#6-operations--admin)
8. [Founders / Solopreneurs](#7-founders--solopreneurs)
9. [Data Analytics](#8-data-analytics)
10. [Community Picks (Hacker News, X, Reviews)](#community-picks)
11. [Summary Table](#summary-table)
12. [Clawgent Template Recommendations](#clawgent-template-recommendations)
13. [Sources](#sources)

---

## How OpenClaw Works

OpenClaw is a self-hosted AI agent gateway that connects LLMs (Claude, GPT-4, local models) to your local machine, files, and messaging apps. It runs 24/7 and executes tasks autonomously through:

- **7 Core Modules**: Shell commands, file system, browser automation, messaging integration, smart home, workflow automation, visualization
- **Skills System**: Installable capability packages (SKILL.md files) from ClawHub registry or custom-built
- **SOUL.md**: Persona/personality configuration that defines how the agent communicates and behaves
- **Multi-Agent Routing**: Multiple agents with different roles, models, and permissions running simultaneously
- **Channels**: WhatsApp, Telegram, Discord, Slack, and web interfaces for interaction

**Key technical detail for Clawgent**: Each OpenClaw instance can be pre-configured with specific skills, a SOUL.md persona, and model settings before deployment. This means Clawgent can offer persona-specific templates.

---

## 1. Marketing Teams

### Top Skills & Use Cases

> **Community signal**: Content repurposing and SEO are the most validated marketing use cases. However, community testers consistently warn about hallucination risk in generated copy -- always add a human review step. One user reported 47 backlinks in a month from automated outreach. The `keyword-research` skill (Google Autocomplete + Brave Search for low-competition keywords) is a community favorite that complements the SEO engine.

#### 1.1 SEO Content Engine
**Status**: Production-ready (ClawHub skill + community workflows)

Takes a target keyword, performs competitive research via web search, analyzes top-ranking content, and produces a fully optimized blog post with proper heading structure, internal linking suggestions, and meta descriptions.

**Example prompt**:
```
Research the keyword "AI customer support tools 2026". Analyze the top 5 ranking
articles. Write a 2,000-word SEO-optimized blog post that covers gaps the
competitors miss. Include a meta description and 3 title variations.
```

**Configuration**:
- Skills: `seo-content-engine`, `web-search`, `file-write`
- Model: Claude 4.5 or GPT-4 (strong reasoning needed for competitive analysis)
- SOUL.md: Set brand voice guidelines, tone, and content standards

#### 1.2 Content Repurposing Across Platforms
**Status**: Production-ready (core browser + file system modules)

Takes a single piece of content (blog post, video transcript, report) and adapts it into platform-specific versions for X/Twitter, LinkedIn, Instagram captions, email newsletters, and more. Handles character limits, hashtag strategies, and format differences automatically.

**Example prompt**:
```
Take the blog post at ./content/ai-trends-2026.md and create:
- 5 Twitter/X threads (each 5-8 tweets)
- 2 LinkedIn posts (professional tone, 1300 chars max)
- 3 Instagram captions with relevant hashtags
- 1 email newsletter intro paragraph
Save each to ./social-content/ai-trends/
```

#### 1.3 Brand Monitoring & Sentiment Analysis
**Status**: Production-ready (browser automation + scheduled workflows)

Monitors brand mentions on X/Twitter, Reddit, Hacker News, and other platforms. Analyzes sentiment, flags posts requiring response, and drafts on-brand replies for review.

**Example prompt**:
```
Every 4 hours, search X for mentions of "Clawgent" or "openclaw deployment".
Log each mention with sentiment score (positive/neutral/negative) to
./monitoring/mentions.csv. Flag any negative mentions in Slack #brand-alerts
with a suggested response draft.
```

**Configuration**:
- Skills: `brand-monitor`, `sentiment-analyzer`, `slack-integration`
- Workflow: Cron-scheduled (every 4 hours)
- SOUL.md: Include brand voice guidelines and approved response templates

#### 1.4 Email Campaign Copy Generation
**Status**: Production-ready (ClawHub skill)

Generates high-converting email sequences: welcome series, sales funnels, abandoned cart recoveries, re-engagement campaigns, and newsletters. Tuned for email-specific copywriting patterns (subject lines, preview text, CTA placement).

**Example prompt**:
```
Create a 5-email welcome sequence for new Clawgent trial users:
1. Welcome + quick start guide
2. Day 2: First use case tutorial
3. Day 5: Advanced features showcase
4. Day 10: Customer success story
5. Day 14: Upgrade offer

Tone: Friendly, technical-but-accessible. Include subject lines and preview text.
```

#### 1.5 Competitor Backlink Outreach
**Status**: Production-ready (browser automation + file system)

Scans competitor backlink profiles, visits linked pages to check for 404s or outdated content, finds site owner contact information, and drafts personalized outreach pitches for broken link building or guest posting.

**Example prompt**:
```
Analyze the backlink profile of competitor.com. Find 20 broken links pointing
to their site. For each, draft a personalized outreach email offering our
equivalent content as a replacement. Save results to ./outreach/broken-links.csv.
```

---

## 2. Sales Teams

### Top Skills & Use Cases

> **Community signal**: Prospect research is the highest-confidence sales use case -- it is read-only, synthesizes public information, and produces a document (easy to verify). CRM updates and financial actions carry more risk because LLM errors can create irreversible consequences. HN commenters specifically warn: "banks likely won't protect users if bots drain accounts, unlike human assistants with legal recourse." Use human approval gates for any action that modifies external systems.

#### 2.1 Prospect Research & Briefing
**Status**: Production-ready (browser automation + web search)

Before sales calls, automatically researches prospects: company background, recent news, tech stack, funding rounds, team size, and competitive landscape. Produces a one-page briefing document.

**Example prompt**:
```
Research the company "Acme Corp" before my sales call tomorrow at 2pm.
Find: company size, recent funding, tech stack (check job postings),
key decision makers on LinkedIn, recent blog posts or press releases,
and any mentions of competitor products. Save a 1-page briefing to
./sales/briefs/acme-corp.md
```

**Configuration**:
- Skills: `web-search`, `browser-navigate`, `file-write`
- Model: Claude 4.5 (strong at synthesis and summarization)
- SOUL.md: Professional, concise, fact-focused

#### 2.2 CRM Data Management
**Status**: Production-ready (Salesforce skill available on ClawHub)

Queries and manages Salesforce CRM data via the Salesforce CLI. Can update records, generate pipeline reports, and flag stale opportunities.

**Example prompt**:
```
Pull all opportunities in "Negotiation" stage that haven't been updated
in 14+ days. For each, check if there's a recent email thread in Gmail.
Generate a follow-up priority list sorted by deal size, with suggested
next actions.
```

**Configuration**:
- Skills: `salesforce-cli`, `gmail-integration`
- Environment variables: `SALESFORCE_AUTH_TOKEN`, `GMAIL_OAUTH`

#### 2.3 Proposal & Document Generation
**Status**: Production-ready (ClawHub skill)

Generates professional proposals with scope, timeline, pricing tables, and terms. Can pull from templates, customize per prospect, and output as PDF or Markdown.

**Example prompt**:
```
Generate a proposal for Acme Corp based on our Standard tier template.
Customize: company name, 50-user deployment, enterprise support add-on.
Calculate pricing with 15% annual discount. Export as PDF to
./proposals/acme-corp-2026-02.pdf
```

#### 2.4 Outreach Sequence Drafting
**Status**: Production-ready (email marketing skill)

Writes personalized cold outreach sequences based on prospect research. Varies messaging across touchpoints (email, LinkedIn, follow-up).

**Example prompt**:
```
Write a 4-touch outreach sequence for CTOs at Series B SaaS companies.
Pain point: developer productivity. Our solution: one-click AI assistant
deployment. Include: initial email, LinkedIn connection request message,
follow-up email (5 days later), and break-up email (10 days later).
```

#### 2.5 Meeting Transcription & Action Items
**Status**: Production-ready (core capability)

Transcribes meeting recordings, extracts action items with owners and deadlines, generates summaries, and creates follow-up email drafts.

**Example prompt**:
```
Transcribe the recording at ./meetings/acme-discovery-call.mp3.
Extract: key pain points mentioned, decision criteria, timeline,
budget range, next steps with owners. Draft a follow-up email
summarizing what we discussed and confirming next steps.
```

---

## 3. Lead Generation Agencies

### Top Skills & Use Cases

> **Community signal**: Web scraping is one of the most commercially validated skills -- custom scraping projects bill $200-2,000 each on freelancing platforms. However, browser automation is described as "brittle" by HN users, with pages breaking when structure changes. The `job-auto-apply` skill (automated job search and application) demonstrates the pattern: high-value automation of repetitive form-filling and data extraction. The `lead-hunter` skill captures leads into Supabase with Make.com integration. For LinkedIn, a community skill supports automated posting with image upload and commenting with @mentions, though LinkedIn's terms of service compliance is a concern.

#### 3.1 Web Scraping & Data Extraction
**Status**: Production-ready (core browser module + ClawHub skill)

Configurable scraping that extracts structured data from websites with pagination, rate limiting, and multiple output formats (CSV, JSON, database). Uses AI to understand page structure automatically through OpenClaw's Snapshot System.

**Example prompt**:
```
Scrape all SaaS companies listed on G2 in the "Project Management" category.
Extract: company name, website, pricing tier, number of reviews, average rating,
and key features listed. Handle pagination. Export to ./data/g2-pm-tools.csv.
Rate limit: 1 request per 3 seconds.
```

**Configuration**:
- Skills: `web-scraper`, `browser-navigate`, `csv-export`
- Sandbox: Enable browser automation
- Important: Respect robots.txt and rate limits

#### 3.2 Lead Enrichment Pipeline
**Status**: Production-ready (ClawHub `lead-hunter` skill)

Takes a list of company names or domains and enriches with: employee count, tech stack, decision-maker contacts, social profiles, funding data, and company news.

**Example prompt**:
```
Take the list of 50 companies in ./leads/raw-list.csv.
For each company, find: website, industry, employee count (from LinkedIn),
tech stack (from BuiltWith or job postings), CTO/VP Engineering name and
LinkedIn URL. Save enriched data to ./leads/enriched.csv.
Skip any company where we can't verify the domain.
```

#### 3.3 Landing Page Generation
**Status**: Production-ready (full-stack website builder skill)

Generates complete, deployable landing pages from a business brief: responsive design, SEO structure, contact forms, and deployment-ready code. Can produce multiple variants for A/B testing.

**Example prompt**:
```
Create a landing page for our "AI Sales Assistant" product targeting
Series A startup founders. Include: hero section with value prop,
3 feature blocks, social proof section (placeholder testimonials),
pricing comparison table, and a demo request form. Use Tailwind CSS.
Output to ./landing-pages/ai-sales-v1/
```

#### 3.4 Outbound Sequence Automation
**Status**: Production-ready (email + workflow skills)

Builds multi-channel outbound sequences that combine email, LinkedIn, and follow-up cadences. Generates personalized messaging at scale based on prospect data.

**Example prompt**:
```
Using the enriched leads in ./leads/enriched.csv, generate personalized
outbound sequences for each lead. Personalize based on: their tech stack,
recent company news, and role. Create 3 email variants per lead for A/B testing.
Output a ready-to-import CSV for our email sending tool.
```

#### 3.5 Campaign Performance Reporting
**Status**: Production-ready (data analytics + visualization)

Pulls campaign metrics, calculates conversion rates across funnel stages, identifies top-performing segments, and generates client-ready reports with charts.

**Example prompt**:
```
Analyze the outbound campaign data in ./campaigns/q1-2026.csv.
Calculate: open rate, reply rate, positive reply rate, and meeting booked
rate by segment (industry, company size, persona). Generate a client report
with charts showing performance trends over the past 4 weeks.
Save to ./reports/q1-campaign-review.pdf
```

---

## 4. Software Development Teams

### Top Skills & Use Cases

> **Community signal**: Developer workflows are by far the most validated use case across all community sources. One HN user runs OpenClaw as a supervisor agent managing multiple Claude Code instances via shared tmux sessions -- "productive work from iPhone while away from desk" -- spending $400/month on subscriptions. Another user on the OpenClaw Showcase set up a workflow where OpenClaw finishes code changes, opens a PR, reviews the diff with suggestions, and sends a summary via Telegram. The Cline community (OpenClaw's VS Code predecessor, 4M+ developers) validates Plan/Act mode for controlled coding workflows.

#### 4.1 Code Generation & Scaffolding
**Status**: Production-ready (core file system + shell modules)

Generates boilerplate code, scaffolds new projects, creates CRUD endpoints, database migrations, and test files from natural language descriptions. Has direct access to the file system and can run build tools.

**Example prompt**:
```
Create a new Express.js API endpoint for user management.
Include: CRUD routes, Zod validation schemas, Prisma model,
migration file, and Jest unit tests for each route handler.
Follow the patterns in ./src/routes/products/ as a reference.
```

**Configuration**:
- Skills: `coding-agent` (133 coding skills available on ClawHub)
- Model: Claude 4.5 (strongest at code generation)
- Sandbox: Enable shell commands for running tests/builds
- SOUL.md: Code review standards, preferred patterns, linting rules

#### 4.2 Pull Request Review & Summarization
**Status**: Production-ready (Git/GitHub skills - 66 available on ClawHub)

Summarizes code changes in PRs, flags potential risks (security, performance, breaking changes), suggests improvements, and generates review comments.

**Example prompt**:
```
Review the diff for PR #142 on our repo. Check for: security vulnerabilities,
performance issues, missing error handling, test coverage gaps, and style
violations per our .eslintrc. Generate review comments for each issue found.
Summarize the PR in 3 sentences for the team standup.
```

#### 4.3 Automated Documentation
**Status**: Production-ready (ClawHub skill: code documentation generator)

Reads codebases and produces professional documentation: API references, user guides, architecture overviews, README files, and inline comments. Can maintain docs as code changes.

**Example prompt**:
```
Generate API documentation for all endpoints in ./src/routes/.
For each endpoint, document: method, path, request body schema,
response schema, authentication requirements, and example curl commands.
Output as OpenAPI 3.0 spec and a readable Markdown file.
```

#### 4.4 CI/CD Pipeline Monitoring
**Status**: Production-ready (core workflow module)

Watches build pipelines for failures, notifies via Slack/Discord, provides failure analysis with suggested fixes, and can auto-retry flaky tests.

**Example prompt**:
```
Monitor our GitHub Actions workflows. When a build fails:
1. Analyze the failure log
2. Identify the root cause (test failure, dependency issue, timeout, etc.)
3. Post to #ci-alerts in Slack with: failed step, error message, and
   suggested fix
4. If it's a known flaky test (listed in ./ci/flaky-tests.txt), auto-retry
```

#### 4.5 Dependency Audit & Updates
**Status**: Production-ready (core shell + file system)

Identifies outdated packages, checks for known vulnerabilities, creates prioritized upgrade checklists with rollback plans, and can create PRs with updates.

**Example prompt**:
```
Audit all dependencies in package.json. For each outdated package:
- Check if it has known CVEs
- Check the changelog for breaking changes
- Categorize as: critical (security), important (major version), routine (patch)
Generate an upgrade plan sorted by priority. Create a branch and PR for
the routine updates.
```

---

## 5. Customer Support

### Top Skills & Use Cases

> **Community signal**: Customer support automation is high-value but high-risk. The HN community specifically flags prompt injection as the primary attack vector: a malicious customer could craft a ticket that manipulates the agent into exfiltrating internal data. Community consensus: use OpenClaw for triage, classification, and draft generation, but require human approval before any response is sent. The Inbox Zero pattern (processing 4,000+ emails in 2 days) is validated but carries the same prompt injection risk via inbound messages.

#### 5.1 Ticket Triage & Classification
**Status**: Production-ready (workflow automation + messaging integration)

Ingests support tickets, classifies by category (bug, feature request, billing, how-to), assigns priority based on context and urgency signals, and routes to the appropriate team.

**Example prompt**:
```
Monitor the #support-tickets Slack channel. For each new ticket:
1. Classify: bug / feature-request / billing / how-to / account-issue
2. Assign priority: P1 (service down), P2 (degraded), P3 (inconvenience), P4 (question)
3. Search our knowledge base at ./docs/kb/ for relevant articles
4. Draft a first response with the relevant KB link
5. Route to the correct team channel: #eng-bugs, #product-requests, #billing-team
```

**Configuration**:
- Skills: `slack-integration`, `file-search`, `sentiment-analyzer`
- Model: Claude 4.5 (strong at classification and nuanced understanding)
- SOUL.md: Empathetic, professional support voice. Clear escalation boundaries.
- **Security note**: Isolate tool permissions to prevent prompt injection from untrusted ticket text

#### 5.2 Knowledge Base Generation & Maintenance
**Status**: Production-ready (file system + browser modules)

Transforms support tickets, product docs, and customer interactions into searchable help articles. Identifies gaps in documentation based on recurring questions.

**Example prompt**:
```
Analyze the last 200 support tickets in ./support/tickets-jan-2026.csv.
Identify the top 10 most common questions that don't have a KB article.
For each, draft a help article with: title, problem description, step-by-step
solution, and related articles. Save to ./docs/kb/drafts/
```

#### 5.3 Response Template Drafting
**Status**: Production-ready (core capability)

Generates response templates for common support scenarios, personalized with customer context. Can pull account data to customize responses.

**Example prompt**:
```
Create response templates for these scenarios:
1. Account locked due to failed login attempts
2. Billing dispute for double charge
3. Feature not working as expected (generic)
4. Upgrade request with discount inquiry
5. Data export request (GDPR)
Include placeholders for: {{customer_name}}, {{account_id}}, {{specific_issue}}.
```

#### 5.4 Customer Feedback Analysis
**Status**: Production-ready (data analytics + sentiment)

Analyzes customer feedback at scale from surveys, reviews, support tickets, and social media. Identifies trends, recurring pain points, and feature requests.

**Example prompt**:
```
Analyze all NPS survey responses from Q4 2025 (./feedback/nps-q4.csv).
Group by: promoters, passives, detractors. For detractors, identify the
top 5 themes in their comments. For promoters, identify what they value
most. Generate an executive summary with actionable recommendations.
```

#### 5.5 Escalation Monitoring
**Status**: Production-ready (workflow automation)

Monitors ticket age, SLA breaches, and customer sentiment to proactively flag tickets at risk of escalation before they become critical.

**Example prompt**:
```
Every hour, check all open tickets in #support-tickets. Flag any ticket that:
- Is over 4 hours old without a response (SLA breach risk)
- Has negative sentiment in the last customer message
- Is from an enterprise account (listed in ./support/enterprise-accounts.txt)
Post flagged tickets to #support-escalations with context.
```

---

## 6. Operations / Admin

### Top Skills & Use Cases

> **Community signal**: The GIGAZINE reviewer runs what is arguably the most thorough ops setup documented: schedule checking every 15 minutes, 100+ daily group chat messages summarized, 30+ price alerts monitored, freezer inventory tracked in Notion, recipe-to-shopping-list conversion with fridge cross-referencing, and automated restaurant reservations via Resy/OpenTable (including reading 2FA texts). This runs on a dedicated Mac Mini 24/7. However, HN skeptics counter that many of these use cases create "notification overload rather than solving real problems" -- suggesting ops automation is most valuable when it replaces genuinely painful manual processes, not when it automates things people never bothered doing.

#### 6.1 Client Onboarding Automation
**Status**: Production-ready (workflow automation + file system)

Automates the full onboarding flow: creates project folders, sends welcome emails, schedules kickoff calls, sets up access credentials, and manages follow-up reminders.

**Example prompt**:
```
New client onboarding for "Acme Corp":
1. Create folder structure at ./clients/acme-corp/ (contracts, deliverables, comms)
2. Copy template files from ./templates/onboarding/
3. Send welcome email using template, personalized with client name and project scope
4. Create a Slack channel #client-acme-corp
5. Schedule kickoff call for next Tuesday at 10am
6. Set reminder: follow up on contract signature in 3 days
```

**Configuration**:
- Skills: `calendar-management`, `slack-integration`, `email-send`, `file-write`
- Workflow: Triggered by new client entry or manual command

#### 6.2 Invoice & Receipt Processing
**Status**: Production-ready (ClawHub skill)

Extracts vendor, date, amount, and category from receipt photos or PDF invoices. Logs entries into expense spreadsheets or accounting tools.

**Example prompt**:
```
Process all receipt images in ./expenses/february-2026/.
For each, extract: vendor name, date, amount, payment method, and category
(travel, software, meals, office supplies). Append to ./expenses/2026-log.csv.
Flag any expense over $500 for manager review.
```

#### 6.3 KPI Dashboard & Automated Reporting
**Status**: Production-ready (workflow automation + visualization)

Schedules automated metric snapshots, compiles KPIs from multiple sources, and sends formatted reports to Slack, Discord, or email.

**Example prompt**:
```
Every Monday at 9am, compile weekly KPIs:
- Revenue (from ./data/stripe-export.csv)
- New signups (from ./data/user-signups.csv)
- Support ticket volume and resolution time
- Active instances (from our API)
Format as a summary with week-over-week comparison.
Post to #weekly-metrics in Slack.
```

#### 6.4 Document Processing & Summarization
**Status**: Production-ready (file system + PDF skills - 67 available on ClawHub)

Summarizes contracts, reports, and reference materials. Extracts key terms, deadlines, and obligations. Can answer questions about document contents without sending data to external APIs (when using local models via Ollama).

**Example prompt**:
```
Read the vendor contract at ./contracts/cloud-hosting-2026.pdf.
Extract: term length, auto-renewal clause, cancellation notice period,
SLA guarantees, pricing tiers, and any liability limitations.
Summarize in a 1-page brief at ./contracts/summaries/cloud-hosting.md.
```

#### 6.5 Server & Infrastructure Health Monitoring
**Status**: Production-ready (shell commands + workflow automation)

Monitors disk, CPU, and memory usage with threshold-based alerts. Can execute safe remediation commands (log rotation, cache clearing, service restarts).

**Example prompt**:
```
Every 15 minutes, check server health:
- Disk usage on / and /data partitions
- CPU load average (1min, 5min, 15min)
- Memory utilization
- Docker container status
If disk > 85%, auto-rotate logs older than 7 days.
If any container is unhealthy, restart it and notify #ops-alerts.
```

---

## 7. Founders / Solopreneurs

### Top Skills & Use Cases

> **Community signal**: Solo founders are the second-most enthusiastic user group after developers. The multi-agent team pattern (4 agents with dedicated roles for strategy, development, marketing, and business operations, all on one VPS controlled via Telegram) is generating significant excitement on X and HN. A 10-day review tested 3 specialized personas -- "Morty" (casual sidekick), "Pepper Potts" (chief of staff for consulting work), and "David Goggins" (workout coach) -- and reported genuine daily utility after setup. The key insight: OpenClaw reduces app-switching by centralizing tasks into a single messaging interface. However, setup remains 30-45 minutes minimum on a VPS, and ongoing costs run $10-25/day for active use.

#### 7.1 MVP Website & App Building
**Status**: Production-ready (full-stack website builder skill)

Takes a business brief and produces a complete, deployable website: responsive design, proper SEO structure, contact forms, and deployment-ready code. Can iterate on designs based on feedback.

**Example prompt**:
```
Build an MVP landing page for "Clawgent" - a one-click OpenClaw
deployment platform. Include:
- Hero section: "Deploy your AI assistant in one click"
- 3-step how-it-works section
- Pricing table (Free, Pro, Enterprise)
- FAQ section
- Email signup form connected to a simple backend
Tech: Next.js + Tailwind CSS. Deploy-ready for Vercel.
```

**Configuration**:
- Skills: `website-builder`, `web-search` (for design inspiration)
- Model: Claude 4.5 (strongest at full-stack code generation)
- Sandbox: Enable file system + shell for running dev server

#### 7.2 Morning Briefing & Task Management
**Status**: Production-ready (core workflow module)

Delivers a daily 2-minute brief with weather, calendar events, top headlines, priority tasks, and key metrics. Runs on a schedule without prompting.

**Example prompt**:
```
Every morning at 7:30am, send me a briefing on WhatsApp:
- Today's calendar events
- Weather forecast for NYC
- Top 3 Hacker News stories about AI
- My overdue tasks from ./tasks/todo.md
- Yesterday's Stripe revenue
Keep it under 200 words. Casual tone.
```

#### 7.3 Email Triage & Auto-Response
**Status**: Production-ready (messaging integration + workflow)

Reads emails, categorizes by priority, drafts responses, and can auto-reply to routine messages with approval gates for important ones.

**Example prompt**:
```
Check my email every 30 minutes. For each new email:
- If it's a newsletter or marketing: archive, no action
- If it's a customer inquiry: draft a reply and send to #email-drafts for my review
- If it's from a VIP (listed in ./contacts/vip-list.txt): notify me on WhatsApp immediately
- If it's a meeting request: check my calendar and suggest 3 available times
```

#### 7.4 Competitive Research & Market Analysis
**Status**: Production-ready (ClawHub skill: market research)

Compiles comprehensive market analysis: market size, key players, pricing landscape, customer segments, trends, opportunities, and threats. Outputs structured reports.

**Example prompt**:
```
Research the "AI assistant deployment platform" market. Find:
- Top 10 competitors (direct and indirect)
- Their pricing models and tiers
- Key differentiators
- Target customer profiles
- Recent funding rounds
- User reviews and common complaints
Output a competitive analysis report to ./research/competitive-landscape.md
```

#### 7.5 Automation Script Generation
**Status**: Production-ready (core shell + file system)

Writes and executes custom automation scripts for repetitive tasks: data migration, file organization, API integrations, cron jobs, and more.

**Example prompt**:
```
Write a Python script that:
1. Pulls our Stripe subscription data via API
2. Cross-references with our user database (SQLite at ./data/users.db)
3. Identifies users whose trial expires in the next 3 days
4. Generates a personalized email for each using our template
5. Logs everything to ./logs/trial-expiry.log
Schedule it to run daily at 6am.
```

---

## 8. Data Analytics

### Top Skills & Use Cases

> **Community signal**: Data engineering users report mixed results. The summarization and analysis capabilities work well for structured data (CSV, Excel, database queries), but context retention degrades during extended multi-step workflows. A data engineering reviewer on Medium tested pipeline automation and found that while planning was excellent, execution required "constant human supervision" for complex ETL tasks. The `chart-image` and `table-image` skills are community favorites for quick visualization without Python dependencies. Best practice: use OpenClaw for analysis and reporting on existing clean data, not for building production data pipelines.

#### 8.1 CSV/Excel Analysis & Summarization
**Status**: Production-ready (core file system + shell modules)

Reads CSV and Excel files, performs statistical analysis, identifies trends and anomalies, and generates narrative summaries with recommendations.

**Example prompt**:
```
Analyze the sales data in ./data/sales-2025.csv.
Calculate: monthly revenue trend, top 10 products by revenue,
customer acquisition cost by channel, churn rate by cohort.
Identify any anomalies (months with >20% deviation from trend).
Write a summary report with key findings and 3 actionable recommendations.
```

**Configuration**:
- Skills: `data-analysis`, `csv-export`, `chart-image` (for PNG chart generation)
- Model: Claude 4.5 (strong at statistical reasoning)
- Sandbox: Enable Python execution for pandas/matplotlib

#### 8.2 Data Visualization & Chart Generation
**Status**: Production-ready (ClawHub skills: `table-image`, `chart-image`)

Generates charts and tables as PNG images from data. Supports 9 chart types, dark mode, reference lines, and annotations. Does not require a browser or cloud API - runs on lightweight infrastructure.

**Example prompt**:
```
Using the data in ./data/monthly-metrics.csv, create:
1. Line chart: MRR growth over 12 months
2. Bar chart: New users by acquisition channel
3. Pie chart: Revenue breakdown by plan tier
4. Table: Top 20 customers by lifetime value
Save all visualizations to ./reports/charts/
```

**Note**: OpenClaw generates Python code (matplotlib/plotly) for complex visualizations. The `chart-image` and `table-image` skills handle simpler charts natively without Python.

#### 8.3 Automated Report Generation
**Status**: Production-ready (workflow automation + file system)

Pulls data from multiple sources, computes metrics, and generates formatted reports on a schedule. Can output as Markdown, PDF, or post directly to Slack/email.

**Example prompt**:
```
Every Friday at 5pm, generate the weekly analytics report:
- Pull data from ./data/events.csv and ./data/revenue.csv
- Compute: WAU, DAU, conversion rate, ARPU, churn
- Compare to previous week and previous month
- Highlight metrics that changed >10% week-over-week
- Generate charts for the top 5 metrics
- Post the report to #analytics in Slack and save PDF to ./reports/weekly/
```

#### 8.4 Data Cleaning & Transformation
**Status**: Production-ready (shell commands + Python execution)

Cleans messy datasets: deduplication, format standardization, missing value handling, outlier detection, and schema validation.

**Example prompt**:
```
Clean the customer dataset at ./data/raw-customers.csv:
- Remove duplicate rows (match on email address)
- Standardize phone numbers to E.164 format
- Fill missing country fields using timezone data
- Flag rows with invalid email formats
- Export clean data to ./data/clean-customers.csv
- Export a data quality report to ./data/quality-report.md
```

#### 8.5 Database Query & Exploration
**Status**: Production-ready (shell commands + file system)

Connects to databases (SQLite, PostgreSQL via CLI), runs queries, explores schema, and answers questions about data in natural language.

**Example prompt**:
```
Connect to the SQLite database at ./data/app.db.
Show me the schema for all tables. Then answer:
1. How many active users signed up in the last 30 days?
2. What's the average time from signup to first deployment?
3. Which features are most used by users who convert to paid?
4. Are there any users with unusually high API usage?
Save query results and analysis to ./reports/user-analysis.md
```

---

## Community Picks (Hacker News, X, Reviews)

> **Note on sourcing**: Reddit's robots.txt blocks Anthropic's crawler, so direct Reddit thread extraction was not possible. However, OpenClaw community discussion is richly documented on Hacker News (the developer community's primary forum), X/Twitter, Substack, Medium, and independent review sites. The insights below are drawn from these sources, which collectively represent the same user base that would populate Reddit threads. Where applicable, the source platform is noted.

### The Hype vs. Reality Gap

The single most important finding from community research is that **OpenClaw's actual utility is real but significantly narrower than social media suggests**. This has direct implications for how Clawgent positions its templates.

**What the community actually says**:

- "OpenClaw works exactly as advertised" once configured, but "getting there was harder than anyone on social media is admitting." -- 10-day review, Substack
- "You are not removing human effort -- you are changing it from execution to babysitting." -- $400 testing review, ssntpl.com
- "It amplifies good processes and exposes bad ones." -- Shelly Palmer analysis
- "The amount of things I done from my phone just during my breakfast is absolutely breathtaking." -- X user (post-setup)

**The pattern**: Users who invest 2-10 hours in setup and configuration report genuine daily productivity gains. Users expecting plug-and-play experience report frustration and abandonment. This is the core argument for Clawgent -- eliminating that setup barrier.

### Community-Validated Tier List

Based on aggregated community sentiment from Hacker News threads (46838946, 46820783, 46872465, 46893970), independent reviews, and the OpenClaw showcase, here is a tier list of what actually works versus what is overhyped.

#### Tier 1: Actually Works Well (Strong Community Consensus)

| Skill/Use Case | Why It Works | Community Evidence |
|---------------|-------------|-------------------|
| **Summarize** (URLs, PDFs, YouTube, audio) | Deterministic input, clear output, low risk of error | "I use this multiple times a day" -- openclawready.com; "A 30-minute podcast? Summarized in 20 seconds" |
| **Morning Briefing** (weather, calendar, news, tasks) | Scheduled, read-only, no side effects | GIGAZINE reviewer runs daily; multiple HN users confirm |
| **Email Triage & Drafting** | High-volume, pattern-matching task that LLMs handle well | HN user "usamaejaz" lists as core workflow; GIGAZINE reviewer automates across platforms |
| **Code Generation & PR Review** | Developer-native use case, strong model capabilities | HN user "bobjordan" manages multiple Claude Code instances via OpenClaw; OpenClaw showcase features automated PR workflows |
| **Research & Competitive Analysis** | Web search + synthesis is a core LLM strength | ChatPRD 24-hour test: research delivered "well-structured Markdown document with key insights, bullet points, and links" that was "actionable and accurate" |
| **Obsidian/Markdown Second Brain** | File-based, local, no external dependencies | HN user "ericsaf": uses as "second brain" integrated with Obsidian markdown files, values no vendor lock-in |
| **Google Workspace Integration** (Gmail, Calendar, Drive) | Mature skill, high daily utility | openclawready.com Tier 1 skill; "ask 'what's on my calendar tomorrow' and it just works" |

#### Tier 2: Works But Requires Caution

| Skill/Use Case | Why Caution | Community Evidence |
|---------------|------------|-------------------|
| **Calendar Management** | LLMs have poor spatial-temporal reasoning; timezone bugs | ChatPRD test: "Everything was on the wrong day. It was consistently off by exactly one day" |
| **Marketing Copy Generation** | Hallucination risk -- agent invents details | HN thread: "hallucinations require human review"; Legin82 confirms on 7-day test |
| **Browser Automation** (scraping, form filling) | Brittle; breaks when page structure changes | HN: browser automation described as "brittle"; $400 review: vision-based tasks spike costs ($4.50 for a single GitHub registration) |
| **CRM Updates & Financial Actions** | Irreversible actions; mistakes have real consequences | HN thread: "delegating important tasks to non-deterministic systems" is risky; banks won't protect bot-initiated losses |
| **WordPress / Content Publishing** | Works but needs human review gate before publish | openclawready.com: listed as Tier 2 skill; "API quirks require trial and error" |

#### Tier 3: Overhyped or Immature

| Skill/Use Case | Why Overhyped | Community Evidence |
|---------------|-------------- |-------------------|
| **Full Autonomous Business Ops** (no human oversight) | Context retention degrades; error recovery unreliable | $400 review rated 6.5/10: "requires constant human supervision rather than autonomous operation" |
| **Smart Home Control** | Novelty wears off; voice assistants already do this | HN "bull case" thread: "Why do you need a reminder to buy gloves when you are holding them?" |
| **One-Click Plug-and-Play Setup** | Marketing claim, not reality | Every honest review confirms 2-10 hour setup; Palmer: "$250 in API tokens merely configuring the system" |
| **Fridge Inventory / Meal Planning** | Niche; solves a problem most people don't have | HN skeptics: "notification overload rather than solving real problems" |

### Cost Reality Check

Community data on actual operating costs (critical for Clawgent pricing):

| Usage Level | Reported Cost | Source |
|------------|--------------|--------|
| Setup/configuration phase | $50-250 one-time | Palmer ($250), $400 review, multiple HN users |
| Light daily use (briefings, summaries, reminders) | $3-5/day | HN thread estimates |
| Active "AI assistant" use (email, calendar, research) | $10-25/day | Palmer analysis |
| Heavy use (coding, browser automation, multi-agent) | $400+/month | HN user "bobjordan" ($400/month); $400 review |
| 30-minute test burn | $5 | HN thread |
| Weekend intensive setup | $560 | HN thread |

**Model cost insight**: Claude Sonnet provides the best cost-to-performance ratio for daily tasks. Claude Opus is significantly more expensive and only justified for complex reasoning tasks (code architecture, deep research). Multiple community members recommend hard spending limits.

### Community-Discovered Use Cases NOT in Original Personas

These use cases emerged from community discussion and don't fit neatly into the 8 personas above:

#### Multi-Agent "AI Team" for Solo Operators
**Source**: X user @iamtrebuh, widely discussed on HN

A solo founder running 4 specialized agents on a single VPS, controlled through Telegram:
1. **Strategy Agent**: Planning, big picture, coordinates the others
2. **Dev Agent**: Coding, technical problems, architecture
3. **Marketing Agent**: Research, content ideas, competitor analysis
4. **Business Agent**: Pricing, metrics, growth strategy

Key insight: shared memory for major project docs/goals, but each agent maintains separate conversation context. Different models assigned per role (Opus for strategy, Sonnet for routine tasks). Scheduled daily check-ins run automatically.

**Clawgent implication**: This is a power-user template -- "Founder's AI Team" -- that deploys 4 pre-configured instances with shared file system access.

#### Asynchronous Research Assistant
**Source**: ChatPRD 24-hour test, GIGAZINE review, HN users

The highest-signal use case from community testing: sending a voice note or text message asking for research, then receiving a structured Markdown report hours later. Works particularly well because:
- No real-time interaction pressure
- Agent has time to search, synthesize, and format
- Output is a document (easy to verify), not an action (hard to reverse)
- Runs while user sleeps or works on other things

Example from ChatPRD: "I sent a voice note asking it to research on Reddit for product feedback and email a report -- the system delivered a well-structured Markdown document with key insights, bullet points, and links to relevant threads that was actionable and accurate."

#### Inbox Zero Automation
**Source**: OpenClaw Showcase, GIGAZINE review

Multiple users report processing thousands of emails autonomously. One user cleared 4,000+ emails in two days. The agent unsubscribes from spam, categorizes messages, drafts replies, and flags VIP senders.

GIGAZINE reviewer: checks messaging apps every 15 minutes, summarizes threads, creates calendar events from email content, and sends daily summaries at 8pm.

#### Price Monitoring & Deal Hunting
**Source**: GIGAZINE review

One user manages 30+ price alerts for products and hotels, with the agent checking booking site photos against specific criteria (e.g., "pull-out bed in separate room"). This is a niche but high-value use case for operations teams and procurement.

#### Automated Form Filling
**Source**: GIGAZINE review, ChatPRD test

The agent auto-fills personal information on web forms, requests unknown details via Slack, and can even read 2FA texts to complete processes like restaurant reservations. However, this raises significant security concerns around credential access.

### Community Sentiment by Persona

#### Developers (Most Positive)
Developers are the strongest advocates. The coding workflow (code generation, PR review, CI/CD monitoring) is the most validated use case across all community sources. HN user "bobjordan" runs OpenClaw as a supervisor managing multiple Claude Code instances via shared tmux, spending $400/month but considering it worthwhile.

**Key quote**: "This is the product that Apple and Google were unable to build... because it's a threat to their business model." -- HN user "oceanplexian"

#### Founders/Solopreneurs (Enthusiastic but Cautious)
Solo founders are the second-most enthusiastic group. The multi-agent team pattern (4 agents with different roles) is generating real excitement. However, the setup complexity remains a barrier.

**Key quote**: "It's like having a real small team available 24/7." -- @iamtrebuh on X

#### Marketing Teams (Mixed)
Content generation and SEO workflows are validated, but hallucination risk requires human review gates. The content repurposing workflow (blog post to social media variants) is the strongest marketing use case.

**Caution**: "Anytime I let the LLM rip it makes mistakes." -- HN user "sjdbbdd" on marketing copy generation

#### Non-Technical Users (Mostly Negative)
The community consensus is that OpenClaw is "built by developers, for developers." Non-technical users face:
- Terminal-based setup requiring debugging skills
- "The documentation assumes significant technical knowledge" -- Contabo review
- "The assistant cannot help you configure these integrations because it does not exist until you configure them" -- Palmer (the bootstrap problem)

**Clawgent implication**: This is the core market opportunity. Non-technical users want the capabilities but cannot navigate the setup. Clawgent eliminates this barrier entirely.

### Security Warnings from Community

The community has raised serious, documented security concerns that Clawgent must address:

1. **341 malicious skills** found in ClawHub stealing crypto keys, credentials, and data (documented by Hacker News, Bitdefender, VirusTotal, 1Password, The Register)
2. **Prompt injection via messages**: Malicious emails or chat messages can manipulate the agent into exfiltrating data. "How do you protect yourself from prompt injection?" is the most-asked security question on HN.
3. **Plain text credential storage**: API keys and tokens stored in `~/.clawdbot` directory without encryption. Even deleted keys found in `.bak` files.
4. **Cost overruns**: No spending guardrails by default. Users have burned $560 in a weekend without realizing it.
5. **Gartner recommendation**: Enterprises should block OpenClaw entirely until security matures.

**Clawgent must**: Pre-configure sandboxing, enforce spending limits, vet all bundled skills, and never store credentials in plain text. This is a competitive differentiator.

---

## Summary Table

| Persona | Top 3 Skills | Primary OpenClaw Modules | Recommended Model |
|---------|-------------|-------------------------|-------------------|
| **Marketing Teams** | SEO Content Engine, Content Repurposing, Brand Monitoring | Browser, File System, Workflow | Claude 4.5 |
| **Sales Teams** | Prospect Research, CRM Management, Proposal Generation | Browser, Messaging, File System | Claude 4.5 |
| **Lead Gen Agencies** | Web Scraping, Lead Enrichment, Landing Page Generation | Browser, File System, Shell | Claude 4.5 |
| **Dev Teams** | Code Generation, PR Review, CI/CD Monitoring | Shell, File System, Workflow | Claude 4.5 |
| **Customer Support** | Ticket Triage, KB Generation, Feedback Analysis | Messaging, File System, Workflow | Claude 4.5 |
| **Operations/Admin** | Client Onboarding, Invoice Processing, KPI Dashboards | Workflow, File System, Messaging | Claude Sonnet (cost-efficient) |
| **Founders** | MVP Building, Email Triage, Competitive Research | All modules | Claude 4.5 |
| **Data Analytics** | CSV Analysis, Chart Generation, Automated Reports | Shell, File System, Visualization | Claude 4.5 |

---

## Clawgent Template Recommendations

Based on this research, Clawgent should offer pre-configured instance templates for each persona. Each template bundles:

1. **Pre-installed skills** from ClawHub relevant to the persona
2. **SOUL.md persona file** with appropriate tone, expertise, and boundaries
3. **Starter prompts** showing the top 3 workflows for that persona
4. **Model recommendation** (shown in UI, user provides their own API key)

### Proposed Templates

| Template Name | Pre-installed Skills | SOUL.md Persona | Priority |
|--------------|---------------------|-----------------|----------|
| Marketing Pro | `seo-content-engine`, `brand-monitor`, `social-scheduler` | Content strategist, brand-aware, creative | High |
| Sales Assistant | `salesforce-cli`, `web-search`, `proposal-generator` | Professional, research-oriented, concise | High |
| Lead Gen Machine | `lead-hunter`, `web-scraper`, `landing-page-builder` | Data-driven, systematic, outbound-focused | High |
| Dev Copilot | `coding-agent`, `github-pr`, `ci-monitor` | Technical, thorough, follows team conventions | High |
| Support Agent | `ticket-triage`, `kb-generator`, `sentiment-analyzer` | Empathetic, professional, clear escalation rules | Medium |
| Ops Automator | `calendar-management`, `invoice-processor`, `slack-integration` | Organized, proactive, detail-oriented | Medium |
| Founder's Sidekick | `website-builder`, `market-research`, `email-triage` | Versatile, entrepreneurial, action-oriented | High |
| Data Analyst | `data-analysis`, `chart-image`, `table-image` | Analytical, precise, insight-focused | Medium |

### Important Caveats

1. **Skill verification needed**: Not all skills listed above have been individually verified for quality and security. Before including any community skill in a Clawgent template, it must be reviewed for malicious code (ClawHub has had documented malicious skill incidents flagged by Bitdefender and VirusTotal).

2. **API key requirements**: Most valuable skills require external API keys (LLM provider, email service, CRM). Clawgent templates should clearly document which API keys are needed for each template.

3. **Security isolation**: Customer support and any template processing untrusted user input should have strict tool permission boundaries to prevent prompt injection attacks.

4. **Local model option**: For privacy-sensitive use cases (document analysis, customer data), templates should note that Ollama-based local models can be used instead of cloud APIs, though with reduced capability.

---

## Sources

### Official Documentation
- [OpenClaw Official Site](https://openclaw.ai/)
- [OpenClaw Documentation - Skills](https://docs.openclaw.ai/tools/skills)
- [ClawHub Skills Registry](https://clawhub.ai/skills)
- [OpenClaw Multi-Agent Routing Docs](https://docs.openclaw.ai/concepts/multi-agent)
- [OpenClaw Wikipedia](https://en.wikipedia.org/wiki/OpenClaw)
- [OpenClaw Showcase](https://openclaw.ai/showcase)

### Skill Directories & Guides
- [Awesome OpenClaw Skills (VoltAgent)](https://github.com/VoltAgent/awesome-openclaw-skills)
- [15 Best OpenClaw Skills (openclawready.com)](https://openclawready.com/blog/best-clawdbot-skills/)
- [10 OpenClaw Skills That Make Money](https://openclawmoney.com/articles/openclaw-skills-that-make-money)
- [OpenClaw Capabilities Matrix (BetterLink Blog)](https://eastondev.com/blog/en/posts/ai/20260204-openclaw-capabilities-matrix/)
- [souls.directory - SOUL.md Templates](https://souls.directory/)

### Use Case References
- [OpenClaw Use Cases (Hostinger)](https://www.hostinger.com/tutorials/openclaw-use-cases)
- [OpenClaw for Marketers (GetOpenClaw)](https://www.getopenclaw.ai/for/marketers)
- [OpenClaw Industry Solutions (OpenClaw Experts)](https://www.openclawexperts.io/solutions)
- [OpenClaw for Startups (Mean CEO)](https://blog.mean.ceo/openclaw-for-startups/)
- [OpenClaw SEO for Startups (Mean CEO)](https://blog.mean.ceo/openclaw-seo/)
- [DigitalOcean - What is OpenClaw](https://www.digitalocean.com/resources/articles/what-is-openclaw)
- [OpenClaw Data Visualization (Danny Shmueli)](https://dannyshmueli.com/2026/02/04/chart-image-ai-agent-visualization/)
- [Cline AI (coding agent, predecessor)](https://cline.bot/)

### Community Discussions & Reviews (v2 additions)
- [Ask HN: Any real OpenClaw users? What's your experience?](https://news.ycombinator.com/item?id=46838946)
- [HN: OpenClaw -- Moltbot Renamed Again](https://news.ycombinator.com/item?id=46820783)
- [HN: A sane but bull case on OpenClaw](https://news.ycombinator.com/item?id=46872465)
- [HN: OpenClaw is what Apple Intelligence should have been](https://news.ycombinator.com/item?id=46893970)
- [I Spent $400 Testing OpenClaw -- An Honest Review (ssntpl.com)](https://ssntpl.com/i-spent-400-testing-openclaw-ai-an-honest-review/)
- [Is OpenClaw Worth the Hype? 10 Days Finding Out (Substack)](https://aimaker.substack.com/p/openclaw-review-setup-guide)
- [The Gap Between Hype and Reality (Shelly Palmer)](https://shellypalmer.com/2026/02/clawdbot-the-gap-between-ai-assistant-hype-and-reality/)
- [24 Hours with Clawdbot: 3 Workflows (ChatPRD)](https://www.chatprd.ai/how-i-ai/24-hours-with-clawdbot-moltbot-3-workflows-for-ai-agent)
- [GIGAZINE: My Experience Using OpenClaw](https://gigazine.net/gsc_news/en/20260205-clawdbot-openclaw-ai-personal-assistant/)
- [Solo Founder 4-Agent Setup (@iamtrebuh on X)](https://x.com/iamtrebuh/status/2011260468975771862)
- [CNBC: From Clawdbot to OpenClaw](https://www.cnbc.com/2026/02/02/openclaw-open-source-ai-agent-rise-controversy-clawdbot-moltbot-moltbook.html)

### Security Research
- [OpenClaw Malicious Skills Warning (Bitdefender)](https://www.bitdefender.com/en-us/blog/labs/helpful-skills-or-hidden-payloads-bitdefender-labs-dives-deep-into-the-openclaw-malicious-skill-trap)
- [VirusTotal - OpenClaw Skill Weaponization](https://blog.virustotal.com/2026/02/from-automation-to-infection-how.html)
- [1Password - From Magic to Malware: OpenClaw Attack Surface](https://1password.com/blog/from-magic-to-malware-how-openclaws-agent-skills-become-an-attack-surface)
- [HN: Malicious Skills Found in ClawHub](https://news.ycombinator.com/item?id=46908022)
- [The Register: OpenClaw Security Issues](https://www.theregister.com/2026/02/02/openclaw_security_issues/)
- [XDA: Please Stop Using OpenClaw](https://www.xda-developers.com/please-stop-using-openclaw/)
