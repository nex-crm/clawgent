import {
  dbGetWaSession,
  dbUpsertWaSession,
  dbDeleteWaSession,
  dbInsertWaMessage,
  dbGetLinkedByPhone,
  dbDeleteLinkedByPhone,
  dbUpdateInstanceUserId,
  dbInsertLinkCode,
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
import { trackOutboundRun, untrackOutboundRun, startInstanceListener, stopInstanceListener } from "./instance-listener";
import { getPostHogClient } from "./posthog-server";
import { clearKeyStatus, validateInstanceKey } from "./key-validator";
import {
  PLIVO_AUTH_ID,
  PLIVO_AUTH_TOKEN,
  PLIVO_WHATSAPP_NUMBER,
  PLIVO_API_URL,
  BASE_URL,
  WA_BRAND_HEADER,
  WA_BRAND_FOOTER,
  WA_WELCOME_BODY,
  WA_HELP_LABEL,
  MAX_INSTANCES,
  CONTAINER_MEMORY,
  CONTAINER_MEMORY_SWAP,
  CONTAINER_CPUS,
  TRUSTED_PROXIES,
  ALLOWED_ORIGINS,
} from "./whatsapp-config";
import { randomBytes } from "crypto";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// --- Config ---

const OPENCLAW_IMAGE = "clawgent-openclaw";
const OPENCLAW_CONFIG_PATH = "/home/node/.openclaw/openclaw.json";
const PORT_RANGE_START = 19000;
const CONTAINER_PREFIX = "clawgent-";
const AGENTS_BASE = "/home/node/.openclaw/agents";
const MAX_MESSAGE_LENGTH = 4000;

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
  `yo, ${WA_BRAND_HEADER} 🎮\n\n` +
  `${WA_WELCOME_BODY}\n\n` +
  `_pick your agent:_\n\n` +
  buildPersonaMenu() +
  `\n\n_reply with a number (1-${PERSONA_KEYS.length})_`;

const HELP_MESSAGE =
  `🤖 *${WA_HELP_LABEL}*\n\n` +
  `*/help* — this message\n` +
  `*/status* — check your instance\n` +
  `*/agents* — list agents on your instance\n` +
  `*/add* — add a new agent\n` +
  `*/switch* _name_ — switch active agent\n` +
  `*/key* — change AI provider or API key\n` +
  `*/link* — connect to a web-deployed instance\n` +
  `*/unlink* — disconnect from web account\n` +
  `*/reset* — nuke everything, start fresh\n\n` +
  `_anything without a / goes straight to your active agent._\n\n` +
  `🌐 web dashboard: ${BASE_URL}`;

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
    header: { type: "text", text: WA_BRAND_HEADER },
    body: {
      text: WA_WELCOME_BODY,
    },
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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
      text: `🤖 *${WA_HELP_LABEL}*\n\n` +
        "*/status* — check your instance\n" +
        "*/agents* — list & switch agents\n" +
        "*/add* — add a new agent\n" +
        "*/switch* _name_ — switch active agent\n" +
        "*/key* — change AI provider or API key\n" +
        "*/link* — connect to a web-deployed instance\n" +
        "*/unlink* — disconnect from web account\n" +
        "*/reset* — nuke everything, start fresh\n\n" +
        "_anything without a / goes straight to your active agent._\n\n" +
        `🌐 web dashboard: ${BASE_URL}`,
    },
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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
    footer: { text: WA_BRAND_FOOTER },
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

  // Split long messages into chunks instead of truncating
  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);

  const url = `${PLIVO_API_URL}/Account/${PLIVO_AUTH_ID}/Message/`;
  const auth = Buffer.from(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`).toString("base64");

  for (const chunk of chunks) {
    const payload = {
      src: PLIVO_WHATSAPP_NUMBER,
      dst: to,
      type: "whatsapp",
      text: chunk,
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
}

/** Split text into chunks of maxLen, breaking at paragraph > sentence > word boundaries. */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let breakAt = -1;
    // Try paragraph break (double newline)
    const paraIdx = remaining.lastIndexOf("\n\n", maxLen);
    if (paraIdx > maxLen * 0.3) breakAt = paraIdx;
    // Try single newline
    if (breakAt === -1) {
      const nlIdx = remaining.lastIndexOf("\n", maxLen);
      if (nlIdx > maxLen * 0.3) breakAt = nlIdx;
    }
    // Try sentence break
    if (breakAt === -1) {
      const dotIdx = remaining.lastIndexOf(". ", maxLen);
      if (dotIdx > maxLen * 0.3) breakAt = dotIdx + 1;
    }
    // Try space
    if (breakAt === -1) {
      const spIdx = remaining.lastIndexOf(" ", maxLen);
      if (spIdx > maxLen * 0.3) breakAt = spIdx;
    }
    // Hard cut as last resort
    if (breakAt === -1) breakAt = maxLen;

    chunks.push(remaining.slice(0, breakAt).trimEnd());
    remaining = remaining.slice(breakAt).trimStart();
  }

  return chunks;
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
  if (cmd === "/link") {
    const posthog = getPostHogClient();
    posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_command_used", properties: { source: "whatsapp", command: "/link" } });
    await handleLinkCommand(phone);
    return null;
  }

  // Get or create session — users without a session always start onboarding
  let session = dbGetWaSession(phone);
  if (!session) {
    // G4: Check if this phone is linked to a web user with a running instance
    const linked = dbGetLinkedByPhone(phone);
    if (linked) {
      const existingInstance = findInstanceByAnyLinkedUserId(linked.web_user_id);
      if (existingInstance && (existingInstance.status === "running" || existingInstance.status === "starting")) {
        // Skip onboarding — go directly to ACTIVE
        const now = new Date().toISOString();
        session = {
          phone,
          userId: `wa-${phone}`,
          currentState: "ACTIVE",
          selectedPersona: existingInstance.persona ?? null,
          selectedProvider: existingInstance.provider ?? null,
          instanceId: existingInstance.id,
          activeAgent: "main",
          createdAt: now,
          updatedAt: now,
        };
        dbUpsertWaSession(session);

        const posthog = getPostHogClient();
        posthog?.identify({ distinctId: `wa-${phone}`, properties: { source: "whatsapp", phone, channel: "whatsapp" } });
        posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_session_started", properties: { source: "whatsapp", skipped_onboarding: true, linked_instance: existingInstance.id } });

        console.log(`[wa] Phone ${phone} linked to web user ${linked.web_user_id}, skipping to ACTIVE with instance ${existingInstance.id}`);
        startInstanceListener(existingInstance.id, existingInstance.port, existingInstance.token, phone);
        await sendPlivoMessage(phone, "welcome back! your instance is already running.\n\njust type to chat with your agent.");
        return null;
      }
    }

    // Normal onboarding flow
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
    case "KEY_PROVIDER_SELECT":
      return await handleKeyProviderSelect(session, text);
    case "KEY_INPUT":
      return await handleKeyInput(session, text);
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
    startInstanceListener(existing.id, existing.port, existing.token, session.phone);
    return `You already have a running agent! Just type to chat with your ${personaConfig.emoji} ${personaConfig.name}.`;
  }

  // Global instance cap
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
      startInstanceListener(inst.id, inst.port, inst.token, session.phone);
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
  if (cmd === "/key") {
    posthog?.capture({ distinctId: session.userId, event: "wa_command_used", properties: { source: "whatsapp", command: "/key" } });
    return await handleKeyCommand(session);
  }
  if (cmd === "/unlink") {
    posthog?.capture({ distinctId: session.userId, event: "wa_command_used", properties: { source: "whatsapp", command: "/unlink" } });
    return await handleUnlinkCommand(session);
  }

  // Track message sent to agent
  posthog?.capture({ distinctId: session.userId, event: "wa_message_sent", properties: { source: "whatsapp", agent_id: session.activeAgent ?? "main" } });

  // Generate runId for outbound tracking (prevents persistent listener from duplicating the response)
  const runId = crypto.randomUUID();
  trackOutboundRun(runId);

  // Delayed thinking indicator — only send if OpenClaw takes >60s to respond
  const thinkingTimer = setTimeout(async () => {
    await sendPlivoMessage(session.phone, "🤔 still thinking...");
  }, 60_000);

  try {
    const reply = await proxyToOpenClaw(inst, text, session.activeAgent, runId);
    clearTimeout(thinkingTimer);
    await sendPlivoMessage(session.phone, reply);
  } finally {
    clearTimeout(thinkingTimer);
    // Delay untracking for 3 minutes (> poll interval of 2 min)
    // so the poller doesn't re-discover this message as "proactive"
    setTimeout(() => untrackOutboundRun(runId), 3 * 60 * 1000);
  }
  return null;
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

// --- /key command: change provider + API key ---

function buildKeyProviderInteractive(): PlivoInteractiveButton {
  return {
    type: "button",
    body: {
      text: "which AI model should power your instance?\n\n_this will restart your instance with the new key._",
    },
    footer: { text: WA_BRAND_FOOTER },
    action: {
      buttons: [
        { title: "Claude Sonnet 4.5", id: "anthropic" },
        { title: "Gemini 3 Flash", id: "google" },
        { title: "GPT-5.2", id: "openai" },
      ],
    },
  };
}

async function handleKeyCommand(session: WhatsAppSession): Promise<string | null> {
  session.currentState = "KEY_PROVIDER_SELECT";
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  const fallback =
    "pick your new AI model:\n\n" +
    buildProviderMenu() +
    "\n\n_reply 1, 2, or 3 — or /cancel_";

  await sendPlivoInteractive(session.phone, buildKeyProviderInteractive(), fallback);
  return null;
}

async function handleKeyProviderSelect(session: WhatsAppSession, text: string): Promise<string | null> {
  const trimmed = text.trim().toLowerCase();

  if (trimmed === "/cancel") {
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    return "cancelled. back to your agent.";
  }

  let providerKey: string | undefined;
  if (PROVIDER_KEYS.includes(trimmed)) {
    providerKey = trimmed;
  } else {
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= PROVIDER_KEYS.length) {
      providerKey = PROVIDER_KEYS[num - 1];
    }
  }

  if (!providerKey) {
    await sendPlivoMessage(session.phone, "pick one of the three models below, or /cancel to go back.");
    await sendPlivoInteractive(session.phone, buildKeyProviderInteractive());
    return null;
  }

  const provider = PROVIDER_CONFIG[providerKey];
  const keyUrl = PROVIDER_KEY_URLS[providerKey] ?? "";

  session.selectedProvider = providerKey;
  session.currentState = "KEY_INPUT";
  session.updatedAt = new Date().toISOString();
  dbUpsertWaSession(session);

  return (
    `*${provider.label}* selected.\n\n` +
    `paste your new API key below.\n\n` +
    (keyUrl ? `grab it here: ${keyUrl}\n\n` : "") +
    `🔒 _your key is only used to power your agent instance._\n\n` +
    `_/cancel to go back_`
  );
}

async function handleKeyInput(session: WhatsAppSession, text: string): Promise<string | null> {
  const trimmed = text.trim();

  if (trimmed.toLowerCase() === "/cancel") {
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    return "cancelled. back to your agent.";
  }

  const apiKey = trimmed;
  const providerKey = session.selectedProvider!;
  const config = PROVIDER_CONFIG[providerKey];

  // Basic length check
  if (apiKey.length < 10) {
    const hint = API_KEY_PREFIXES[providerKey];
    return `hmm, that doesn't look like a valid API key 🤔\n\n` +
      (hint ? `${config.label} keys ${hint.hint}\n\n` : "") +
      `try again? paste your key below.\n\n_/cancel to go back_`;
  }

  // Format validation
  const keyCheck = API_KEY_PREFIXES[providerKey];
  if (keyCheck && !apiKey.startsWith(keyCheck.prefix)) {
    return `hmm, that doesn't look like a valid API key 🤔\n\n` +
      `${config.label} keys ${keyCheck.hint}\n\ntry again?\n\n_/cancel to go back_`;
  }

  const inst = session.instanceId ? instances.get(session.instanceId) : undefined;
  if (!inst) {
    session.currentState = "PERSONA_SELECT";
    session.instanceId = null;
    session.activeAgent = null;
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);
    await sendPlivoMessage(session.phone, "your instance went offline. let's start fresh:");
    await sendWelcomeInteractive(session.phone);
    return null;
  }

  await sendPlivoMessage(session.phone, `⏳ switching to *${config.label}*... this takes ~30 seconds.`);

  try {
    // 1. Stop listener
    stopInstanceListener(inst.id);

    // 2. Stop + remove container (volume persists)
    try {
      await runCommandSilent("docker", ["stop", inst.containerName]);
    } catch { /* may already be stopped */ }
    try {
      await runCommandSilent("docker", ["rm", "-f", inst.containerName]);
    } catch { /* may already be removed */ }

    // 3. Update instance state
    inst.status = "starting";
    inst.provider = providerKey;
    inst.modelId = config.modelId;
    instances.set(inst.id, inst);

    // 4. Recreate container with new API key
    const volumeName = `clawgent-data-${inst.id}`;
    const dockerArgs = [
      "run", "-d",
      "--name", inst.containerName,
      "--pids-limit", "256",
      "--memory", CONTAINER_MEMORY,
      "--memory-swap", CONTAINER_MEMORY_SWAP,
      "--cpus", CONTAINER_CPUS,
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
      "-p", `127.0.0.1:${inst.port}:18789`,
      "-v", `${volumeName}:/home/node/.openclaw`,
      "-e", `OPENCLAW_GATEWAY_TOKEN=${inst.token}`,
      "-e", "PORT=18789",
      "-e", `${config.envVar}=${apiKey}`,
      "-e", "NODE_OPTIONS=--max-old-space-size=1024",
      "--restart", "unless-stopped",
      OPENCLAW_IMAGE,
      "node", "openclaw.mjs", "gateway",
      "--port", "18789", "--allow-unconfigured", "--bind", "lan",
    ];
    await runCommand("docker", dockerArgs);

    // 5. Fix volume ownership
    try {
      await runCommand("docker", [
        "exec", "-u", "root", inst.containerName,
        "chown", "-R", "node:node", "/home/node/.openclaw",
      ]);
    } catch { /* non-fatal */ }

    // 6. Wait for health
    const healthy = await waitForHealth(inst.port, 180);
    if (!healthy) {
      inst.status = "error";
      instances.set(inst.id, inst);
      session.currentState = "ACTIVE";
      session.updatedAt = new Date().toISOString();
      dbUpsertWaSession(session);
      return "❌ instance failed to restart after key change.\n\ntry again with /key or /reset to start over.";
    }

    // 7. Update model in openclaw.json
    try {
      await injectGatewayConfig(inst, config.modelId);
    } catch {
      // Non-fatal
    }

    // 8. Mark running
    inst.status = "running";
    inst.dashboardUrl = `/i/${inst.id}/`;
    instances.set(inst.id, inst);

    // 9. Clear old key status + validate
    clearKeyStatus(inst.id);
    validateInstanceKey(inst.id).catch((err) =>
      console.error(`[wa-key] Key validation after change failed for ${inst.id}:`, err),
    );

    // 10. Restart pairing auto-approver + listener
    startPairingAutoApprover(inst);
    startInstanceListener(inst.id, inst.port, inst.token, session.phone);

    // 11. Back to ACTIVE
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);

    const posthog = getPostHogClient();
    posthog?.capture({
      distinctId: session.userId,
      event: "wa_provider_changed",
      properties: { source: "whatsapp", instance_id: inst.id, provider: providerKey, model_id: config.modelId },
    });

    console.log(`[wa-key] Provider change complete for instance ${inst.id}: now ${providerKey}`);

    return `✅ switched to *${config.label}*. your instance is back online.\n\njust type to chat with your agent.`;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[wa-key] Provider change error for instance ${inst.id}:`, redactSensitive(msg));

    inst.status = "error";
    instances.set(inst.id, inst);
    session.currentState = "ACTIVE";
    session.updatedAt = new Date().toISOString();
    dbUpsertWaSession(session);

    return "❌ key change failed. try again with /key or /reset to start over.";
  }
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

  // Stop proactive listener (web user may manage instance separately now)
  if (session.instanceId) stopInstanceListener(session.instanceId);

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

  const dashboardLink = session.instanceId ? `${BASE_URL}/i/${session.instanceId}/` : BASE_URL;
  return `🔓 unlinked from web account.\n\nyour instance is now WhatsApp-only again.\n\n🌐 re-link anytime: ${dashboardLink}`;
}

// --- /link command: generate code to link WA to a web instance ---

const LINK_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 30 chars, no 0/O/1/I/L
const LINK_CODE_LENGTH = 6;
const LINK_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function generateLinkCode(): string {
  const bytes = randomBytes(LINK_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_CHARSET[bytes[i] % LINK_CODE_CHARSET.length];
  }
  return code;
}

async function handleLinkCommand(phone: string): Promise<void> {
  const linked = dbGetLinkedByPhone(phone);
  if (linked) {
    await sendPlivoMessage(
      phone,
      `your WhatsApp is already linked to a web account.\n\n` +
        `use */unlink* first if you want to link to a different account.\n\n` +
        `🌐 dashboard: ${BASE_URL}`,
    );
    return;
  }

  const code = generateLinkCode();
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
  dbInsertLinkCode(code, phone, expiresAt);

  await sendPlivoMessage(
    phone,
    `🔗 *link code:* \`\`\`${code}\`\`\`\n\n` +
      `open ${BASE_URL}/link in your browser and enter this code.\n\n` +
      `⏳ expires in 15 minutes.\n\n` +
      `_this connects your WhatsApp to your web-deployed instance so you can chat with it from here._`,
  );
}

async function handleReset(phone: string): Promise<string | null> {
  const posthog = getPostHogClient();
  posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_command_used", properties: { source: "whatsapp", command: "/reset" } });
  posthog?.capture({ distinctId: `wa-${phone}`, event: "wa_session_reset", properties: { source: "whatsapp" } });

  const session = dbGetWaSession(phone);

  // G2: Clean up linked_accounts if this instance was linked to a web user
  const linked = dbGetLinkedByPhone(phone);
  if (linked) {
    dbDeleteLinkedByPhone(phone);
    console.log(`[reset] Cleaned up linked_accounts for phone ${phone} (was linked to ${linked.web_user_id})`);
  }

  if (session?.instanceId) {
    stopInstanceListener(session.instanceId);
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

async function proxyToOpenClaw(instance: Instance, message: string, activeAgent?: string | null, runId?: string): Promise<string> {
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
      runId,
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
      "--memory", CONTAINER_MEMORY,
      "--memory-swap", CONTAINER_MEMORY_SWAP,
      "--cpus", CONTAINER_CPUS,
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
    const healthy = await waitForHealth(port, 180);

    if (healthy) {
      // Gateway + model config first (writes openclaw.json)
      try {
        await injectGatewayConfig(instance, providerConfig.modelId);
      } catch {
        // Non-fatal: gateway may still work without custom config
      }

      // Persona injection second (heartbeat also writes openclaw.json — must run after gateway config)
      if (session.selectedPersona) {
        try {
          const mainWsPath = "/home/node/.openclaw/workspace";
          await configureAgentPersona(instance, session.selectedPersona, mainWsPath);
          const pc = PERSONA_CONFIGS[session.selectedPersona];
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
        } catch {
          // Non-fatal: instance works without persona
        }
      }

      instance.status = "running";
      instance.dashboardUrl = `/i/${id}/`;
      startPairingAutoApprover(instance);
      startInstanceListener(instance.id, instance.port, instance.token, session.phone);

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

async function injectGatewayConfig(instance: Instance, modelId?: string): Promise<void> {
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
  gateway.trustedProxies = TRUSTED_PROXIES;

  const controlUi = (gateway.controlUi || {}) as Record<string, unknown>;
  controlUi.allowedOrigins = ALLOWED_ORIGINS;
  controlUi.allowInsecureAuth = true;
  gateway.controlUi = controlUi;
  config.gateway = gateway;

  // Set default model at agents.defaults.model.primary
  // (OpenClaw 2026.2.x rejects unknown keys like models.default)
  if (modelId) {
    const agents = (config.agents || {}) as Record<string, unknown>;
    const defaults = (agents.defaults || {}) as Record<string, unknown>;
    const model = (defaults.model || {}) as Record<string, unknown>;
    model.primary = modelId;
    defaults.model = model;
    agents.defaults = defaults;
    config.agents = agents;
  }

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

  // Reload gateway config
  try {
    await runCommandSilent("docker", [
      "exec", instance.containerName,
      "node", "/app/openclaw.mjs", "gateway", "reload",
    ]);
  } catch {
    // Non-fatal
  }
}
