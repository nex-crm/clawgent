import {
  dbGetWaSession,
  dbUpsertWaSession,
  dbDeleteWaSession,
  dbInsertWaMessage,
  dbGetLinkedByPhone,
  dbDeleteLinkedByPhone,
  dbUpdateInstanceUserId,
  type WhatsAppSession,
} from "./db";
import {
  instances,
  type Instance,
  runCommand,
  runCommandSilent,
  findInstanceByAnyLinkedUserId,
  reconcileWithDocker,
  startPairingAutoApprover,
  destroyInstance,
} from "./instances";
import { PERSONA_CONFIGS } from "./personas";
import { configureAgentPersona } from "./agent-config";
import { sendChatMessage } from "./openclaw-client";
import { getPostHogClient } from "./posthog-server";
import { randomBytes } from "crypto";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// --- Config ---

const PLIVO_AUTH_ID = process.env.PLIVO_AUTH_ID ?? "";
const PLIVO_AUTH_TOKEN = process.env.PLIVO_AUTH_TOKEN ?? "";
const PLIVO_WHATSAPP_NUMBER = process.env.PLIVO_WHATSAPP_NUMBER ?? "15558452872"; // old number until new one is approved
const PLIVO_API_URL = "https://api.plivo.com/v1";

const OPENCLAW_IMAGE = "clawgent-openclaw";
const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const PORT_RANGE_START = 19000;
const CONTAINER_PREFIX = "clawgent-";
const AGENTS_BASE = "/home/node/.openclaw/agents";
const MAX_MESSAGE_LENGTH = 4000;
const BASE_URL =
  process.env.NODE_ENV === "production"
    ? "https://clawgent.ai"
    : `http://localhost:${process.env.PORT ?? 3001}`;

const PROVIDER_CONFIG: Record<string, { envVar: string; modelId: string; label: string }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY", modelId: "anthropic/claude-sonnet-4-5", label: "Claude (Anthropic)" },
  google:    { envVar: "GEMINI_API_KEY",    modelId: "google/gemini-3-flash-preview", label: "Gemini (Google)" },
  openai:    { envVar: "OPENAI_API_KEY",    modelId: "openai/gpt-5.2", label: "GPT (OpenAI)" },
};

const PERSONA_KEYS = Object.keys(PERSONA_CONFIGS);
const PROVIDER_KEYS = ["anthropic", "google", "openai"];

// --- Sensitive data redaction ---

function redactSensitive(text: string): string {
  return text
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]")
    .replace(/\bAIza[A-Za-z0-9_-]{30,}/g, "[REDACTED_KEY]")
    .replace(/\bkey-[A-Za-z0-9_-]{20,}/g, "[REDACTED_KEY]");
}

function maskPhone(phone: string): string {
  if (phone.length <= 4) return "***";
  return "***" + phone.slice(-4);
}

// --- Formatted menus ---

function buildPersonaMenu(): string {
  return PERSONA_KEYS.map((key, i) => {
    const p = PERSONA_CONFIGS[key];
    return `${i + 1}. ${p.emoji} *${p.name}*`;
  }).join("\n");
}

function buildProviderMenu(): string {
  return [
    `1. 🟣 *Claude Sonnet 4.5* (Anthropic)`,
    `2. 🔵 *Gemini 3 Flash* (Google)`,
    `3. 🟢 *GPT-5.2* (OpenAI)`,
  ].join("\n");
}

const WELCOME_MESSAGE =
  `yo, welcome to *clawgent* 🎮\n\n` +
  `i deploy AI agents that actually do stuff.\n` +
  `marketing, sales, dev, ops -- pick your agent.\n\n` +
  `let's get you set up. takes about 60 seconds.\n\n` +
  `_pick your agent:_\n\n` +
  buildPersonaMenu() +
  `\n\n_reply with a number (1-${PERSONA_KEYS.length})_`;

const HELP_MESSAGE =
  `🤖 *clawgent commands*\n\n` +
  `*/help* — this message\n` +
  `*/status* — check your instance\n` +
  `*/agents* — list agents on your instance\n` +
  `*/add* — add a new agent\n` +
  `*/switch* _name_ — switch active agent\n` +
  `*/unlink* — disconnect from web account\n` +
  `*/reset* — nuke everything, start fresh\n\n` +
  `_anything without a / goes straight to your active agent._`;

const PROVIDER_KEY_URLS: Record<string, string> = {
  anthropic: "console.anthropic.com/settings/keys",
  google: "aistudio.google.com/apikey",
  openai: "platform.openai.com/api-keys",
};

const API_KEY_PREFIXES: Record<string, { prefix: string; hint: string }> = {
  anthropic: { prefix: "sk-ant-", hint: "start with ```sk-ant-```" },
  google: { prefix: "AIza", hint: "start with ```AIza```" },
  openai: { prefix: "sk-", hint: "start with ```sk-```" },
};

// --- Interactive message types ---

const PERSONA_DESCRIPTIONS: Record<string, string> = {
  "marketing-pro": "Content, campaigns, analytics",
  "sales-assistant": "Outreach, follow-ups, CRM",
  "lead-gen": "Prospecting, qualification",
  "gtm-engineer": "Launch strategy, go-to-market",
  "dev-copilot": "Code, debug, review",
  "support-agent": "Tickets, docs, customer help",
  "ops-automator": "CI/CD, infra, monitoring",
  "data-analyst": "SQL, dashboards, insights",
  "founder-sidekick": "Strategy, decisions, planning",
};

const BUSINESS_PERSONAS = ["marketing-pro", "sales-assistant", "lead-gen", "gtm-engineer"];
const TECHNICAL_PERSONAS = ["dev-copilot", "support-agent", "ops-automator", "data-analyst", "founder-sidekick"];

interface PlivoInteractiveList {
  type: "list";
  header?: { type: "text"; text: string };
  body: { text: string };
  footer?: { text: string };
  action: {
    buttons: [{ title: string }];
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
}

interface PlivoInteractiveButton {
  type: "button";
  header?: { type: "text"; text: string };
  body: { text: string };
  footer?: { text: string };
  action: {
    buttons: Array<{ title: string; id: string }>;
  };
}

type PlivoInteractive = PlivoInteractiveList | PlivoInteractiveButton;

function buildPersonaListInteractive(): PlivoInteractiveList {
  return {
    type: "list",
    header: { type: "text", text: "welcome to clawgent by nex.ai" },
    body: {
      text: "yo, i deploy AI agents that actually do stuff.\nmarketing, sales, dev, ops -- pick your agent.\n\nlet's get you set up. takes about 60 seconds.",
    },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [{ title: "Choose Agent" }],
      sections: [
        {
          title: "Blank Instance",
          rows: [
            {
              id: "scratch",
              title: "🧪 Start from Scratch",
              description: "Empty OpenClaw instance, no pre-loaded agent",
            },
          ],
        },
        {
          title: "Business Agents",
          rows: BUSINESS_PERSONAS.map((key) => ({
            id: key,
            title: `${PERSONA_CONFIGS[key].emoji} ${PERSONA_CONFIGS[key].name}`,
            description: PERSONA_DESCRIPTIONS[key],
          })),
        },
        {
          title: "Technical Agents",
          rows: TECHNICAL_PERSONAS.map((key) => ({
            id: key,
            title: `${PERSONA_CONFIGS[key].emoji} ${PERSONA_CONFIGS[key].name}`,
            description: PERSONA_DESCRIPTIONS[key],
          })),
        },
      ],
    },
  };
}

function buildProviderButtonInteractive(personaEmoji: string, personaName: string): PlivoInteractiveButton {
  return {
    type: "button",
    body: {
      text: `${personaEmoji} ${personaName} -- nice pick.\n\nnow, which AI model should power it?`,
    },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [
        { title: "Claude Sonnet 4.5", id: "anthropic" },
        { title: "Gemini 3 Flash", id: "google" },
        { title: "GPT-5.2", id: "openai" },
      ],
    },
  };
}

function buildPersonaListForAdd(): PlivoInteractiveList {
  return {
    type: "list",
    header: { type: "text", text: "add an agent" },
    body: { text: "pick a persona for your new agent.\n\n/cancel to go back." },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [{ title: "Choose Agent" }],
      sections: [
        {
          title: "Business Agents",
          rows: BUSINESS_PERSONAS.map((key) => ({
            id: key,
            title: `${PERSONA_CONFIGS[key].emoji} ${PERSONA_CONFIGS[key].name}`,
            description: PERSONA_DESCRIPTIONS[key],
          })),
        },
        {
          title: "Technical Agents",
          rows: TECHNICAL_PERSONAS.map((key) => ({
            id: key,
            title: `${PERSONA_CONFIGS[key].emoji} ${PERSONA_CONFIGS[key].name}`,
            description: PERSONA_DESCRIPTIONS[key],
          })),
        },
      ],
    },
  };
}

function buildAgentListInteractive(
  agents: WaAgentInfo[],
  activeId: string,
  headerText = "your agents",
  bodyText?: string,
): PlivoInteractiveList {
  const body = bodyText ?? (agents.length === 1
    ? "you have 1 agent. tap to add more."
    : `you have ${agents.length} agents.\ntap to switch or add more.`);
  return {
    type: "list",
    header: { type: "text", text: headerText },
    body: { text: body },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [{ title: "View Agents" }],
      sections: [
        {
          title: "Your Agents",
          rows: agents.map((a) => ({
            id: `/switch ${a.id}`,
            title: `${a.emoji} ${a.name}`.slice(0, 24),
            description: a.id === activeId ? "Currently active" : "Tap to switch",
          })),
        },
        {
          title: "Actions",
          rows: [
            { id: "/add", title: "➕ Add New Agent", description: "Deploy another persona" },
          ],
        },
      ],
    },
  };
}

function buildHelpInteractive(): PlivoInteractiveButton {
  return {
    type: "button",
    body: {
      text: "🤖 *clawgent commands*\n\n" +
        "*/status* — check your instance\n" +
        "*/agents* — list & switch agents\n" +
        "*/add* — add a new agent\n" +
        "*/switch* _name_ — switch active agent\n" +
        "*/unlink* — disconnect from web account\n" +
        "*/reset* — nuke everything, start fresh\n\n" +
        "_anything without a / goes straight to your active agent._",
    },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [
        { title: "My Agents", id: "/agents" },
        { title: "Add Agent", id: "/add" },
        { title: "Check Status", id: "/status" },
      ],
    },
  };
}

function buildStatusInteractive(statusText: string): PlivoInteractiveButton {
  return {
    type: "button",
    body: { text: statusText },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [
        { title: "My Agents", id: "/agents" },
        { title: "Add Agent", id: "/add" },
      ],
    },
  };
}

function buildDeploySuccessInteractive(
  personaEmoji: string,
  personaName: string,
  instanceId: string,
): PlivoInteractiveButton {
  return {
    type: "button",
    body: {
      text: `🎮 *your ${personaEmoji} ${personaName} is live!*\n\n` +
        `type anything to start chatting with your agent.\n\n` +
        `🌐 web dashboard: ${BASE_URL}/i/${instanceId}/`,
    },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [
        { title: "My Agents", id: "/agents" },
        { title: "Help", id: "/help" },
        { title: "Check Status", id: "/status" },
      ],
    },
  };
}

function buildAddSuccessInteractive(
  personaEmoji: string,
  personaName: string,
  agentId: string,
  currentDisplay: string,
): PlivoInteractiveButton {
  return {
    type: "button",
    body: {
      text: `✅ ${personaEmoji} *${personaName}* added!\n\n` +
        `you're still chatting with ${currentDisplay}.`,
    },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [
        { title: "Switch", id: `/switch ${agentId}` },
        { title: "My Agents", id: "/agents" },
      ],
    },
  };
}

function buildAlreadyHaveAgentInteractive(
  personaEmoji: string,
  personaName: string,
  agentId: string,
): PlivoInteractiveButton {
  return {
    type: "button",
    body: {
      text: `you already have ${personaEmoji} *${personaName}* on this instance.`,
    },
    footer: { text: "clawgent.ai" },
    action: {
      buttons: [
        { title: "Switch", id: `/switch ${agentId}` },
        { title: "My Agents", id: "/agents" },
      ],
    },
  };
}

/** Get agent display name from known personas or fall back to agent ID. */
function getAgentDisplay(instance: Instance, agentId: string | null | undefined): string {
  const id = agentId || "main";
  if (id === "main" && instance.persona && PERSONA_CONFIGS[instance.persona]) {
    const p = PERSONA_CONFIGS[instance.persona];
    return `${p.emoji} ${p.name}`;
  }
  if (PERSONA_CONFIGS[id]) {
    const p = PERSONA_CONFIGS[id];
    return `${p.emoji} ${p.name}`;
  }
  return id;
}

// --- Plivo messaging ---

export async function sendPlivoMessage(to: string, text: string): Promise<void> {
  // Always log outbound messages (redacted) even if Plivo isn't configured
  dbInsertWaMessage({ phone: to, direction: "outbound", content: redactSensitive(text), createdAt: new Date().toISOString() });

  if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
    console.error("[whatsapp] Plivo credentials not configured — message not sent");
    return;
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH) + "\n\n[Message truncated]";
  }

  const url = `${PLIVO_API_URL}/Account/${PLIVO_AUTH_ID}/Message/`;
  const auth = Buffer.from(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`).toString("base64");

  const payload = {
    src: PLIVO_WHATSAPP_NUMBER,
    dst: to,
    type: "whatsapp",
    text,
  };
  console.log(`[whatsapp] Plivo request: POST ${url} src=${payload.src} dst=${payload.dst}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[whatsapp] Plivo send failed: ${res.status} ${await res.text()}`);
    } else {
      console.log(`[whatsapp] Plivo send success: ${res.status}`);
    }
  } catch (err) {
    console.error("[whatsapp] Plivo send error:", err);
  }
}

export async function sendPlivoInteractive(to: string, interactive: PlivoInteractive, fallbackText?: string): Promise<void> {
  const logContent = `[interactive:${interactive.type}] ${interactive.body.text.slice(0, 100)}`;
  dbInsertWaMessage({ phone: to, direction: "outbound", content: logContent, createdAt: new Date().toISOString() });

  if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
    console.error("[whatsapp] Plivo credentials not configured — interactive message not sent");
    return;
  }

  const url = `${PLIVO_API_URL}/Account/${PLIVO_AUTH_ID}/Message/`;
  const auth = Buffer.from(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`).toString("base64");

  const payload = {
    src: PLIVO_WHATSAPP_NUMBER,
    dst: to,
    type: "whatsapp",
    interactive,
  };
  console.log(`[whatsapp] Plivo interactive: POST ${url} src=${payload.src} dst=${payload.dst} type=${interactive.type}`);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[whatsapp] Plivo interactive failed: ${res.status} ${errBody}`);
      if (fallbackText) await sendPlivoMessage(to, fallbackText);
    } else {
      console.log(`[whatsapp] Plivo interactive success: ${res.status}`);
    }
  } catch (err) {
    console.error("[whatsapp] Plivo interactive error:", err);
    if (fallbackText) await sendPlivoMessage(to, fallbackText);
  }
}

async function sendWelcomeInteractive(phone: string): Promise<void> {
  await sendPlivoInteractive(phone, buildPersonaListInteractive(), WELCOME_MESSAGE);
}

async function sendProviderInteractive(phone: string, personaKey: string): Promise<void> {
  const persona = PERSONA_CONFIGS[personaKey];
  const emoji = persona?.emoji ?? "🧪";
  const name = persona?.name ?? "Blank Instance";
  const fallback =
    `${emoji} *${name}* -- nice pick.\n\n` +
    `now, which AI model should power it?\n\n` +
    buildProviderMenu() +
    `\n\n_reply 1, 2, or 3_`;
  await sendPlivoInteractive(phone, buildProviderButtonInteractive(emoji, name), fallback);
}

// --- Main message handler ---

export async function handleIncomingMessage(phone: string, text: string): Promise<string | null> {
  // Log inbound message (redact API keys and sensitive content)
  dbInsertWaMessage({ phone, direction: "inbound", content: redactSensitive(text), createdAt: new Date().toISOString() });

  // Global commands (available in any state, even without a session)
  const cmd = text.trim().toLowerCase();
  if (cmd === "/help") {
    const posthog = getPostHogClient();
    posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_command_used", properties: { source: "whatsapp", command: "/help" } });
    await sendPlivoInteractive(phone, buildHelpInteractive(), HELP_MESSAGE);
    return null;
  }
  if (cmd === "/reset") return await handleReset(phone);
  if (cmd === "/status") {
    const posthog = getPostHogClient();
    posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_command_used", properties: { source: "whatsapp", command: "/status" } });
    await handleStatus(phone);
    return null;
  }

  // Get or create session — users without a session always start onboarding
  let session = dbGetWaSession(phone);
  if (!session) {
    session = {
      phone,
      userId: `wa-${phone}`,
      currentState: "PERSONA_SELECT",
      selectedPersona: null,
      selectedProvider: null,
      instanceId: null,
      activeAgent: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    dbUpsertWaSession(session);

    // PostHog: identify new WhatsApp user and track session start
    const posthog = getPostHogClient();
    posthog?.identify({ distinctId: `wa-${phone}`, properties: { source: "whatsapp", phone, channel: "whatsapp" } });
    posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_session_started", properties: { source: "whatsapp" } });

    await sendWelcomeInteractive(phone);
    return null;
  }

  // Route by current state
  switch (session.currentState) {
    case "PERSONA_SELECT":
      return await handlePersonaSelect(session, text);
    case "PROVIDER_SELECT":
      return await handleProviderSelect(session, text);
    case "API_KEY":
      return await handleApiKey(session, text);
    case "DEPLOYING":
      return handleDeploying(session);
    case "ACTIVE":
      return await handleActive(session, text);
    case "ADDING_AGENT":
      return await handleAddingAgentSelect(session, text);
    default:
      // Unknown state — restart
      session.currentState = "PERSONA_SELECT";
      session.activeAgent = null;
      session.updatedAt = new Date().toISOString();
      dbUpsertWaSession(session);
      await sendWelcomeInteractive(phone);
      return null;
  }
}

// --- State handlers ---

async function handlePersonaSelect(session: WhatsAppSession, text: string): Promise<string | null> {
  const trimmed = text.trim().toLowerCase();
  let personaKey: string | undefined;

  // "Start from Scratch" — no persona, deploy blank instance
  if (trimmed === "scratch") {
    const posthog = getPostHogClient();
    posthog?.capture({ distinctId: session.userId, event: "wa_persona_selected", properties: { source: "whatsapp", persona_id: null, persona_name: "scratch" } });
    session.selectedPersona = null;
    session.currentState = "PROVIDER_SELECT";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    await sendProviderInteractive(session.phone, "scratch");
    return null;
  }

  // Handle stale commands from old interactive lists (e.g. "/switch main" tapped after reset)
  if (trimmed.startsWith("/")) {
    await sendPlivoMessage(session.phone, "you're not set up yet — pick an agent first 👇");
    await sendWelcomeInteractive(session.phone);
    return null;
  }

  // Try ID match first (from interactive list reply)
  if (PERSONA_KEYS.includes(trimmed)) {
    personaKey = trimmed;
  } else {
    // Try number match
    const num = parseInt(text.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= PERSONA_KEYS.length) {
      personaKey = PERSONA_KEYS[num - 1];
    }
  }

  // Fuzzy match: try persona display name (e.g. "Marketing Pro" → "marketing-pro")
  if (!personaKey) {
    personaKey = PERSONA_KEYS.find((key) => {
      const p = PERSONA_CONFIGS[key];
      const name = p.name.toLowerCase();
      return name === trimmed || name.includes(trimmed) || trimmed.includes(name);
    });
  }

  if (!personaKey) {
    await sendPlivoMessage(session.phone, `hmm, didn't catch that.\n\n_tap "Choose Agent" above, or type a number (1-${PERSONA_KEYS.length})._`);
    await sendWelcomeInteractive(session.phone);
    return null;
  }

  const posthog = getPostHogClient();
  posthog?.capture({ distinctId: session.userId, event: "wa_persona_selected", properties: { source: "whatsapp", persona_id: personaKey, persona_name: PERSONA_CONFIGS[personaKey].name } });

  session.selectedPersona = personaKey;
  session.currentState = "PROVIDER_SELECT";
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  // Send interactive provider buttons
  await sendProviderInteractive(session.phone, personaKey);
  return null;
}

async function handleProviderSelect(session: WhatsAppSession, text: string): Promise<string | null> {
  const trimmed = text.trim().toLowerCase();
  let providerKey: string | undefined;

  // Try ID match first (from interactive button reply)
  if (PROVIDER_KEYS.includes(trimmed)) {
    providerKey = trimmed;
  } else {
    // Try number match (backward compat)
    const num = parseInt(text.trim(), 10);
    if (!isNaN(num) && num >= 1 && num <= PROVIDER_KEYS.length) {
      providerKey = PROVIDER_KEYS[num - 1];
    }
  }

  if (!providerKey) {
    await sendPlivoMessage(session.phone, "pick one of the three models below 👇");
    await sendProviderInteractive(session.phone, session.selectedPersona!);
    return null;
  }

  const provider = PROVIDER_CONFIG[providerKey];
  const keyUrl = PROVIDER_KEY_URLS[providerKey] ?? "";

  const posthog = getPostHogClient();
  posthog?.capture({ distinctId: session.userId, event: "wa_provider_selected", properties: { source: "whatsapp", provider: providerKey } });

  session.selectedProvider = providerKey;
  session.currentState = "API_KEY";
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  return (
    `*${provider.label}* -- solid choice.\n\n` +
    `now i need your API key.\n\n` +
    (keyUrl ? `grab it here: ${keyUrl}\n\n` : "") +
    `paste it below when ready 👇\n\n` +
    `🔒 _your key is only used to power your agent instance. we don't store it in plaintext or share it._`
  );
}

async function handleApiKey(session: WhatsAppSession, text: string): Promise<string> {
  const apiKey = text.trim();

  // Basic length check
  if (apiKey.length < 10) {
    const hint = API_KEY_PREFIXES[session.selectedProvider!];
    return `hmm, that doesn't look like a valid API key 🤔\n\n` +
      (hint ? `${PROVIDER_CONFIG[session.selectedProvider!].label} keys ${hint.hint}\n\n` : "") +
      `try again? paste your key below.`;
  }

  // Format validation for known providers
  const keyCheck = API_KEY_PREFIXES[session.selectedProvider!];
  if (keyCheck && !apiKey.startsWith(keyCheck.prefix)) {
    return `hmm, that doesn't look like a valid API key 🤔\n\n` +
      `${PROVIDER_CONFIG[session.selectedProvider!].label} keys ${keyCheck.hint}\n\ntry again?`;
  }

  const provider = session.selectedProvider!;
  const persona = session.selectedPersona!;
  const config = PROVIDER_CONFIG[provider];
  const personaConfig = PERSONA_CONFIGS[persona];

  // Pre-check: is Docker available?
  if (!await isDockerAvailable()) {
    console.error("[whatsapp] Deploy blocked: Docker daemon not available");
    return "❌ the deployment server isn't ready right now (Docker is offline).\n\ntry again in a few minutes, or /reset to start over.";
  }

  // Check for existing active instance (including linked accounts)
  await reconcileWithDocker();
  const existing = findInstanceByAnyLinkedUserId(session.userId);
  if (existing) {
    session.instanceId = existing.id;
    session.currentState = "ACTIVE";
    session.activeAgent = "main";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    return `You already have a running agent! Just type to chat with your ${personaConfig.emoji} ${personaConfig.name}.`;
  }

  // Global instance cap
  const MAX_INSTANCES = 20;
  const runningCount = [...instances.values()].filter(
    (i) => i.status === "running" || i.status === "starting",
  ).length;
  if (runningCount >= MAX_INSTANCES) {
    return "Platform is at capacity right now. Try again in a few minutes.";
  }

  // Track API key submitted (DO NOT log the key itself)
  const posthog = getPostHogClient();
  posthog?.capture({ distinctId: session.userId, event: "wa_api_key_submitted", properties: { source: "whatsapp", provider } });

  // Transition to DEPLOYING
  session.currentState = "DEPLOYING";
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  // Fire deployment in background
  deployWhatsAppInstance(session, apiKey, config, personaConfig).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp] Deploy background error:", redactSensitive(msg));
  });

  return (
    `✅ key looks good. let's go.\n\n` +
    `⏳ deploying your ${personaConfig.emoji} *${personaConfig.name}* agent...\n\n` +
    `this takes about 60 seconds. i'll message you when it's ready.\n\n` +
    `_your competitors are still reading docs_ 😏`
  );
}

function handleDeploying(session: WhatsAppSession): string {
  if (session.instanceId) {
    const inst = instances.get(session.instanceId);
    if (inst?.status === "running") {
      session.currentState = "ACTIVE";
      session.activeAgent = "main";
      session.updatedAt = new Date().toISOString();
      dbUpsertWaSession(session);
      return "✅ your agent is live! type anything to start chatting.";
    }
    if (inst?.status === "error") {
      session.currentState = "API_KEY";
      session.instanceId = null;
      session.updatedAt = new Date().toISOString();
      dbUpsertWaSession(session);
      return "❌ deploy failed. send your API key to try again, or /reset to start over.";
    }
  }
  return "⏳ still spinning up your agent... hang tight, almost there.";
}

async function handleActive(session: WhatsAppSession, text: string): Promise<string | null> {
  const inst = session.instanceId ? instances.get(session.instanceId) : undefined;
  if (!inst || inst.status !== "running") {
    // Instance gone — restart flow
    session.currentState = "PERSONA_SELECT";
    session.instanceId = null;
    session.activeAgent = null;
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    await sendPlivoMessage(session.phone, "your agent went offline 😬\n\nlet's spin up a new one:");
    await sendWelcomeInteractive(session.phone);
    return null;
  }

  // Agent management commands
  const cmd = text.trim().toLowerCase();
  const posthog = getPostHogClient();
  if (cmd === "/agents") {
    posthog?.capture({ distinctId: session.userId, event: "wa_command_used", properties: { source: "whatsapp", command: "/agents" } });
    return await handleAgentsCommand(session, inst);
  }
  if (cmd === "/add") {
    posthog?.capture({ distinctId: session.userId, event: "wa_command_used", properties: { source: "whatsapp", command: "/add" } });
    return await handleAddCommand(session);
  }
  if (cmd.startsWith("/switch")) {
    posthog?.capture({ distinctId: session.userId, event: "wa_command_used", properties: { source: "whatsapp", command: "/switch" } });
    return await handleSwitchCommand(session, inst, text.trim());
  }
  if (cmd === "/unlink") {
    posthog?.capture({ distinctId: session.userId, event: "wa_command_used", properties: { source: "whatsapp", command: "/unlink" } });
    return await handleUnlinkCommand(session);
  }

  // Track message sent to agent
  posthog?.capture({ distinctId: session.userId, event: "wa_message_sent", properties: { source: "whatsapp", agent_id: session.activeAgent ?? "main" } });
  return await proxyToOpenClaw(inst, text, session.activeAgent);
}

// --- Agent management commands ---

interface WaAgentInfo {
  id: string;
  name: string;
  emoji: string;
}

async function listInstanceAgents(instance: Instance): Promise<WaAgentInfo[]> {
  try {
    const output = await runCommandSilent("docker", [
      "exec", instance.containerName,
      "node", "/app/openclaw.mjs", "agents", "list", "--json",
    ]);
    const raw = JSON.parse(output) as Array<{
      id: string;
      name?: string;
      identityName?: string;
      identityEmoji?: string;
    }>;
    const agents: WaAgentInfo[] = raw.map((a) => ({
      id: a.id,
      name: a.identityName || a.name || a.id,
      emoji: a.identityEmoji || "",
    }));

    if (!agents.some((a) => a.id === "main")) {
      const mainPersona = instance.persona ? PERSONA_CONFIGS[instance.persona] : null;
      agents.unshift({
        id: "main",
        name: mainPersona?.name || "main",
        emoji: mainPersona?.emoji || "",
      });
    }

    return agents;
  } catch {
    const mainPersona = instance.persona ? PERSONA_CONFIGS[instance.persona] : null;
    return [{
      id: "main",
      name: mainPersona?.name || "main",
      emoji: mainPersona?.emoji || "",
    }];
  }
}

async function handleAgentsCommand(session: WhatsAppSession, instance: Instance): Promise<string | null> {
  const agents = await listInstanceAgents(instance);
  const activeId = session.activeAgent || "main";

  const lines = agents.map((a, i) => {
    const active = a.id === activeId ? " ← _active_" : "";
    return `${i + 1}. ${a.emoji} *${a.name}*${active}`;
  });
  const fallback = `🤖 *your agents:*\n\n${lines.join("\n")}\n\nswitch with: */switch* _name_\nadd more with: */add*`;

  await sendPlivoInteractive(session.phone, buildAgentListInteractive(agents, activeId), fallback);
  return null;
}

async function handleAddCommand(session: WhatsAppSession): Promise<string | null> {
  session.currentState = "ADDING_AGENT";
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  const fallback =
    `pick an agent to add:\n\n` +
    buildPersonaMenu() +
    `\n\n_reply with a number (1-${PERSONA_KEYS.length}) or /cancel_`;

  await sendPlivoInteractive(session.phone, buildPersonaListForAdd(), fallback);
  return null;
}

async function handleAddingAgentSelect(session: WhatsAppSession, text: string): Promise<string | null> {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "/cancel") {
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    return "cancelled. back to your agent.";
  }

  // Try persona selection (ID match from interactive list, or number)
  let personaKey: string | undefined;
  if (PERSONA_KEYS.includes(trimmed)) {
    personaKey = trimmed;
  } else {
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= PERSONA_KEYS.length) {
      personaKey = PERSONA_KEYS[num - 1];
    }
  }

  if (!personaKey) {
    await sendPlivoMessage(session.phone, "pick an agent from the list, or /cancel to go back.");
    await sendPlivoInteractive(session.phone, buildPersonaListForAdd());
    return null;
  }

  const inst = session.instanceId ? instances.get(session.instanceId) : undefined;
  if (!inst || inst.status !== "running") {
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    return "your instance went offline. can't add agents right now. try /reset.";
  }

  // Check if persona already exists as an agent
  const agents = await listInstanceAgents(inst);
  const personaConfig = PERSONA_CONFIGS[personaKey];
  const existing = agents.find(
    (a) => a.id === personaKey || a.name.toLowerCase() === personaConfig.name.toLowerCase(),
  );

  if (existing) {
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    const fallback = `you already have ${personaConfig.emoji} *${personaConfig.name}* on this instance.\n\nswitch to it? reply */switch ${personaConfig.name}*`;
    await sendPlivoInteractive(
      session.phone,
      buildAlreadyHaveAgentInteractive(personaConfig.emoji, personaConfig.name, existing.id),
      fallback,
    );
    return null;
  }

  await sendPlivoMessage(
    session.phone,
    `⏳ adding ${personaConfig.emoji} *${personaConfig.name}* to your instance...`,
  );

  try {
    const agentName = personaKey;
    const wsPath = `${AGENTS_BASE}/${agentName}/workspace`;

    await runCommand("docker", [
      "exec", inst.containerName,
      "node", "/app/openclaw.mjs", "agents", "add", agentName,
      "--workspace", wsPath,
      "--non-interactive", "--json",
    ]);

    await configureAgentPersona(inst, personaKey, wsPath);

    try {
      await runCommand("docker", [
        "exec", inst.containerName,
        "node", "/app/openclaw.mjs", "agents", "set-identity",
        "--agent", agentName,
        "--name", personaConfig.name,
        "--emoji", personaConfig.emoji,
      ]);
    } catch {
      // Non-critical
    }

    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);

    // Track agent added via WhatsApp
    const posthog = getPostHogClient();
    posthog?.capture({ distinctId: session.userId, event: "wa_agent_added", properties: { source: "whatsapp", agent_id: agentName, persona: personaKey } });

    const activeId = session.activeAgent || "main";
    const currentAgent = agents.find((a) => a.id === activeId);
    const currentDisplay = currentAgent
      ? `${currentAgent.emoji} *${currentAgent.name}*`
      : "your current agent";

    const fallback = `✅ ${personaConfig.emoji} *${personaConfig.name}* added!\n\nyou're still chatting with ${currentDisplay}.\nuse */switch ${personaConfig.name}* to switch.`;
    await sendPlivoInteractive(
      session.phone,
      buildAddSuccessInteractive(personaConfig.emoji, personaConfig.name, agentName, currentDisplay),
      fallback,
    );
    return null;
  } catch (err) {
    console.error("[whatsapp] Add agent error:", err);
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    return "❌ couldn't add the agent. try again with /add or /reset.";
  }
}

async function handleSwitchCommand(
  session: WhatsAppSession,
  instance: Instance,
  text: string,
): Promise<string | null> {
  const agents = await listInstanceAgents(instance);
  const activeId = session.activeAgent || "main";

  const arg = text.replace(/^\/switch\s*/i, "").trim();

  if (!arg) {
    const lines = agents.map((a, i) => {
      const active = a.id === activeId ? " ← _active_" : "";
      return `${i + 1}. ${a.emoji} *${a.name}*${active}`;
    });
    const fallback = `switch to which agent?\n\n${lines.join("\n")}\n\nreply */switch* _name_ or */switch* _number_`;
    await sendPlivoInteractive(
      session.phone,
      buildAgentListInteractive(agents, activeId, "switch agent", "tap the agent you want to switch to."),
      fallback,
    );
    return null;
  }

  const num = parseInt(arg, 10);
  let target: WaAgentInfo | undefined;

  if (!isNaN(num) && num >= 1 && num <= agents.length) {
    target = agents[num - 1];
  } else {
    const lower = arg.toLowerCase();
    target = agents.find(
      (a) =>
        a.name.toLowerCase() === lower ||
        a.id.toLowerCase() === lower ||
        a.name.toLowerCase().includes(lower),
    );
  }

  if (!target) {
    const lines = agents.map((a, i) => `${i + 1}. ${a.emoji} *${a.name}*`);
    const fallback = `can't find an agent called "${arg}" 🤷\n\nyour agents:\n${lines.join("\n")}\n\ntry */switch* _name_`;
    await sendPlivoInteractive(
      session.phone,
      buildAgentListInteractive(agents, activeId, "switch agent", `can't find "${arg}" 🤷\ntap the agent you want.`),
      fallback,
    );
    return null;
  }

  if (target.id === activeId) {
    return `you're already chatting with ${target.emoji} *${target.name}*`;
  }

  const fromAgent = activeId;
  session.activeAgent = target.id;
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  const posthog = getPostHogClient();
  posthog?.capture({ distinctId: session.userId, event: "wa_agent_switched", properties: { source: "whatsapp", from_agent: fromAgent, to_agent: target.id } });

  return `🔄 switched to ${target.emoji} *${target.name}*\n\ngo ahead, talk to your ${target.name.toLowerCase()}.`;
}

async function handleUnlinkCommand(session: WhatsAppSession): Promise<string> {
  const phone = session.phone;
  const linked = dbGetLinkedByPhone(phone);

  if (!linked) {
    return "your WhatsApp isn't linked to any web account.";
  }

  const waUserId = `wa-${phone}`;

  // Remove linked_accounts entry
  dbDeleteLinkedByPhone(phone);

  // Revert instance.userId to wa-{phone} if instance exists
  if (session.instanceId) {
    dbUpdateInstanceUserId(session.instanceId, waUserId);
    const cached = instances.get(session.instanceId);
    if (cached) cached.userId = waUserId;
  }

  // Revert whatsapp_sessions.userId to wa-{phone}
  session.userId = waUserId;
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  console.log(`[unlink] Unlinked WA phone ${phone} from web user ${linked.web_user_id}`);

  return `🔓 unlinked from web account.\n\nyour instance is now WhatsApp-only again. visit the dashboard to re-link.`;
}

async function handleReset(phone: string): Promise<string | null> {
  const posthog = getPostHogClient();
  posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_command_used", properties: { source: "whatsapp", command: "/reset" } });
  posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_session_reset", properties: { source: "whatsapp" } });

  const session = dbGetWaSession(phone);
  if (session?.instanceId) {
    try {
      await destroyInstance(session.instanceId);
    } catch {
      // Instance may already be gone
    }
  }
  dbDeleteWaSession(phone);
  // Re-create session so the user's next message is treated as persona selection
  const now = new Date().toISOString();
  dbUpsertWaSession({
    phone,
    userId: `wa-${phone}`,
    currentState: "PERSONA_SELECT",
    selectedPersona: null,
    selectedProvider: null,
    instanceId: null,
    activeAgent: null,
    createdAt: now,
    updatedAt: now,
  });
  await sendPlivoMessage(phone, "🔄 wiped clean. fresh start.");
  // Send both interactive list AND text fallback so users can always proceed
  await sendWelcomeInteractive(phone);
  await sendPlivoMessage(
    phone,
    `👆 _tap "Choose Agent" above, or type a number (1-${PERSONA_KEYS.length}) to pick._`,
  );
  return null;
}

async function handleStatus(phone: string): Promise<void> {
  const session = dbGetWaSession(phone);
  if (!session) {
    await sendPlivoMessage(phone, "no active session. send any message to get started.");
    return;
  }

  if (session.instanceId) {
    const inst = instances.get(session.instanceId);
    if (inst) {
      const persona = session.selectedPersona ? PERSONA_CONFIGS[session.selectedPersona] : null;
      const provider = session.selectedProvider ? PROVIDER_CONFIG[session.selectedProvider] : null;
      const statusEmoji = inst.status === "running" ? "🟢" : inst.status === "starting" ? "🟡" : "🔴";
      const activeDisplay = getAgentDisplay(inst, session.activeAgent);
      const statusText = [
        `📊 *instance status*`,
        ``,
        `active agent: ${activeDisplay}`,
        `provider: ${provider?.label ?? "unknown"}`,
        `status: ${statusEmoji} ${inst.status}`,
        ``,
        `🌐 dashboard: ${BASE_URL}/i/${inst.id}/`,
      ].join("\n");
      await sendPlivoInteractive(phone, buildStatusInteractive(statusText), statusText);
      return;
    }
  }

  await sendPlivoMessage(phone, `current state: _${session.currentState}_\n\nuse /reset to start over.`);
}

// --- OpenClaw message proxy ---

async function proxyToOpenClaw(instance: Instance, message: string, activeAgent?: string | null): Promise<string> {
  const sessionKey = activeAgent && activeAgent !== "main"
    ? `agent:${activeAgent}:main`
    : undefined; // let client use server default for main agent

  try {
    const response = await sendChatMessage({
      port: instance.port,
      token: instance.token,
      message: `${message}\n\n---\n_Sent via WhatsApp_`,
      sessionKey,
      clientId: "openclaw-control-ui",
      timeout: 120_000,
    });

    // Append active agent name so the user knows who responded
    const agentDisplay = getAgentDisplay(instance, activeAgent);
    return `${response}\n\n— _${agentDisplay}_`;
  } catch (err) {
    console.error(`[whatsapp] OpenClaw proxy error for ${maskPhone(instance.id)}:`, err);
    return "couldn't reach your agent. try again or /reset.";
  }
}

// --- Deployment ---

async function deployWhatsAppInstance(
  session: WhatsAppSession,
  apiKey: string,
  providerConfig: { envVar: string; modelId: string; label: string },
  personaConfig: { name: string; emoji: string },
): Promise<void> {
  const port = await allocatePort();
  const token = randomBytes(16).toString("hex");
  const id = randomBytes(12).toString("hex");
  const containerName = `${CONTAINER_PREFIX}${id}`;
  const volumeName = `${CONTAINER_PREFIX}data-${id}`;

  // If phone is already linked to a web user, use canonical (web) userId
  const phone = session.phone;
  const linked = dbGetLinkedByPhone(phone);
  const canonicalUserId = linked ? linked.web_user_id : session.userId;

  const instance: Instance = {
    id,
    containerName,
    port,
    token,
    status: "starting",
    dashboardUrl: null,
    createdAt: new Date().toISOString(),
    logs: [],
    provider: session.selectedProvider!,
    modelId: providerConfig.modelId,
    persona: session.selectedPersona!,
    userId: canonicalUserId,
  };

  instances.set(id, instance);
  session.instanceId = id;
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  try {
    // Start container (same security profile as deploy/route.ts)
    const dockerArgs = [
      "run", "-d",
      "--name", containerName,
      "--pids-limit", "256",
      "--memory", "1536m",
      "--memory-swap", "1536m",
      "--cpus", "1",
      "--cap-drop", "SYS_ADMIN",
      "--cap-drop", "NET_ADMIN",
      "--cap-drop", "NET_RAW",
      "--cap-drop", "SYS_PTRACE",
      "--cap-drop", "MKNOD",
      "--cap-drop", "AUDIT_WRITE",
      "--cap-drop", "SYS_MODULE",
      "--cap-drop", "DAC_READ_SEARCH",
      "--cap-drop", "LINUX_IMMUTABLE",
      "--cap-drop", "SYS_RAWIO",
      "--cap-drop", "SYS_BOOT",
      "--security-opt", "no-new-privileges",
      "-p", `127.0.0.1:${port}:18789`,
      "-v", `${volumeName}:/home/node/.openclaw`,
      "-e", `OPENCLAW_GATEWAY_TOKEN=${token}`,
      "-e", "PORT=18789",
      "-e", `${providerConfig.envVar}=${apiKey}`,
      "-e", "NODE_OPTIONS=--max-old-space-size=1024",
      "--restart", "unless-stopped",
      OPENCLAW_IMAGE,
      "node", "openclaw.mjs", "gateway",
      "--port", "18789", "--allow-unconfigured", "--bind", "lan",
    ];
    await runCommand("docker", dockerArgs);

    // Fix volume ownership
    try {
      await runCommand("docker", [
        "exec", "-u", "root", containerName,
        "chown", "-R", "node:node", "/home/node/.openclaw",
      ]);
    } catch {
      // Non-fatal
    }

    // Wait for gateway health
    const healthy = await waitForHealth(port, 60);

    if (healthy) {
      // Configure gateway + model + persona in parallel
      const tasks: Promise<void>[] = [
        injectGatewayConfig(instance).catch(() => {}),
        runCommand("docker", [
          "exec", containerName,
          "node", "/app/openclaw.mjs", "models", "set", providerConfig.modelId,
        ]).then(() => {}).catch(() => {}),
      ];

      if (session.selectedPersona) {
        const mainWsPath = "/home/node/.openclaw/workspace";
        tasks.push(
          configureAgentPersona(instance, session.selectedPersona, mainWsPath)
            .then(async () => {
              const pc = PERSONA_CONFIGS[session.selectedPersona!];
              if (pc) {
                try {
                  await runCommand("docker", [
                    "exec", containerName,
                    "node", "/app/openclaw.mjs", "agents", "set-identity",
                    "--agent", "main",
                    "--name", pc.name,
                    "--emoji", pc.emoji,
                  ]);
                } catch {
                  // Non-critical
                }
              }
            }),
        );
      }

      await Promise.all(tasks);

      instance.status = "running";
      instance.dashboardUrl = `/i/${id}/`;
      startPairingAutoApprover(instance);

      // Track successful deployment via WhatsApp
      const posthogOk = getPostHogClient();
      posthogOk?.capture({ distinctId: session.userId, event: "wa_instance_deployed", properties: { source: "whatsapp", instance_id: id, provider: session.selectedProvider, persona: session.selectedPersona } });

      session.currentState = "ACTIVE";
      session.activeAgent = "main";
      session.updatedAt = new Date().toISOString();
      dbUpsertWaSession(session);

      const deployFallback =
        `🎮 *your ${personaConfig.emoji} ${personaConfig.name} is live!*\n\n` +
        `type anything to start chatting with your agent.\n\n` +
        `🌐 web dashboard: ${BASE_URL}/i/${id}/\n\n` +
        `_commands: /status /agents /help /reset_`;
      await sendPlivoInteractive(
        session.phone,
        buildDeploySuccessInteractive(personaConfig.emoji, personaConfig.name, id),
        deployFallback,
      );
    } else {
      instance.status = "error";

      const posthogFail = getPostHogClient();
      posthogFail?.capture({ distinctId: session.userId, event: "wa_instance_deploy_failed", properties: { source: "whatsapp", instance_id: id, provider: session.selectedProvider, persona: session.selectedPersona, error_reason: "gateway_timeout" } });

      session.currentState = "API_KEY";
      session.instanceId = null;
      session.updatedAt = new Date().toISOString();
      dbUpsertWaSession(session);

      await sendPlivoMessage(
        session.phone,
        "❌ deploy failed — agent didn't respond in time.\n\nsend your API key to try again, or /reset to start over.",
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] Deploy error for ${maskPhone(session.phone)}:`, redactSensitive(msg));

    instance.status = "error";

    const posthogErr = getPostHogClient();
    posthogErr?.capture({ distinctId: session.userId, event: "wa_instance_deploy_failed", properties: { source: "whatsapp", instance_id: id, provider: session.selectedProvider, persona: session.selectedPersona, error_reason: "exception" } });

    session.currentState = "API_KEY";
    session.instanceId = null;
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);

    // Provide a more specific error message to the user
    const isDockerError = msg.includes("docker daemon") || msg.includes("Docker daemon") || msg.includes("Cannot connect");
    const userMsg = isDockerError
      ? "❌ deployment server is temporarily unavailable (Docker offline).\n\ntry again in a few minutes, or /reset to start over."
      : "❌ deploy failed. send your API key to try again, or /reset to start over.";

    await sendPlivoMessage(session.phone, userMsg);
  }
}

// --- Deploy helpers ---

async function waitForHealth(port: number, timeoutSeconds: number): Promise<boolean> {
  const start = Date.now();
  const timeout = timeoutSeconds * 1000;

  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function allocatePort(): Promise<number> {
  const usedPorts = new Set(
    Array.from(instances.values()).map((i) => i.port),
  );

  for (let port = PORT_RANGE_START; port < PORT_RANGE_START + 100; port++) {
    if (!usedPorts.has(port)) {
      try {
        await runCommandSilent("lsof", ["-i", `:${port}`]);
        // Port in use — continue
      } catch {
        return port; // Port free
      }
    }
  }
  throw new Error("No available ports in range");
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await runCommandSilent("docker", ["info"]);
    return true;
  } catch {
    return false;
  }
}

async function injectGatewayConfig(instance: Instance): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    const raw = await runCommandSilent("docker", [
      "exec", instance.containerName, "cat", OPENCLAW_CONFIG_PATH,
    ]);
    config = JSON.parse(raw);
  } catch {
    // Config may not exist yet
  }

  const gateway = (config.gateway || {}) as Record<string, unknown>;
  gateway.trustedProxies = ["172.17.0.0/16", "127.0.0.1"];

  const controlUi = (gateway.controlUi || {}) as Record<string, unknown>;
  controlUi.allowedOrigins = ["https://clawgent.ai", "http://localhost:3001"];
  controlUi.allowInsecureAuth = true;
  gateway.controlUi = controlUi;
  config.gateway = gateway;

  const tmpDir = mkdtempSync(join(tmpdir(), "clawgent-gw-"));
  try {
    const configPath = join(tmpDir, "openclaw.json");
    writeFileSync(configPath, JSON.stringify(config, null, 2));
    await runCommand("docker", [
      "cp", configPath, `${instance.containerName}:${OPENCLAW_CONFIG_PATH}`,
    ]);
    // Fix ownership — docker cp creates files as root
    await runCommand("docker", [
      "exec", "-u", "root", instance.containerName,
      "chown", "node:node", OPENCLAW_CONFIG_PATH,
    ]);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }

  try {
    await runCommandSilent("docker", [
      "exec", instance.containerName, "kill", "-USR1", "1",
    ]);
  } catch {
    // Non-fatal
  }
}
