"use client";

import { useState, useEffect, useCallback, useRef, memo } from "react";
import { PERSONA_CONFIGS } from "../lib/personas";
import { useAuthSafe } from "../lib/use-auth-safe";
import { getSignInUrlAction, signOutAction } from "./actions/auth";
import { ArcadeSounds } from "../lib/sounds";

// ─── Persona Types & Data ───────────────────────────────────────────

/** Lightweight skill summary for display in the select grid */
interface SkillSummary {
  name: string;
  emoji: string;
  description: string;
  source: string;
  sourceUrl?: string;
}

interface Persona {
  id: string;
  name: string;
  tagline: string;
  icon: string;
  color: string;
  skills: SkillSummary[];
  recommendedModel: "anthropic" | "google" | "openai";
  sprite: string | null;
}

/** Build SkillSummary[] from PERSONA_CONFIGS for a given persona id */
function buildSkillSummaries(personaId: string): SkillSummary[] {
  const cfg = PERSONA_CONFIGS[personaId];
  if (!cfg) return [];
  return cfg.skills.map((s) => ({
    name: s.name,
    emoji: s.emoji,
    description: s.description,
    source: s.source ?? "Workspace skill",
    sourceUrl: s.sourceUrl,
  }));
}

const PERSONAS: Persona[] = [
  {
    id: "marketing-pro",
    name: "MARKETING PRO",
    tagline: "Finally, a marketer that doesn't need 47 meetings first",
    icon: "\uD83D\uDCE2",
    color: "arcade-pink",
    skills: buildSkillSummaries("marketing-pro"),
    recommendedModel: "anthropic",
    sprite: "/sprites/character-1.png",
  },
  {
    id: "sales-assistant",
    name: "SALES ASSISTANT",
    tagline: "Does the research so you can skip the \"just checking in\" era",
    icon: "\uD83C\uDFAF",
    color: "arcade-yellow",
    skills: buildSkillSummaries("sales-assistant"),
    recommendedModel: "anthropic",
    sprite: "/sprites/character-2.png",
  },
  {
    id: "lead-gen",
    name: "LEAD GEN MACHINE",
    tagline: "Turns the internet into a pipeline. Legally.",
    icon: "\uD83E\uDDF2",
    color: "arcade-orange",
    skills: buildSkillSummaries("lead-gen"),
    recommendedModel: "google",
    sprite: "/sprites/character-3.png",
  },
  {
    id: "dev-copilot",
    name: "DEV COPILOT",
    tagline: "Reviews your PRs without the passive-aggressive comments",
    icon: "\u2328\uFE0F",
    color: "arcade-green",
    skills: buildSkillSummaries("dev-copilot"),
    recommendedModel: "anthropic",
    sprite: "/sprites/character-4.png",
  },
  {
    id: "support-agent",
    name: "SUPPORT AGENT",
    tagline: "Closes tickets faster than users can open them",
    icon: "\uD83D\uDEE1\uFE0F",
    color: "arcade-blue",
    skills: buildSkillSummaries("support-agent"),
    recommendedModel: "anthropic",
    sprite: "/sprites/character-5.png",
  },
  {
    id: "ops-automator",
    name: "OPS AUTOMATOR",
    tagline: "Automates the stuff you keep saying you'll automate next quarter",
    icon: "\u2699\uFE0F",
    color: "arcade-purple",
    skills: buildSkillSummaries("ops-automator"),
    recommendedModel: "google",
    sprite: "/sprites/character-6.png",
  },
  {
    id: "founder-sidekick",
    name: "FOUNDER SIDEKICK",
    tagline: "A co-founder who actually ships and doesn't want equity",
    icon: "\uD83D\uDE80",
    color: "arcade-orange",
    skills: buildSkillSummaries("founder-sidekick"),
    recommendedModel: "anthropic",
    sprite: "/sprites/character-7.png",
  },
  {
    id: "data-analyst",
    name: "DATA ANALYST",
    tagline: "Makes your CSVs confess things they didn't know they knew",
    icon: "\uD83D\uDCCA",
    color: "arcade-blue",
    skills: buildSkillSummaries("data-analyst"),
    recommendedModel: "google",
    sprite: "/sprites/character-8.png",
  },
  {
    id: "gtm-engineer",
    name: "GTM ENGINEER",
    tagline: "Your CRM is a mess. This agent doesn't judge, it fixes.",
    icon: "\u26A1",
    color: "arcade-red",
    skills: buildSkillSummaries("gtm-engineer"),
    recommendedModel: "anthropic",
    sprite: "/sprites/character-9.png",
  },
];

// ─── Provider Config ────────────────────────────────────────────────

type Provider = "anthropic" | "google" | "openai";

const PROVIDERS: {
  value: Provider;
  label: string;
  shortLabel: string;
  model: string;
  keyUrl?: string;
}[] = [
  {
    value: "anthropic",
    label: "Claude Sonnet 4.5",
    shortLabel: "CLAUDE",
    model: "anthropic/claude-sonnet-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    value: "google",
    label: "Gemini 3 Flash",
    shortLabel: "GEMINI",
    model: "google/gemini-3-flash-preview",
    keyUrl: "https://aistudio.google.com/apikey",
  },
  {
    value: "openai",
    label: "GPT-5.2",
    shortLabel: "GPT",
    model: "openai/gpt-5.2",
    keyUrl: "https://platform.openai.com/api-keys",
  },
];

// ─── Instance Types ─────────────────────────────────────────────────

interface InstanceSummary {
  id: string;
  status: "starting" | "running" | "stopped" | "error";
  port: number;
  dashboardUrl: string | null;
  createdAt: string;
  provider?: string;
  modelId?: string;
  persona?: string;
}

interface InstanceDetail extends InstanceSummary {
  token: string;
  logs: string[];
}

// ─── Agent Types (from /api/instances/{id}/agents) ──────────────────

interface AgentInfo {
  agentId: string;
  name: string;
  emoji: string;
  persona: string | null;
  skillCount: number;
  deepLink: string;
}

interface SystemStatus {
  dockerAvailable: boolean;
  totalInstances: number;
  runningInstances: number;
  instances: InstanceSummary[];
}

// ─── User data from /api/user ────────────────────────────────────────

interface UserData {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

interface UserApiResponse {
  user: UserData | null;
  instance: InstanceSummary | null;
}

// ─── Color Helpers ──────────────────────────────────────────────────

function colorToTw(
  color: string,
  prefix: "text" | "bg" | "border" | "shadow"
): string {
  return `${prefix}-${color}`;
}

function colorToCssVar(color: string): string {
  // Use the raw :root CSS custom property (e.g. --arcade-blue),
  // NOT the Tailwind @theme token (--color-arcade-blue) which
  // doesn't resolve outside Tailwind's utility class context.
  return `var(--${color})`;
}

// ─── Shared Persona Icon (sprite or emoji fallback) ───────────────

function PersonaIcon({ persona, size = "cell" }: { persona: Persona; size?: "cell" | "preview" }) {
  if (persona.sprite) {
    if (size === "cell") {
      return (
        <img
          src={persona.sprite}
          alt={persona.name}
          className="sf2-cell-sprite"
          draggable={false}
        />
      );
    }
    return (
      <img
        src={persona.sprite}
        alt={persona.name}
        className="w-20 h-20 sm:w-24 sm:h-24 object-contain"
        style={{ filter: `drop-shadow(0 0 6px ${colorToCssVar(persona.color)})` }}
        draggable={false}
      />
    );
  }
  if (size === "preview") {
    return <span className="sf2-preview-icon">{persona.icon}</span>;
  }
  return <span className="sf2-cell-icon">{persona.icon}</span>;
}

// ─── Memoized Grid Cell ─────────────────────────────────────────────

interface PersonaGridCellProps {
  persona: Persona;
  index: number;
  isActive: boolean;
  isHovered: boolean;
  isPinned: boolean;
  cellColor: string;
  disabled: boolean;
  onClick: (persona: Persona, index: number) => void;
  onHover: (persona: Persona, index: number) => void;
  onLeave: () => void;
}

const PersonaGridCell = memo(function PersonaGridCell({
  persona, index, isActive, isHovered, isPinned, cellColor, disabled, onClick, onHover, onLeave,
}: PersonaGridCellProps) {
  return (
    <button
      onClick={() => onClick(persona, index)}
      onMouseEnter={() => onHover(persona, index)}
      onMouseLeave={onLeave}
      disabled={disabled}
      className="sf2-cell"
      data-active={isActive || isPinned}
      data-hovered={isHovered && !isPinned}
      data-pinned={isPinned}
      style={{ "--sf2-cell-color": cellColor } as React.CSSProperties}
    >
      {isPinned && (
        <>
          <span className="sf2-cursor sf2-cursor-tl" style={{ borderColor: cellColor }} />
          <span className="sf2-cursor sf2-cursor-tr" style={{ borderColor: cellColor }} />
          <span className="sf2-cursor sf2-cursor-bl" style={{ borderColor: cellColor }} />
          <span className="sf2-cursor sf2-cursor-br" style={{ borderColor: cellColor }} />
        </>
      )}
      <span className="sf2-cell-portrait">
        <PersonaIcon persona={persona} size="cell" />
      </span>
      <span className="sf2-cell-name">{persona.name}</span>
      <span className="sf2-cell-bar" />
    </button>
  );
}, (prev, next) =>
  prev.persona.id === next.persona.id &&
  prev.isActive === next.isActive &&
  prev.isHovered === next.isHovered &&
  prev.isPinned === next.isPinned &&
  prev.cellColor === next.cellColor &&
  prev.disabled === next.disabled
);

// ─── Memoized Preview Panel ─────────────────────────────────────────

interface PersonaPreviewPanelProps {
  displayPersona: Persona | null;
  accentVar: string;
  busy: boolean;
  actionLabel: string;
  onActionClick: (persona: Persona) => void;
  onViewAllSkills: (persona: Persona) => void;
}

const PersonaPreviewPanel = memo(function PersonaPreviewPanel({
  displayPersona, accentVar, busy, actionLabel, onActionClick, onViewAllSkills,
}: PersonaPreviewPanelProps) {
  if (busy) return (
    <div
      className="sf2-preview-panel"
      style={{ "--sf2-preview-color": "var(--arcade-green)" } as React.CSSProperties}
    >
      <div className="sf2-preview-accent" />
      <div className="sf2-preview-empty">
        <div className="w-8 h-8 border-2 border-arcade-green border-t-transparent rounded-full animate-spin" />
        <p className="pixel-font text-arcade-green text-[9px] blink tracking-wider mt-3">
          CONFIGURING AGENT...
        </p>
      </div>
    </div>
  );

  if (!displayPersona) return (
    <div
      className="sf2-preview-panel"
      style={{ "--sf2-preview-color": "var(--arcade-yellow)" } as React.CSSProperties}
    >
      <div className="sf2-preview-accent" />
      <div className="sf2-preview-empty">
        <p className="pixel-font text-white/25 text-[8px] blink tracking-wider">
          HOVER TO PREVIEW
        </p>
      </div>
    </div>
  );

  return (
    <div
      className="sf2-preview-panel"
      style={{ "--sf2-preview-color": accentVar } as React.CSSProperties}
    >
      <div className="sf2-preview-accent" />
      <div className="sf2-preview-body">
        {/* Large icon */}
        <div className="flex justify-center">
          <PersonaIcon persona={displayPersona} size="preview" />
        </div>

        {/* Name */}
        <p className="sf2-preview-name">{displayPersona.name}</p>

        {/* Tagline */}
        <p className="sf2-preview-tagline">{displayPersona.tagline}</p>

        {/* Stats */}
        <div className="space-y-1.5">
          <div className="sf2-preview-stat">
            <span className="sf2-preview-stat-label">MODEL</span>
            <span className="sf2-preview-stat-value">
              {PROVIDERS.find((p) => p.value === displayPersona.recommendedModel)?.shortLabel ?? "CLAUDE"}
            </span>
          </div>
          <div className="sf2-preview-stat">
            <span className="sf2-preview-stat-label">SKILLS</span>
            <span className="sf2-preview-stat-value">
              {displayPersona.skills.length}
            </span>
          </div>
        </div>

        {/* Skill tags — max 4 shown */}
        {displayPersona.skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {displayPersona.skills.slice(0, 4).map((skill) => (
              <span
                key={skill.name}
                className="pixel-font text-[9px] px-2.5 py-1 border border-white/20 bg-white/10 text-white/80"
                title={skill.description}
              >
                {skill.name}
              </span>
            ))}
            {displayPersona.skills.length > 4 && (
              <span className="pixel-font text-[9px] px-2.5 py-1 text-white/40">
                +{displayPersona.skills.length - 4} MORE
              </span>
            )}
          </div>
        )}

        {/* View All Skills button */}
        {displayPersona.skills.length > 0 && (
          <button
            onClick={() => onViewAllSkills(displayPersona)}
            onMouseEnter={() => ArcadeSounds.buttonHover()}
            className="pixel-font text-[7px] tracking-wider text-white/30 hover:text-white/60 border border-white/15 hover:border-white/30 px-3 py-1.5 w-full text-center transition-all cursor-pointer"
          >
            VIEW ALL {displayPersona.skills.length} SKILLS
          </button>
        )}

        {/* Action Button */}
        <button
          onClick={() => onActionClick(displayPersona)}
          onMouseEnter={() => ArcadeSounds.buttonHover()}
          disabled={busy}
          className="sf2-select-btn"
          style={{
            "--sf2-preview-color": accentVar,
          } as React.CSSProperties}
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
});

// ─── Template Detail Modal ──────────────────────────────────────────

interface TemplateDetailModalProps {
  persona: Persona;
  onClose: () => void;
}

function TemplateDetailModal({ persona, onClose }: TemplateDetailModalProps) {
  const accentVar = colorToCssVar(persona.color);

  // Close on ESC
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      className="template-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={`${persona.name} skills`}
    >
      <div
        className="template-modal"
        style={{ "--template-modal-color": accentVar } as React.CSSProperties}
      >
        {/* Top accent bar */}
        <div className="template-modal-accent" />

        {/* Header */}
        <div className="template-modal-header">
          <div className="flex items-center gap-3">
            {persona.sprite ? (
              <img
                src={persona.sprite}
                alt={persona.name}
                className="w-12 h-12 object-contain"
                style={{ filter: `drop-shadow(0 0 4px ${accentVar})` }}
                draggable={false}
              />
            ) : (
              <span className="text-3xl">{persona.icon}</span>
            )}
            <div>
              <p className="pixel-font text-sm sm:text-base tracking-wider" style={{ color: accentVar }}>
                {persona.name}
              </p>
              <p className="pixel-font text-[8px] sm:text-[9px] text-white/40 mt-1 leading-relaxed">
                {persona.tagline}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            onMouseEnter={() => ArcadeSounds.buttonHover()}
            className="template-modal-close"
            aria-label="Close"
          >
            ESC
          </button>
        </div>

        {/* Skill count */}
        <div className="px-5 py-2">
          <p className="pixel-font text-[8px] sm:text-[9px] text-white/25 tracking-wider">
            {persona.skills.length} SKILL{persona.skills.length !== 1 ? "S" : ""} PRE-LOADED
          </p>
        </div>

        {/* Skills list */}
        <div className="template-modal-skills">
          {persona.skills.map((skill) => (
            <div key={skill.name} className="template-skill-card">
              <div className="flex items-start gap-2.5">
                <span className="text-base shrink-0 mt-0.5">{skill.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="pixel-font text-[11px] sm:text-xs text-white/80 tracking-wider">
                    {skill.name}
                  </p>
                  <p className="pixel-font text-[10px] sm:text-[11px] text-white/35 mt-1.5 leading-relaxed">
                    {skill.description}
                  </p>
                  <p className="pixel-font text-[8px] sm:text-[9px] text-white/20 mt-1.5 tracking-wider">
                    {skill.sourceUrl ? (
                      <a
                        href={skill.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-white/40 transition-colors"
                        style={{ color: accentVar, opacity: 0.6 }}
                      >
                        {skill.source} ↗
                      </a>
                    ) : (
                      <span>{skill.source}</span>
                    )}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export default function Home() {
  // Feature flags
  const SHOW_INTEGRATIONS = false; // Set to true when Slack/integrations are ready

  // Auth state (works with or without WorkOS)
  const { user: authUser, loading: authLoading } = useAuthSafe();

  // Screen state machine
  const [screen, setScreen] = useState<
    "start" | "select" | "apikey" | "powerups" | "deploying"
  >("start");
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [hoveredPersona, setHoveredPersona] = useState<Persona | null>(null);
  const [gridIndex, setGridIndex] = useState(0); // 0-8 for 3x3 grid keyboard nav
  // Click-to-pin: clicking a grid cell pins that persona in the preview panel.
  // The preview stays locked to the pinned persona regardless of hover.
  // Clicking the same pinned cell again triggers the action (deploy/select).
  const [pinnedPersona, setPinnedPersona] = useState<Persona | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");

  // Channel integrations (power-ups)
  // Setup channels: collected during deploy flow, sent to API after instance is running
  const [setupChannels, setSetupChannels] = useState<{
    slack?: { appToken: string; botToken: string; userToken?: string };
    telegram?: { botToken: string };
    discord?: { token: string };
  }>({});

  // Live channel state from the API (for the home screen)
  const [liveChannels, setLiveChannels] = useState<{
    type: string;
    enabled: boolean;
    status: "connected" | "disconnected" | "error";
    error?: string;
  }[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [channelActionLoading, setChannelActionLoading] = useState<string | null>(null); // channel type being toggled
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelSuccess, setChannelSuccess] = useState<string | null>(null);
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null);
  // Temp credential inputs for connecting channels on home screen
  const [channelInputs, setChannelInputs] = useState<{
    slack: { appToken: string; botToken: string; userToken?: string };
    telegram: { botToken: string };
    discord: { token: string };
  }>({
    slack: { appToken: "", botToken: "", userToken: "" },
    telegram: { botToken: "" },
    discord: { token: "" },
  });

  // System & instance state
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [activeInstanceId, setActiveInstanceId] = useState<string | null>(null);
  const [activeInstance, setActiveInstance] = useState<InstanceDetail | null>(
    null
  );
  const [deploying, setDeploying] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Deploy animation state
  const [showLaunchFlash, setShowLaunchFlash] = useState(false);
  const [showOnline, setShowOnline] = useState(false);
  const [showReady, setShowReady] = useState(false);

  // User's existing instance (from /api/user)
  const [userInstance, setUserInstance] = useState<InstanceSummary | null>(null);
  const [userDataLoading, setUserDataLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);

  // Agent roster state
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [addingAgent, setAddingAgent] = useState(false);
  const [showAddAgentSelect, setShowAddAgentSelect] = useState(false);
  const [addAgentHovered, setAddAgentHovered] = useState<Persona | null>(null);
  const [addAgentPinned, setAddAgentPinned] = useState<Persona | null>(null);

  // Start menu state (SNES-style select)
  const [startMenuIndex, setStartMenuIndex] = useState(0);
  const [snarkyMessage, setSnarkyMessage] = useState<string | null>(null);
  const [nopeShake, setNopeShake] = useState(false);
  const snarkyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Sound State ───────────────────────────────────────────
  const [soundMuted, setSoundMuted] = useState(false);
  const audioInitRef = useRef(false);
  const lastHoverSoundRef = useRef(0);
  const prevLogCountRef = useRef(0);

  // Initialize audio on first click anywhere
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Restore mute state from localStorage before audio init
    try {
      const saved = localStorage.getItem("clawgent-sound-muted");
      if (saved === "true") setSoundMuted(true);
    } catch { /* noop */ }

    const handleFirstInteraction = () => {
      if (!audioInitRef.current) {
        ArcadeSounds.initAudio();
        audioInitRef.current = true;
      }
    };
    document.addEventListener("click", handleFirstInteraction);
    document.addEventListener("keydown", handleFirstInteraction);
    return () => {
      document.removeEventListener("click", handleFirstInteraction);
      document.removeEventListener("keydown", handleFirstInteraction);
    };
  }, []);

  // Debounced cursor hover sound
  const playCursorMove = useCallback(() => {
    const now = Date.now();
    if (now - lastHoverSoundRef.current < 80) return; // 80ms debounce
    lastHoverSoundRef.current = now;
    ArcadeSounds.cursorMove();
  }, []);

  // Toggle mute handler
  const handleToggleMute = useCallback(() => {
    const newMuted = ArcadeSounds.toggleMute();
    setSoundMuted(newMuted);
  }, []);

  // ─── API Integration ──────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setSystemStatus(data);
    } catch {
      // ignore
    }
  }, []);

  // Fetch user data (instance info) when authenticated
  const fetchUserData = useCallback(async () => {
    if (!authUser) {
      setUserInstance(null);
      setUserDataLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/user");
      if (res.ok) {
        const data: UserApiResponse = await res.json();
        setUserInstance(data.instance);
      }
    } catch {
      // ignore
    } finally {
      setUserDataLoading(false);
    }
  }, [authUser]);

  // Fetch agents for the user's instance
  const fetchAgents = useCallback(async (instanceId: string) => {
    setAgentsLoading(true);
    try {
      const res = await fetch(`/api/instances/${instanceId}/agents`);
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? []);
      }
    } catch {
      // ignore — agents endpoint may not exist yet
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  // Fetch channel status for an instance
  const fetchChannels = useCallback(async (instanceId: string) => {
    setChannelsLoading(true);
    try {
      const res = await fetch(`/api/instances/${instanceId}/channels`);
      if (res.ok) {
        const data = await res.json();
        setLiveChannels(data.channels ?? []);
      }
    } catch {
      // ignore — channels endpoint may not be ready yet
    } finally {
      setChannelsLoading(false);
    }
  }, []);

  // Connect a channel via POST
  const connectChannel = useCallback(async (instanceId: string, type: string, config: Record<string, string>) => {
    setChannelActionLoading(type);
    setChannelError(null);
    setChannelSuccess(null);
    try {
      const res = await fetch(`/api/instances/${instanceId}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, config }),
      });
      const data = await res.json();
      if (res.ok) {
        ArcadeSounds.deploySuccess();
        setChannelSuccess(`${type.toUpperCase()} CONNECTED`);
        setExpandedChannel(null);
        // Reset inputs for this channel
        setChannelInputs((prev) => ({
          ...prev,
          ...(type === "slack" ? { slack: { appToken: "", botToken: "", userToken: "" } } : {}),
          ...(type === "telegram" ? { telegram: { botToken: "" } } : {}),
          ...(type === "discord" ? { discord: { token: "" } } : {}),
        }));
        // Refresh channel list
        await fetchChannels(instanceId);
        // Clear success after a few seconds
        setTimeout(() => setChannelSuccess(null), 3000);
      } else {
        ArcadeSounds.deployError();
        setChannelError(data.error ?? `Failed to connect ${type}`);
        setTimeout(() => setChannelError(null), 5000);
      }
    } catch (err) {
      ArcadeSounds.deployError();
      setChannelError(err instanceof Error ? err.message : `Failed to connect ${type}`);
      setTimeout(() => setChannelError(null), 5000);
    } finally {
      setChannelActionLoading(null);
    }
  }, [fetchChannels]);

  // Disconnect a channel via DELETE
  const disconnectChannel = useCallback(async (instanceId: string, type: string) => {
    setChannelActionLoading(type);
    setChannelError(null);
    setChannelSuccess(null);
    try {
      const res = await fetch(`/api/instances/${instanceId}/channels/${type}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        ArcadeSounds.destroy();
        setChannelSuccess(`${type.toUpperCase()} DISCONNECTED`);
        setExpandedChannel(null);
        await fetchChannels(instanceId);
        setTimeout(() => setChannelSuccess(null), 3000);
      } else {
        ArcadeSounds.deployError();
        setChannelError(data.error ?? `Failed to disconnect ${type}`);
        setTimeout(() => setChannelError(null), 5000);
      }
    } catch (err) {
      ArcadeSounds.deployError();
      setChannelError(err instanceof Error ? err.message : `Failed to disconnect ${type}`);
      setTimeout(() => setChannelError(null), 5000);
    } finally {
      setChannelActionLoading(null);
    }
  }, [fetchChannels]);

  // Configure channels collected during deploy flow (after instance is running)
  const configureSetupChannels = useCallback(async (instanceId: string) => {
    const entries = Object.entries(setupChannels) as [string, Record<string, string>][];
    for (const [type, config] of entries) {
      // Only connect channels that have actual credentials filled in
      const hasCredentials = Object.values(config).every((v) => v && v.trim().length > 0);
      if (hasCredentials) {
        try {
          await fetch(`/api/instances/${instanceId}/channels`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, config }),
          });
        } catch {
          // non-blocking — channels can be configured later from the home screen
        }
      }
    }
    setSetupChannels({});
    // Refresh channel list after all are configured
    await fetchChannels(instanceId);
  }, [setupChannels, fetchChannels]);

  // Add an agent to the instance
  const addAgentToInstance = useCallback(async (instanceId: string, persona: string | null) => {
    setAddingAgent(true);
    ArcadeSounds.deployStart();
    try {
      const body: Record<string, string> = {};
      if (persona) body.persona = persona;
      const res = await fetch(`/api/instances/${instanceId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        ArcadeSounds.deploySuccess();
        // Refresh agent list
        await fetchAgents(instanceId);
      } else {
        ArcadeSounds.deployError();
      }
    } catch {
      ArcadeSounds.deployError();
    } finally {
      setAddingAgent(false);
      setShowAddAgentSelect(false);
      setAddAgentPinned(null);
    }
  }, [fetchAgents]);

  // Remove an agent from the instance
  const removeAgent = useCallback(async (instanceId: string, agentId: string) => {
    if (!confirm("Remove this agent? The agent's conversation history will be lost.")) return;
    ArcadeSounds.destroy();
    try {
      await fetch(`/api/instances/${instanceId}/agents/${agentId}`, {
        method: "DELETE",
      });
      setAgents((prev) => prev.filter((a) => a.agentId !== agentId));
    } catch {
      // ignore
    }
  }, []);

  const fetchInstanceDetail = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/instances/${id}`);
        if (!res.ok) return;
        const data: InstanceDetail = await res.json();
        setActiveInstance(data);

        if (
          data.status === "running" ||
          data.status === "error" ||
          data.status === "stopped"
        ) {
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          setDeploying(false);
          fetchStatus();
          fetchUserData();

          // Trigger success/fail animations + sounds
          if (data.status === "running") {
            ArcadeSounds.koSound();
            setShowOnline(true);
            setTimeout(() => {
              setShowOnline(false);
              setShowReady(true);
              ArcadeSounds.deploySuccess();
            }, 1500);

            // Configure any channels collected during deploy flow
            configureSetupChannels(data.id);
          }
          if (data.status === "error") {
            ArcadeSounds.deployError();
          }
        }
      } catch {
        // ignore
      }
    },
    [fetchStatus, fetchUserData, configureSetupChannels]
  );

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Fetch user data when auth state resolves
  useEffect(() => {
    if (!authLoading) {
      fetchUserData();
    }
  }, [authLoading, fetchUserData]);

  // Fetch agents when user has a running instance
  useEffect(() => {
    if (userInstance?.status === "running") {
      fetchAgents(userInstance.id);
    } else {
      setAgents([]);
    }
  }, [userInstance, fetchAgents]);

  // Fetch channels when user has a running instance
  useEffect(() => {
    if (userInstance?.status === "running") {
      fetchChannels(userInstance.id);
    } else {
      setLiveChannels([]);
    }
  }, [userInstance, fetchChannels]);

  // Poll active instance
  useEffect(() => {
    if (!activeInstanceId || !deploying) return;

    pollingRef.current = setInterval(() => {
      fetchInstanceDetail(activeInstanceId);
    }, 1500);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeInstanceId, deploying, fetchInstanceDetail]);

  // ─── Deploy progress sound on new log lines ────────────────
  useEffect(() => {
    const logCount = activeInstance?.logs.length ?? 0;
    if (logCount > prevLogCountRef.current && prevLogCountRef.current > 0) {
      ArcadeSounds.deployProgress();
    }
    prevLogCountRef.current = logCount;
  }, [activeInstance?.logs.length]);

  // ─── Actions ──────────────────────────────────────────────────

  async function handleSignIn() {
    ArcadeSounds.signIn();
    setSigningIn(true);
    try {
      const url = await getSignInUrlAction();
      window.location.href = url;
    } catch {
      setSigningIn(false);
    }
  }

  async function handleSignOut() {
    ArcadeSounds.signOut();
    await signOutAction();
  }

  function handlePersonaSelect(persona: Persona) {
    ArcadeSounds.select();
    setSelectedPersona(persona);
    setPinnedPersona(null);
    setSelectedProvider("anthropic");
    setScreen("apikey");
    ArcadeSounds.screenTransition();
  }

  function handleStartFromScratch() {
    ArcadeSounds.select();
    setSelectedPersona(null);
    setPinnedPersona(null);
    setSelectedProvider("anthropic");
    setScreen("apikey");
    ArcadeSounds.screenTransition();
  }

  async function handleLaunch() {
    if (!apiKey.trim()) return;

    ArcadeSounds.deployStart();

    // Reset animation state
    setShowLaunchFlash(false);
    setShowOnline(false);
    setShowReady(false);

    setDeploying(true);
    setScreen("deploying");
    setActiveInstance(null);

    // Show launch flash
    setShowLaunchFlash(true);
    setTimeout(() => setShowLaunchFlash(false), 1200);

    try {
      const res = await fetch("/api/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: selectedProvider,
          apiKey: apiKey.trim(),
          ...(selectedPersona ? { persona: selectedPersona.id } : {}),
          ...(Object.keys(setupChannels).length > 0 ? { channels: setupChannels } : {}),
        }),
      });
      const data = await res.json();

      if (res.ok) {
        setActiveInstanceId(data.id);
        setActiveInstance({
          id: data.id,
          status: "starting",
          port: 0,
          token: "",
          dashboardUrl: null,
          createdAt: new Date().toISOString(),
          logs: ["Spinning up a fresh OpenClaw instance..."],
          provider: selectedProvider,
          modelId: PROVIDERS.find((p) => p.value === selectedProvider)?.model,
          persona: selectedPersona?.id,
        });
        setApiKey("");
      } else {
        setDeploying(false);
        setActiveInstance({
          id: "error",
          status: "error",
          port: 0,
          token: "",
          dashboardUrl: null,
          createdAt: "",
          logs: [`Error: ${data.error}`],
        });
      }
    } catch (err) {
      setDeploying(false);
      setActiveInstance({
        id: "error",
        status: "error",
        port: 0,
        token: "",
        dashboardUrl: null,
        createdAt: "",
        logs: [
          `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        ],
      });
    }
  }

  async function handleDestroy(id: string) {
    if (!confirm("Destroy this instance? It had a good run. You can deploy a new one right after.")) return;
    ArcadeSounds.destroy();
    try {
      await fetch(`/api/instances/${id}`, { method: "DELETE" });
      if (activeInstanceId === id) {
        setActiveInstanceId(null);
        setActiveInstance(null);
        setShowOnline(false);
        setShowReady(false);
      }
      setUserInstance(null);
      setAgents([]);
      setLiveChannels([]);
      setExpandedChannel(null);
      setShowAddAgentSelect(false);
      setAddAgentPinned(null);
      setScreen("start");
      fetchStatus();
      fetchUserData();
    } catch {
      // ignore
    }
  }

  function handleBackToStart() {
    ArcadeSounds.back();
    ArcadeSounds.screenTransition();
    setScreen("start");
    setSelectedPersona(null);
    setPinnedPersona(null);
    setApiKey("");
    setShowOnline(false);
    setShowReady(false);
  }

  // ─── Derived state ────────────────────────────────────────────

  const isLoading = authLoading || userDataLoading;
  const isAuthenticated = !!authUser;
  const hasInstance = !!userInstance && (userInstance.status === "running" || userInstance.status === "starting");

  // ─── Start Menu Actions ─────────────────────────────────────────

  const SNARKY_LINES = [
    "Your competitors say thanks.",
    "Brave. Wrong, but brave.",
    "Cool. Your competitors just deployed three.",
    "You'll be back. They always come back.",
    "That's the spirit. Of 2019.",
    "*The agents will remember this.*",
  ];

  const handleDeployOption = useCallback(() => {
    ArcadeSounds.select();
    ArcadeSounds.screenTransition();
    if (!isAuthenticated) {
      handleSignIn();
    } else {
      setScreen("select");
    }
  }, [isAuthenticated]);

  const handleStayIrrelevant = useCallback(() => {
    ArcadeSounds.back();
    setNopeShake(true);
    setTimeout(() => setNopeShake(false), 400);

    const line = SNARKY_LINES[Math.floor(Math.random() * SNARKY_LINES.length)];
    setSnarkyMessage(line);

    if (snarkyTimeoutRef.current) clearTimeout(snarkyTimeoutRef.current);
    snarkyTimeoutRef.current = setTimeout(() => {
      setSnarkyMessage(null);
      setStartMenuIndex(0);
      ArcadeSounds.cursorMove();
    }, 1800);
  }, []);

  const handleStartMenuSelect = useCallback(() => {
    if (startMenuIndex === 0) {
      handleDeployOption();
    } else {
      handleStayIrrelevant();
    }
  }, [startMenuIndex, handleDeployOption, handleStayIrrelevant]);

  // Keyboard navigation for start menu
  useEffect(() => {
    if (screen !== "start" || isLoading || hasInstance) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setStartMenuIndex(0);
        setSnarkyMessage(null);
        ArcadeSounds.cursorMove();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        setStartMenuIndex(1);
        setSnarkyMessage(null);
        ArcadeSounds.cursorMove();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleStartMenuSelect();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen, isLoading, hasInstance, handleStartMenuSelect]);

  // ─── Select screen: keyboard navigation (3x3 grid) ─────────────

  useEffect(() => {
    if (screen !== "select") return;

    function handleKeyDown(e: KeyboardEvent) {
      const cols = 3;
      const total = PERSONAS.length; // 9
      let newIndex = gridIndex;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          newIndex = gridIndex - cols >= 0 ? gridIndex - cols : gridIndex;
          break;
        case "ArrowDown":
          e.preventDefault();
          newIndex = gridIndex + cols < total ? gridIndex + cols : gridIndex;
          break;
        case "ArrowLeft":
          e.preventDefault();
          newIndex = gridIndex % cols > 0 ? gridIndex - 1 : gridIndex;
          break;
        case "ArrowRight":
          e.preventDefault();
          newIndex = (gridIndex % cols) < cols - 1 && gridIndex + 1 < total ? gridIndex + 1 : gridIndex;
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          handlePersonaSelect(PERSONAS[gridIndex]);
          return;
        case "Escape":
          e.preventDefault();
          handleBackToStart();
          return;
        default:
          return;
      }

      if (newIndex !== gridIndex) {
        setGridIndex(newIndex);
        setHoveredPersona(PERSONAS[newIndex]);
        setPinnedPersona(PERSONAS[newIndex]); // keyboard nav pins the focused cell
        playCursorMove();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [screen, gridIndex, playCursorMove]);

  // ─── Template Detail Modal State ────────────────────────────────
  const [templateModalPersona, setTemplateModalPersona] = useState<Persona | null>(null);

  const handleViewAllSkills = useCallback((persona: Persona) => {
    ArcadeSounds.select();
    setTemplateModalPersona(persona);
  }, []);


  const handleCloseTemplateModal = useCallback(() => {
    ArcadeSounds.back();
    setTemplateModalPersona(null);
  }, []);

  // ─── Shared Persona Select Screen ─────────────────────────────

  interface PersonaSelectConfig {
    title: string;
    subtitle: string;
    actionLabel: string;
    backLabel: string;
    scratchLabel: string;
    kbHint: string;
    hoveredPersona: Persona | null;
    activeGridIndex: number;
    isLoading: boolean;
    onCellClick: (persona: Persona, index: number) => void;
    onCellHover: (persona: Persona, index: number) => void;
    onCellLeave: () => void;
    onActionClick: (persona: Persona) => void;
    onBack: () => void;
    onScratch: () => void;
    showKeyboardNav: boolean;
    /** When set, the preview panel shows this persona regardless of hover state. */
    pinnedPersona?: Persona | null;
  }

  function renderPersonaSelect(config: PersonaSelectConfig) {
    const {
      title, subtitle, actionLabel, backLabel, scratchLabel, kbHint,
      hoveredPersona: hovered, activeGridIndex, isLoading: busy,
      onCellClick, onCellHover, onCellLeave, onActionClick,
      onBack, onScratch, showKeyboardNav,
      pinnedPersona: pinned,
    } = config;

    // Click-to-pin: pinned persona takes priority over hover/keyboard focus.
    // The preview panel stays locked to the pinned persona so the user can
    // safely move their mouse to the panel buttons without the preview swapping.
    const displayPersona = pinned ?? hovered ?? PERSONAS[activeGridIndex];
    const accentVar = displayPersona ? colorToCssVar(displayPersona.color) : "var(--arcade-yellow)";

    return (
      <div className="w-full max-w-5xl space-y-5 px-2 sm:px-0">
        {/* Screen Title */}
        <div className="text-center space-y-2">
          <h2 className="sf2-screen-title arcade-text">{title}</h2>
          <p className="pixel-font text-white/25 text-[6px] sm:text-[7px] tracking-wider">
            {subtitle}
          </p>
        </div>

        {/* Main Layout: Grid + Preview Panel */}
        <div className="sf2-select-layout">
          {/* 3x3 CHARACTER GRID */}
          <div className="sf2-grid-frame">
            <div className="grid grid-cols-3">
              {PERSONAS.map((persona, index) => {
                const isHovered = hovered?.id === persona.id;
                const isKbFocused = showKeyboardNav && activeGridIndex === index;
                const isActive = isHovered || isKbFocused;
                const isPinned = pinned?.id === persona.id;
                const cellColor = colorToCssVar(persona.color);
                return (
                  <PersonaGridCell
                    key={persona.id}
                    persona={persona}
                    index={index}
                    isActive={isActive}
                    isHovered={isHovered}
                    isPinned={isPinned}
                    cellColor={cellColor}
                    disabled={busy}
                    onClick={onCellClick}
                    onHover={onCellHover}
                    onLeave={onCellLeave}
                  />
                );
              })}
            </div>
          </div>

          {/* PREVIEW PANEL */}
          <PersonaPreviewPanel
            displayPersona={busy ? null : displayPersona}
            accentVar={accentVar}
            busy={busy}
            actionLabel={actionLabel}
            onActionClick={onActionClick}
            onViewAllSkills={handleViewAllSkills}
          />
        </div>

        {/* Bottom Actions + Hints */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 max-w-5xl mx-auto mt-2">
          <div className="flex gap-6">
            <button
              onClick={onBack}
              onMouseEnter={() => ArcadeSounds.buttonHover()}
              disabled={busy}
              className="arcade-btn text-arcade-pink"
              style={{ borderColor: "var(--arcade-pink)" }}
            >
              {backLabel}
            </button>
            <button
              onClick={onScratch}
              onMouseEnter={() => ArcadeSounds.buttonHover()}
              disabled={busy}
              className="arcade-btn text-white/50 hover:text-white/70"
              style={{ borderColor: "rgba(255,255,255,0.2)" }}
              title={scratchLabel === "SKIP TEMPLATE" ? "Deploy a blank OpenClaw instance with no pre-loaded agents" : "Add a blank agent with no pre-loaded skills"}
            >
              {scratchLabel}
            </button>
          </div>
          <p className="sf2-kb-hint hidden sm:block">{kbHint}</p>
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* ═══════ TOP-RIGHT UTILITY LINKS ═══════ */}
      <a
        href="https://discord.gg/YV9pGMpFQJ"
        target="_blank"
        rel="noopener noreferrer"
        className="discord-link"
        title="Join our Discord"
        aria-label="Join our Discord"
      >
        <svg
          width="18"
          height="14"
          viewBox="0 0 127.14 96.36"
          fill="currentColor"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
        </svg>
      </a>
      <button
        onClick={handleToggleMute}
        className="sound-mute-btn"
        title={soundMuted ? "Unmute sounds" : "Mute sounds"}
        aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"}
      >
        <span className="sound-mute-icon">{soundMuted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}</span>
      </button>

      {/* ═══════ TOP BAR (when logged in with real auth) ═══════ */}
      {isAuthenticated && authUser.email && (
        <header className="border-b border-white/10 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              {authUser.profilePictureUrl && (
                <img
                  src={authUser.profilePictureUrl}
                  alt=""
                  className="w-6 h-6 rounded-full border border-white/20"
                />
              )}
              {authUser.email && (
                <span className="pixel-font text-[7px] sm:text-[8px] text-white/50 tracking-wider">
                  {authUser.email}
                </span>
              )}
            </div>
            <button
              onClick={handleSignOut}
              onMouseEnter={() => ArcadeSounds.buttonHover()}
              className="pixel-font text-[7px] text-white/30 hover:text-white/60 border border-white/15 px-3 py-1.5 transition-all cursor-pointer"
            >
              SIGN OUT
            </button>
          </div>
        </header>
      )}

      {/* ═══════ MAIN CONTENT ═══════ */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">

        {/* ─── LOADING STATE ─── */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-6 text-center">
            <div className="space-y-4">
              <h1 className="pixel-font text-arcade-green arcade-text text-3xl sm:text-5xl md:text-6xl leading-tight">
                CLAWGENT
              </h1>
              <p className="pixel-font text-arcade-yellow text-[10px] sm:text-xs tracking-widest">
                WARMING UP THE MACHINES...
              </p>
            </div>
            <div className="w-8 h-8 border-2 border-arcade-green border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {/* ─── SCREEN 1: START ─── */}
        {!isLoading && screen === "start" && (
          <div className="flex flex-col items-center justify-center gap-8 text-center">
            {/* Title */}
            <div className="space-y-4">
              <h1
                className="pixel-font text-arcade-green arcade-text text-3xl sm:text-5xl md:text-6xl leading-tight"
              >
                CLAWGENT
              </h1>

              {/* Nex.ai Logo — directly under title */}
              <a
                href="https://nex.ai?utm_source=clawgent.ai&utm_medium=referral"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 opacity-40 hover:opacity-60 transition-opacity"
                aria-label="Built by Nex.ai"
              >
                <span className="pixel-font text-[7px] text-white tracking-wider">by</span>
                <svg width="90" height="21" viewBox="0 0 95 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11.4968 9.1124C10.2339 7.84948 9.98851 5.898 9.48601 4.18411C9.26753 3.43896 8.86469 2.73685 8.27738 2.14953C6.40286 0.275011 3.35898 0.279701 1.47868 2.16C-0.401626 4.0403 -0.406316 7.08419 1.4682 8.9587C2.05551 9.54601 2.75761 9.94885 3.50275 10.1673C5.21664 10.6698 7.16813 10.9152 8.43106 12.1782C9.69399 13.4411 9.93939 15.3926 10.4419 17.1065C10.6604 17.8516 11.0632 18.5537 11.6505 19.141C13.525 21.0155 16.5689 21.0109 18.4492 19.1306C20.3295 17.2503 20.3342 14.2064 18.4597 12.3319C17.8724 11.7445 17.1703 11.3417 16.4251 11.1232C14.7112 10.6207 12.7597 10.3753 11.4968 9.1124Z" fill="white"/>
                  <path d="M7.25926 17.0471C7.25926 19.0517 5.63422 20.6768 3.62963 20.6768C1.62504 20.6768 0 19.0517 0 17.0471C0 15.0425 1.62504 13.4175 3.62963 13.4175C5.63422 13.4175 7.25926 15.0425 7.25926 17.0471Z" fill="white"/>
                  <path d="M20 4.30639C20 6.31098 18.375 7.93602 16.3704 7.93602C14.3658 7.93602 12.7407 6.31098 12.7407 4.30639C12.7407 2.3018 14.3658 0.676758 16.3704 0.676758C18.375 0.676758 20 2.3018 20 4.30639Z" fill="white"/>
                  <path d="M29.5211 7.15435V20.5967H26.25V1.92676H29.7915L37.4421 14.9957V1.92676H40.7132V20.5967H37.415L29.5211 7.15435Z" fill="white"/>
                  <path d="M55.8786 14.5423H45.5787C45.9572 16.356 47.444 17.6896 49.2012 17.6896C50.5259 17.6896 51.6884 16.9428 52.3372 15.7959H55.6083C54.7432 18.6231 52.202 20.6768 49.2012 20.6768C45.4705 20.6768 42.4698 17.5029 42.4698 13.6088C42.4698 9.71481 45.4705 6.54091 49.2012 6.54091C52.202 6.54091 54.7432 8.59461 55.6083 11.4218C55.8246 12.1152 55.9327 12.8354 55.9327 13.6088C55.9327 13.9289 55.9327 14.2223 55.8786 14.5423ZM46.0653 11.4218H52.3372C51.6884 10.2749 50.5259 9.52811 49.2012 9.52811C47.8766 9.52811 46.7141 10.2749 46.0653 11.4218Z" fill="white"/>
                  <path d="M68.75 6.32754L63.965 13.4755L68.75 20.5967H64.9652L62.0726 16.276L59.1529 20.5967H55.3952L60.1802 13.4755L55.3952 6.32754H59.1529L62.0726 10.6483L64.9652 6.32754H68.75Z" fill="white"/>
                  <circle cx="72" cy="18.6768" r="2" fill="white"/>
                  <path d="M94.3129 3.422C93.9263 3.80867 93.4623 4.002 92.9209 4.002C92.3796 4.002 91.9059 3.80867 91.4999 3.422C91.1133 3.016 90.9199 2.54233 90.9199 2.001C90.9199 1.45967 91.1133 0.995667 91.4999 0.609001C91.8866 0.203 92.3603 0 92.9209 0C93.4816 0 93.9553 0.203 94.3419 0.609001C94.7286 0.995667 94.9219 1.45967 94.9219 2.001C94.9219 2.54233 94.7189 3.016 94.3129 3.422ZM91.3549 20.677V6.177H94.4869V20.677H91.3549Z" fill="white"/>
                  <path d="M85.5131 6.17681H88.7697V20.6768H85.5131V18.5888C84.4699 20.2321 82.9736 21.0538 81.024 21.0538C79.2626 21.0538 77.7577 20.3191 76.5093 18.8498C75.2609 17.3611 74.6367 15.5535 74.6367 13.4268C74.6367 11.2808 75.2609 9.47314 76.5093 8.0038C77.7577 6.53447 79.2626 5.7998 81.024 5.7998C82.9736 5.7998 84.4699 6.6118 85.5131 8.2358V6.17681ZM78.5614 16.7618C79.331 17.6318 80.2972 18.0668 81.4601 18.0668C82.623 18.0668 83.5892 17.6318 84.3587 16.7618C85.1283 15.8725 85.5131 14.7608 85.5131 13.4268C85.5131 12.0928 85.1283 10.9908 84.3587 10.1208C83.5892 9.23147 82.623 8.7868 81.4601 8.7868C80.2972 8.7868 79.331 9.23147 78.5614 10.1208C77.7919 10.9908 77.4071 12.0928 77.4071 13.4268C77.4071 14.7608 77.7919 15.8725 78.5614 16.7618Z" fill="white"/>
                </svg>
              </a>

              <p className="pixel-font text-arcade-yellow text-[10px] sm:text-xs tracking-widest mx-auto leading-relaxed">
                DEPLOY OPENCLAW UNDER A MINUTE.<br />GET IT GOING ON DAY-1 WITH PRE-BUILT AGENTS
              </p>
              <p className="pixel-font text-white/25 text-[7px] tracking-wider max-w-xs mx-auto">
                PRE-LOADED AGENT TEMPLATES. REAL SKILLS. ONE CLICK.
              </p>
            </div>

            {/* ─── SNES-STYLE START MENU (unauthenticated or no instance) ─── */}
            {(!isAuthenticated || !hasInstance) && !showAddAgentSelect && (
              <div className="w-full max-w-md space-y-3">
                {/* Option 1: Deploy */}
                <button
                  onClick={() => { setStartMenuIndex(0); handleDeployOption(); }}
                  onMouseEnter={() => { setStartMenuIndex(0); setSnarkyMessage(null); ArcadeSounds.cursorMove(); }}
                  className={`start-menu-option ${nopeShake && startMenuIndex === 0 ? "nope-shake" : ""}`}
                  data-active={startMenuIndex === 0}
                  disabled={signingIn}
                >
                  {startMenuIndex === 0 ? (
                    <span className="start-menu-arrow" aria-hidden="true">{"\u25B6"}</span>
                  ) : (
                    <span className="start-menu-arrow-spacer" aria-hidden="true" />
                  )}
                  <span className="pixel-font text-[10px] sm:text-xs tracking-wider">
                    {signingIn ? "HOLD TIGHT..." : "DEPLOY OPENCLAW IN A MIN"}
                  </span>
                </button>

                {/* Option 2: Stay Irrelevant */}
                <button
                  onClick={() => { setStartMenuIndex(1); handleStayIrrelevant(); }}
                  onMouseEnter={() => { setStartMenuIndex(1); setSnarkyMessage(null); ArcadeSounds.cursorMove(); }}
                  className={`start-menu-option ${nopeShake && startMenuIndex === 1 ? "nope-shake" : ""}`}
                  data-active={startMenuIndex === 1}
                  data-variant="danger"
                >
                  {startMenuIndex === 1 ? (
                    <span className="start-menu-arrow" aria-hidden="true">{"\u25B6"}</span>
                  ) : (
                    <span className="start-menu-arrow-spacer" aria-hidden="true" />
                  )}
                  <span className="pixel-font text-[10px] sm:text-xs tracking-wider">
                    STAY IRRELEVANT
                  </span>
                </button>

                {/* Snarky message area */}
                <div className="h-10 flex items-center justify-center">
                  {snarkyMessage ? (
                    <p className="pixel-font text-arcade-pink text-[8px] sm:text-[9px] tracking-wider snarky-message">
                      {snarkyMessage}
                    </p>
                  ) : (
                    <p className="pixel-font text-white/15 text-[7px] tracking-wider">
                      USE ARROW KEYS + ENTER, OR CLICK
                    </p>
                  )}
                </div>

                {systemStatus && !systemStatus.dockerAvailable && (
                  <p className="pixel-font text-arcade-red text-[8px]">
                    DOCKER IS TAKING A PERSONAL DAY
                  </p>
                )}
              </div>
            )}

            {/* AUTH GATE: Logged in + has running instance */}
            {isAuthenticated && hasInstance && !showAddAgentSelect && (
              <div className="w-full max-w-2xl space-y-6">
                {/* Instance Header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div className="flex items-center gap-3">
                    <span className="pixel-font text-arcade-yellow text-xs sm:text-sm arcade-text">
                      YOUR OPENCLAW INSTANCE
                    </span>
                    <span className={`pixel-font text-[7px] px-2 py-0.5 border ${
                      userInstance?.status === "running"
                        ? "text-arcade-green border-arcade-green/40 bg-arcade-green/10"
                        : "text-arcade-yellow border-arcade-yellow/40 bg-arcade-yellow/10"
                    }`}>
                      {userInstance?.status === "running" ? "ONLINE" : "STARTING"}
                    </span>
                  </div>
                  {userInstance?.provider && (
                    <span className="pixel-font text-[7px] text-white/30">
                      {PROVIDERS.find((p) => p.value === userInstance.provider)?.shortLabel ?? userInstance.provider}
                    </span>
                  )}
                </div>

                {/* Agents Roster */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="pixel-font text-[8px] text-white/40 tracking-wider">
                      AGENTS ON THIS INSTANCE
                      {!agentsLoading && agents.length > 0 && (
                        <span className="text-white/20 ml-2">({agents.length})</span>
                      )}
                    </p>
                  </div>

                  {agentsLoading && (
                    <div className="flex items-center gap-3 py-6 justify-center">
                      <div className="w-5 h-5 border-2 border-arcade-blue border-t-transparent rounded-full animate-spin" />
                      <span className="pixel-font text-[8px] text-white/30">LOADING AGENTS...</span>
                    </div>
                  )}

                  {!agentsLoading && agents.length === 0 && (
                    <div className="arcade-panel p-6 text-center space-y-2">
                      <p className="pixel-font text-white/40 text-[9px]">
                        NO AGENTS YET
                      </p>
                      <p className="pixel-font text-white/20 text-[7px]">
                        ADD YOUR FIRST AGENT TO GET STARTED
                      </p>
                    </div>
                  )}

                  {!agentsLoading && agents.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {agents.map((agent) => {
                        const agentPersona = PERSONAS.find((p) => p.id === agent.persona);
                        const accentColor = agentPersona?.color ?? "arcade-blue";
                        return (
                          <div
                            key={agent.agentId}
                            className="agent-card group"
                            style={{
                              borderColor: colorToCssVar(accentColor),
                            }}
                          >
                            <div className="flex items-start gap-3 p-3">
                              {agentPersona?.sprite ? (
                                <img
                                  src={agentPersona.sprite}
                                  alt={agent.name}
                                  className="w-10 h-10 object-cover rounded shrink-0"
                                />
                              ) : (
                                <span className="text-2xl sm:text-3xl shrink-0">{agent.emoji}</span>
                              )}
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`pixel-font text-[8px] sm:text-[9px] ${colorToTw(accentColor, "text")}`}
                                >
                                  {agent.name}
                                </p>
                              </div>
                              {/* Action buttons */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <a
                                  href={agent.deepLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onMouseEnter={() => ArcadeSounds.buttonHover()}
                                  onClick={() => ArcadeSounds.buttonClick()}
                                  className="agent-card-open-btn pixel-font text-[7px] px-2.5 py-1.5 transition-all"
                                  style={{
                                    color: colorToCssVar(accentColor),
                                    borderColor: colorToCssVar(accentColor),
                                  }}
                                >
                                  OPEN
                                </a>
                                {/* Only show remove for non-main agents */}
                                {agent.agentId !== "main" && (
                                  <button
                                    onClick={() => removeAgent(userInstance!.id, agent.agentId)}
                                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                                    className="agent-card-remove-btn pixel-font text-[8px] text-white/20 hover:text-arcade-red px-1 py-1 transition-all cursor-pointer"
                                    title="Remove agent"
                                  >
                                    X
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Add Agent Button */}
                <button
                  onClick={() => {
                    ArcadeSounds.signIn();
                    ArcadeSounds.screenTransition();
                    setShowAddAgentSelect(true);
                    setAddAgentHovered(null);
                  }}
                  onMouseEnter={() => ArcadeSounds.buttonHover()}
                  disabled={addingAgent || userInstance?.status !== "running"}
                  className="add-agent-btn w-full pixel-font text-[10px] sm:text-xs py-4 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  {addingAgent ? "CONFIGURING AGENT..." : "ADD AGENT"}
                </button>

                {/* Power Ups Section */}
                {SHOW_INTEGRATIONS && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="pixel-font text-[8px] text-white/40 tracking-wider">
                      POWER UPS
                    </p>
                    {channelsLoading && (
                      <div className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>

                  {/* Success/Error feedback */}
                  {channelSuccess && (
                    <div className="arcade-panel px-3 py-2 border-arcade-green/40 bg-arcade-green/10 text-center">
                      <p className="pixel-font text-[7px] text-arcade-green tracking-wider">{channelSuccess}</p>
                    </div>
                  )}
                  {channelError && (
                    <div className="arcade-panel px-3 py-2 border-arcade-red/40 bg-arcade-red/10 text-center">
                      <p className="pixel-font text-[7px] text-arcade-red tracking-wider">{channelError}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {([
                      { key: "slack" as const, label: "SLACK", icon: "#", color: "var(--arcade-green)", iconTextColor: "#000" },
                      { key: "telegram" as const, label: "TELEGRAM", icon: "\u2708", color: "var(--arcade-blue)", iconTextColor: "#000" },
                      { key: "discord" as const, label: "DISCORD", icon: "\uD83C\uDFAE", color: "var(--arcade-purple)", iconTextColor: "#fff" },
                    ]).map((ch) => {
                      const liveInfo = liveChannels.find((c) => c.type === ch.key);
                      const isConnected = liveInfo?.enabled ?? false;
                      const isExpanded = expandedChannel === ch.key;
                      const isActionLoading = channelActionLoading === ch.key;

                      return (
                        <div key={ch.key} className="arcade-panel" style={isConnected ? { borderColor: ch.color } : undefined}>
                          {/* Channel row header */}
                          <button
                            onClick={() => {
                              ArcadeSounds.buttonClick();
                              setExpandedChannel(isExpanded ? null : ch.key);
                              setChannelError(null);
                            }}
                            className="flex items-center gap-2 px-3 py-2.5 w-full cursor-pointer"
                          >
                            <span
                              className="flex items-center justify-center w-5 h-5 text-[8px] font-bold pixel-font shrink-0"
                              style={{ background: ch.color, color: ch.iconTextColor }}
                            >
                              {ch.icon}
                            </span>
                            <span className="pixel-font text-[7px] text-white/60">{ch.label}</span>
                            {isActionLoading ? (
                              <span className="ml-auto w-3 h-3 border border-white/40 border-t-transparent rounded-full animate-spin shrink-0" />
                            ) : (
                              <span
                                className="ml-auto w-2 h-2 shrink-0"
                                style={{ background: isConnected ? ch.color : "rgba(255,255,255,0.15)" }}
                              />
                            )}
                            {isConnected && (
                              <span className="pixel-font text-[6px] tracking-wider shrink-0" style={{ color: ch.color }}>
                                {liveInfo?.status === "error" ? "ERROR" : "ON"}
                              </span>
                            )}
                          </button>

                          {/* Expanded panel */}
                          {isExpanded && (
                            <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
                              {isConnected ? (
                                <>
                                  <p className="pixel-font text-[6px] text-white/30 tracking-wider">
                                    {liveInfo?.status === "error"
                                      ? `ERROR: ${liveInfo.error ?? "UNKNOWN"}`
                                      : "CHANNEL CONNECTED AND ACTIVE"}
                                  </p>
                                  <button
                                    onClick={() => {
                                      ArcadeSounds.buttonClick();
                                      disconnectChannel(userInstance!.id, ch.key);
                                    }}
                                    disabled={isActionLoading}
                                    className="pixel-font text-[7px] text-arcade-red border border-arcade-red/40 px-3 py-1.5 hover:bg-arcade-red/10 transition-all cursor-pointer disabled:opacity-40"
                                  >
                                    {isActionLoading ? "DISCONNECTING..." : "DISCONNECT"}
                                  </button>
                                </>
                              ) : (
                                <>
                                  {/* Credential inputs */}
                                  {ch.key === "slack" && (
                                    <div className="space-y-2">
                                      <a
                                        href="https://docs.openclaw.ai/channels/slack"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="pixel-font text-[7px] text-white/30 hover:text-white/60 transition-colors inline-block mb-1"
                                      >
                                        Setup guide →
                                      </a>
                                      <div>
                                        <label className="pixel-font text-[6px] text-white/30 tracking-wider">APP TOKEN</label>
                                        <input
                                          type="password"
                                          value={channelInputs.slack.appToken}
                                          onChange={(e) =>
                                            setChannelInputs((prev) => ({
                                              ...prev,
                                              slack: { ...prev.slack, appToken: e.target.value },
                                            }))
                                          }
                                          placeholder="xapp-..."
                                          className="arcade-input w-full py-1.5 px-2 text-xs"
                                        />
                                      </div>
                                      <div>
                                        <label className="pixel-font text-[6px] text-white/30 tracking-wider">BOT TOKEN</label>
                                        <input
                                          type="password"
                                          value={channelInputs.slack.botToken}
                                          onChange={(e) =>
                                            setChannelInputs((prev) => ({
                                              ...prev,
                                              slack: { ...prev.slack, botToken: e.target.value },
                                            }))
                                          }
                                          placeholder="xoxb-..."
                                          className="arcade-input w-full py-1.5 px-2 text-xs"
                                        />
                                      </div>
                                      <div>
                                        <label className="pixel-font text-[6px] text-white/30 tracking-wider">USER TOKEN (OPTIONAL)</label>
                                        <input
                                          type="password"
                                          value={channelInputs.slack.userToken ?? ""}
                                          onChange={(e) =>
                                            setChannelInputs((prev) => ({
                                              ...prev,
                                              slack: { ...prev.slack, userToken: e.target.value },
                                            }))
                                          }
                                          placeholder="xoxp-..."
                                          className="arcade-input w-full py-1.5 px-2 text-xs"
                                        />
                                      </div>
                                      <button
                                        onClick={() => {
                                          ArcadeSounds.buttonClick();
                                          connectChannel(userInstance!.id, "slack", channelInputs.slack);
                                        }}
                                        disabled={isActionLoading || !channelInputs.slack.appToken.trim() || !channelInputs.slack.botToken.trim()}
                                        className="pixel-font text-[7px] px-3 py-1.5 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                        style={{
                                          color: ch.color,
                                          borderWidth: "1px",
                                          borderStyle: "solid",
                                          borderColor: ch.color,
                                        }}
                                      >
                                        {isActionLoading ? "CONNECTING..." : "CONNECT SLACK"}
                                      </button>
                                    </div>
                                  )}

                                  {ch.key === "telegram" && (
                                    <div className="space-y-2">
                                      <a
                                        href="https://docs.openclaw.ai/channels/telegram"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="pixel-font text-[7px] text-white/30 hover:text-white/60 transition-colors inline-block mb-1"
                                      >
                                        Setup guide →
                                      </a>
                                      <div>
                                        <label className="pixel-font text-[6px] text-white/30 tracking-wider">BOT TOKEN</label>
                                        <input
                                          type="password"
                                          value={channelInputs.telegram.botToken}
                                          onChange={(e) =>
                                            setChannelInputs((prev) => ({
                                              ...prev,
                                              telegram: { botToken: e.target.value },
                                            }))
                                          }
                                          placeholder="123456:ABC-..."
                                          className="arcade-input w-full py-1.5 px-2 text-xs"
                                        />
                                      </div>
                                      <button
                                        onClick={() => {
                                          ArcadeSounds.buttonClick();
                                          connectChannel(userInstance!.id, "telegram", channelInputs.telegram);
                                        }}
                                        disabled={isActionLoading || !channelInputs.telegram.botToken.trim()}
                                        className="pixel-font text-[7px] px-3 py-1.5 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                        style={{
                                          color: ch.color,
                                          borderWidth: "1px",
                                          borderStyle: "solid",
                                          borderColor: ch.color,
                                        }}
                                      >
                                        {isActionLoading ? "CONNECTING..." : "CONNECT TELEGRAM"}
                                      </button>
                                    </div>
                                  )}

                                  {ch.key === "discord" && (
                                    <div className="space-y-2">
                                      <a
                                        href="https://docs.openclaw.ai/channels/discord"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="pixel-font text-[7px] text-white/30 hover:text-white/60 transition-colors inline-block mb-1"
                                      >
                                        Setup guide →
                                      </a>
                                      <div>
                                        <label className="pixel-font text-[6px] text-white/30 tracking-wider">BOT TOKEN</label>
                                        <input
                                          type="password"
                                          value={channelInputs.discord.token}
                                          onChange={(e) =>
                                            setChannelInputs((prev) => ({
                                              ...prev,
                                              discord: { token: e.target.value },
                                            }))
                                          }
                                          placeholder="MTk2..."
                                          className="arcade-input w-full py-1.5 px-2 text-xs"
                                        />
                                      </div>
                                      <button
                                        onClick={() => {
                                          ArcadeSounds.buttonClick();
                                          connectChannel(userInstance!.id, "discord", channelInputs.discord);
                                        }}
                                        disabled={isActionLoading || !channelInputs.discord.token.trim()}
                                        className="pixel-font text-[7px] px-3 py-1.5 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                        style={{
                                          color: ch.color,
                                          borderWidth: "1px",
                                          borderStyle: "solid",
                                          borderColor: ch.color,
                                        }}
                                      >
                                        {isActionLoading ? "CONNECTING..." : "CONNECT DISCORD"}
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                )}

                {/* Instance Actions */}
                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  {userInstance?.dashboardUrl && (
                    <a
                      href={userInstance.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onMouseEnter={() => ArcadeSounds.buttonHover()}
                      onClick={() => ArcadeSounds.buttonClick()}
                      className="pixel-font text-[9px] text-arcade-green border border-arcade-green/40 px-4 py-2 hover:bg-arcade-green/10 hover:border-arcade-green transition-all cursor-pointer"
                    >
                      OPEN DASHBOARD
                    </a>
                  )}
                  <button
                    onClick={() => handleDestroy(userInstance!.id)}
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    className="pixel-font text-[9px] text-arcade-red border border-arcade-red/40 px-4 py-2 hover:bg-arcade-red/10 hover:border-arcade-red transition-all cursor-pointer"
                  >
                    DESTROY INSTANCE
                  </button>
                </div>
              </div>
            )}

            {/* ADD AGENT: Persona Selection (sub-screen within start view) */}
            {isAuthenticated && hasInstance && showAddAgentSelect && (
              renderPersonaSelect({
                title: "ADD AGENT TO INSTANCE",
                subtitle: "PICK A TEMPLATE. THE AGENT WILL USE YOUR INSTANCE'S EXISTING API KEY.",
                actionLabel: "ADD THIS AGENT",
                backLabel: "BACK",
                scratchLabel: "START FROM SCRATCH",
                kbHint: "CLICK TO PREVIEW / CLICK AGAIN TO ADD",
                hoveredPersona: addAgentHovered,
                activeGridIndex: 0,
                isLoading: addingAgent,
                onCellClick: (persona) => {
                  // Click-to-pin: if clicking a different persona, pin it.
                  // If clicking the already-pinned persona, trigger the action.
                  if (addAgentPinned?.id === persona.id) {
                    ArcadeSounds.select();
                    addAgentToInstance(userInstance!.id, persona.id);
                  } else {
                    ArcadeSounds.select();
                    setAddAgentPinned(persona);
                  }
                },
                onCellHover: (persona) => {
                  playCursorMove();
                  setAddAgentHovered(persona);
                },
                onCellLeave: () => setAddAgentHovered(null),
                onActionClick: (persona) => {
                  ArcadeSounds.select();
                  addAgentToInstance(userInstance!.id, persona.id);
                },
                onBack: () => {
                  ArcadeSounds.back();
                  ArcadeSounds.screenTransition();
                  setShowAddAgentSelect(false);
                  setAddAgentHovered(null);
                  setAddAgentPinned(null);
                },
                onScratch: () => {
                  ArcadeSounds.select();
                  addAgentToInstance(userInstance!.id, null);
                },
                showKeyboardNav: false,
                pinnedPersona: addAgentPinned,
              })
            )}


            {/* Agent count */}
            {systemStatus && systemStatus.runningInstances > 0 && (
              <p className="pixel-font text-arcade-green text-[9px] tracking-wide">
                {systemStatus.runningInstances} INSTANCE
                {systemStatus.runningInstances !== 1 ? "S" : ""} CURRENTLY
                RUNNING
              </p>
            )}
          </div>
        )}

        {/* ─── SCREEN 2: CHARACTER SELECT ─── */}
        {!isLoading && screen === "select" && (
          renderPersonaSelect({
            title: "CHOOSE YOUR AGENT",
            subtitle: "EACH TEMPLATE PRE-LOADS SKILLS INTO YOUR OPENCLAW INSTANCE",
            actionLabel: "DEPLOY WITH THIS AGENT",
            backLabel: "BACK",
            scratchLabel: "SKIP TEMPLATE",
            kbHint: "ARROW KEYS TO NAVIGATE / ENTER TO SELECT / ESC TO GO BACK",
            hoveredPersona,
            activeGridIndex: gridIndex,
            isLoading: false,
            onCellClick: (persona) => {
              // Click-to-pin: if clicking a different persona, pin it.
              // If clicking the already-pinned persona, trigger the action.
              if (pinnedPersona?.id === persona.id) {
                handlePersonaSelect(persona);
              } else {
                ArcadeSounds.select();
                setPinnedPersona(persona);
              }
            },
            onCellHover: (persona, index) => {
              playCursorMove();
              setHoveredPersona(persona);
              setGridIndex(index);
            },
            onCellLeave: () => setHoveredPersona(null),
            onActionClick: (persona) => handlePersonaSelect(persona),
            onBack: handleBackToStart,
            onScratch: handleStartFromScratch,
            showKeyboardNav: true,
            pinnedPersona,
          })
        )}

        {/* ─── SCREEN 3: API KEY ENTRY ─── */}
        {!isLoading && screen === "apikey" && (
          <div className="w-full max-w-md space-y-8">
            {/* Header */}
            <h2 className="pixel-font text-arcade-blue arcade-text text-center text-sm sm:text-base">
              PLUG IN THE BRAIN
            </h2>
            <p className="pixel-font text-white/25 text-[7px] text-center tracking-wider -mt-6">
              THIS KEY POWERS ALL AGENTS ON YOUR INSTANCE. STAYS LOCAL. PINKY PROMISE.
            </p>

            {/* Selected Persona or Blank */}
            {selectedPersona ? (
              <div className="flex flex-col items-center gap-2">
                {selectedPersona.sprite ? (
                  <img
                    src={selectedPersona.sprite}
                    alt={selectedPersona.name}
                    className="w-16 h-16 object-contain"
                    style={{ filter: `drop-shadow(0 0 6px ${colorToCssVar(selectedPersona.color)})` }}
                    draggable={false}
                  />
                ) : (
                  <span className="text-5xl">{selectedPersona.icon}</span>
                )}
                <span
                  className={`pixel-font text-[10px] ${colorToTw(selectedPersona.color, "text")}`}
                >
                  {selectedPersona.name}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span className="text-5xl">{"\uD83E\uDD16"}</span>
                <span className="pixel-font text-[10px] text-white/50">
                  BLANK SLATE
                </span>
                <span className="pixel-font text-[7px] text-white/20">
                  NO PRE-LOADED AGENTS. BLANK INSTANCE. FULL FREEDOM.
                </span>
              </div>
            )}

            {/* Provider Selector */}
            <div className="grid grid-cols-3 gap-2">
              {PROVIDERS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setSelectedProvider(p.value)}
                  className={`
                    pixel-font text-[8px] sm:text-[9px] py-3 px-2 cursor-pointer
                    ${
                      selectedProvider === p.value
                        ? "bg-arcade-green text-black border-2 border-arcade-green"
                        : "arcade-panel text-white/60 hover:text-white/80"
                    }
                  `}
                >
                  {p.shortLabel}
                </button>
              ))}
            </div>

            <>
              {/* API Key Input */}
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && apiKey.trim()) {
                      if (SHOW_INTEGRATIONS) {
                        ArcadeSounds.select();
                        ArcadeSounds.screenTransition();
                        setScreen("powerups");
                      } else {
                        handleLaunch();
                      }
                    }
                  }}
                  placeholder="sk-... (YOU KNOW THE DRILL)"
                  className="arcade-input w-full py-3 px-4 text-sm"
                  autoFocus
                />

                {/* API key help link */}
                {(() => {
                  const provider = PROVIDERS.find(
                    (p) => p.value === selectedProvider
                  );
                  return provider?.keyUrl ? (
                    <a
                      href={provider.keyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pixel-font text-[7px] text-white/30 hover:text-arcade-green transition-colors tracking-wider"
                    >
                      GET YOUR {provider.shortLabel} API KEY &rarr;
                    </a>
                  ) : null;
                })()}

                {/* Actions */}
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      if (!apiKey.trim()) return;
                      if (SHOW_INTEGRATIONS) {
                        ArcadeSounds.select();
                        ArcadeSounds.screenTransition();
                        setScreen("powerups");
                      } else {
                        handleLaunch();
                      }
                    }}
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    disabled={!apiKey.trim()}
                    className={`
                      flex-1 pixel-font text-[10px] sm:text-xs py-4 transition-all duration-200 cursor-pointer
                      ${
                        apiKey.trim()
                          ? "bg-arcade-green text-black border-2 border-arcade-green hover:shadow-[0_0_16px_var(--arcade-green)] hover:scale-[1.02] active:scale-95"
                          : "arcade-panel text-white/30 cursor-not-allowed"
                      }
                    `}
                  >
                    {SHOW_INTEGRATIONS ? "NEXT" : "DEPLOY"}
                  </button>
                  <button
                    onClick={() => {
                      ArcadeSounds.back();
                      ArcadeSounds.screenTransition();
                      setScreen("select");
                      setApiKey("");
                    }}
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    className="arcade-btn text-arcade-pink px-6"
                    style={{ borderColor: "var(--arcade-pink)" }}
                  >
                    BACK
                  </button>
                </div>
              </>
          </div>
        )}

        {/* ─── SCREEN 3.5: POWER-UPS ─── */}
        {SHOW_INTEGRATIONS && !isLoading && screen === "powerups" && (
          <div className="w-full max-w-2xl space-y-8">
            {/* Header */}
            <div className="text-center space-y-2">
              <h2 className="pixel-font text-arcade-yellow arcade-text text-sm sm:text-base">
                POWER UPS
              </h2>
              <p className="pixel-font text-white/25 text-[7px] tracking-wider">
                CONNECT YOUR AGENTS TO THE WORLD. OR DON&apos;T. THEY&apos;LL STILL WORK.
              </p>
            </div>

            {/* Channel Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Slack */}
              <div
                className="powerup-card"
                data-enabled={!!setupChannels.slack}
                style={{ "--powerup-color": "var(--arcade-green)" } as React.CSSProperties}
              >
                <div className="powerup-card-header">
                  <span className="powerup-card-icon" style={{ background: "var(--arcade-green)", color: "#000" }}>
                    #
                  </span>
                  <span className="pixel-font text-[9px] text-white/80">SLACK</span>
                  <button
                    onClick={() => {
                      ArcadeSounds.buttonClick();
                      setSetupChannels((prev) =>
                        prev.slack
                          ? (() => { const { slack: _slack, ...rest } = prev; return rest; })()
                          : { ...prev, slack: { appToken: "", botToken: "", userToken: "" } }
                      );
                    }}
                    className={`powerup-toggle ${setupChannels.slack ? "powerup-toggle-on" : ""}`}
                    aria-label={setupChannels.slack ? "Disconnect Slack" : "Connect Slack"}
                  >
                    <span className="powerup-toggle-knob" />
                  </button>
                </div>
                {setupChannels.slack && (
                  <div className="powerup-card-body space-y-2">
                    <a
                      href="https://docs.openclaw.ai/channels/slack"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pixel-font text-[7px] text-white/30 hover:text-white/60 transition-colors inline-block mb-1"
                    >
                      Setup guide →
                    </a>
                    <div>
                      <label className="pixel-font text-[6px] text-white/30 tracking-wider">APP TOKEN</label>
                      <input
                        type="password"
                        value={setupChannels.slack.appToken}
                        onChange={(e) =>
                          setSetupChannels((prev) => ({
                            ...prev,
                            slack: { appToken: e.target.value, botToken: prev.slack?.botToken ?? "", userToken: prev.slack?.userToken ?? "" },
                          }))
                        }
                        placeholder="xapp-..."
                        className="arcade-input w-full py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="pixel-font text-[6px] text-white/30 tracking-wider">BOT TOKEN</label>
                      <input
                        type="password"
                        value={setupChannels.slack.botToken}
                        onChange={(e) =>
                          setSetupChannels((prev) => ({
                            ...prev,
                            slack: { appToken: prev.slack?.appToken ?? "", botToken: e.target.value, userToken: prev.slack?.userToken ?? "" },
                          }))
                        }
                        placeholder="xoxb-..."
                        className="arcade-input w-full py-2 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="pixel-font text-[6px] text-white/30 tracking-wider">USER TOKEN (OPTIONAL)</label>
                      <input
                        type="password"
                        value={setupChannels.slack.userToken ?? ""}
                        onChange={(e) =>
                          setSetupChannels((prev) => ({
                            ...prev,
                            slack: { appToken: prev.slack?.appToken ?? "", botToken: prev.slack?.botToken ?? "", userToken: e.target.value },
                          }))
                        }
                        placeholder="xoxp-..."
                        className="arcade-input w-full py-2 px-3 text-xs"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Telegram */}
              <div
                className="powerup-card"
                data-enabled={!!setupChannels.telegram}
                style={{ "--powerup-color": "var(--arcade-blue)" } as React.CSSProperties}
              >
                <div className="powerup-card-header">
                  <span className="powerup-card-icon" style={{ background: "var(--arcade-blue)", color: "#000" }}>
                    {"\u2708"}
                  </span>
                  <span className="pixel-font text-[9px] text-white/80">TELEGRAM</span>
                  <button
                    onClick={() => {
                      ArcadeSounds.buttonClick();
                      setSetupChannels((prev) =>
                        prev.telegram
                          ? (() => { const { telegram: _telegram, ...rest } = prev; return rest; })()
                          : { ...prev, telegram: { botToken: "" } }
                      );
                    }}
                    className={`powerup-toggle ${setupChannels.telegram ? "powerup-toggle-on" : ""}`}
                    aria-label={setupChannels.telegram ? "Disconnect Telegram" : "Connect Telegram"}
                  >
                    <span className="powerup-toggle-knob" />
                  </button>
                </div>
                {setupChannels.telegram && (
                  <div className="powerup-card-body">
                    <a
                      href="https://docs.openclaw.ai/channels/telegram"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pixel-font text-[7px] text-white/30 hover:text-white/60 transition-colors inline-block mb-1"
                    >
                      Setup guide →
                    </a>
                    <label className="pixel-font text-[6px] text-white/30 tracking-wider">BOT TOKEN</label>
                    <input
                      type="password"
                      value={setupChannels.telegram.botToken}
                      onChange={(e) =>
                        setSetupChannels((prev) => ({
                          ...prev,
                          telegram: { botToken: e.target.value },
                        }))
                      }
                      placeholder="123456:ABC-..."
                      className="arcade-input w-full py-2 px-3 text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Discord */}
              <div
                className="powerup-card"
                data-enabled={!!setupChannels.discord}
                style={{ "--powerup-color": "var(--arcade-purple)" } as React.CSSProperties}
              >
                <div className="powerup-card-header">
                  <span className="powerup-card-icon" style={{ background: "var(--arcade-purple)", color: "#fff" }}>
                    {"\uD83C\uDFAE"}
                  </span>
                  <span className="pixel-font text-[9px] text-white/80">DISCORD</span>
                  <button
                    onClick={() => {
                      ArcadeSounds.buttonClick();
                      setSetupChannels((prev) =>
                        prev.discord
                          ? (() => { const { discord: _discord, ...rest } = prev; return rest; })()
                          : { ...prev, discord: { token: "" } }
                      );
                    }}
                    className={`powerup-toggle ${setupChannels.discord ? "powerup-toggle-on" : ""}`}
                    aria-label={setupChannels.discord ? "Disconnect Discord" : "Connect Discord"}
                  >
                    <span className="powerup-toggle-knob" />
                  </button>
                </div>
                {setupChannels.discord && (
                  <div className="powerup-card-body">
                    <a
                      href="https://docs.openclaw.ai/channels/discord"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pixel-font text-[7px] text-white/30 hover:text-white/60 transition-colors inline-block mb-1"
                    >
                      Setup guide →
                    </a>
                    <label className="pixel-font text-[6px] text-white/30 tracking-wider">BOT TOKEN</label>
                    <input
                      type="password"
                      value={setupChannels.discord.token}
                      onChange={(e) =>
                        setSetupChannels((prev) => ({
                          ...prev,
                          discord: { token: e.target.value },
                        }))
                      }
                      placeholder="MTk2..."
                      className="arcade-input w-full py-2 px-3 text-xs"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
              <button
                onClick={handleLaunch}
                onMouseEnter={() => ArcadeSounds.buttonHover()}
                className="pixel-font text-[10px] sm:text-xs py-4 px-10 bg-arcade-green text-black border-2 border-arcade-green hover:shadow-[0_0_16px_var(--arcade-green)] hover:scale-[1.02] active:scale-95 transition-all duration-200 cursor-pointer"
              >
                DEPLOY
              </button>
              <button
                onClick={() => {
                  ArcadeSounds.buttonClick();
                  setSetupChannels({});
                  handleLaunch();
                }}
                onMouseEnter={() => ArcadeSounds.buttonHover()}
                className="pixel-font text-[8px] text-white/30 hover:text-white/50 transition-all cursor-pointer"
              >
                SKIP — DEPLOY WITHOUT CHANNELS
              </button>
            </div>

            {/* Back */}
            <div className="flex justify-center">
              <button
                onClick={() => {
                  ArcadeSounds.back();
                  ArcadeSounds.screenTransition();
                  setScreen("apikey");
                }}
                onMouseEnter={() => ArcadeSounds.buttonHover()}
                className="arcade-btn text-arcade-pink"
                style={{ borderColor: "var(--arcade-pink)" }}
              >
                BACK
              </button>
            </div>
          </div>
        )}

        {/* ─── SCREEN 4: DEPLOYING ─── */}
        {!isLoading && screen === "deploying" && activeInstance && (
          <div className="w-full max-w-lg space-y-6 text-center">
            {/* Deploy Header */}
            <h2 className="pixel-font text-arcade-yellow arcade-text text-2xl sm:text-4xl">
              SPINNING UP YOUR INSTANCE
            </h2>

            {/* Launch Flash */}
            {showLaunchFlash && (
              <p
                className="pixel-font text-white text-4xl sm:text-6xl arcade-text"
                style={{
                  animation: "shake 0.5s ease-in-out",
                  textShadow:
                    "0 0 10px #fff, 0 0 20px #fff, 0 0 40px #fff",
                }}
              >
                HERE WE GO
              </p>
            )}

            {/* Deploy Animation */}
            {!showLaunchFlash && !showOnline && !showReady && deploying && (
              <div className="flex flex-col items-center gap-4 py-4">
                {selectedPersona?.sprite ? (
                  <img
                    src={selectedPersona.sprite}
                    alt={selectedPersona.name}
                    className="w-16 h-16 sm:w-20 sm:h-20 object-contain"
                    style={{ filter: `drop-shadow(0 0 8px ${colorToCssVar(selectedPersona.color)})` }}
                    draggable={false}
                  />
                ) : (
                  <span className="text-5xl sm:text-6xl">
                    {selectedPersona?.icon ?? "\uD83E\uDD16"}
                  </span>
                )}
                {selectedPersona && (
                  <span
                    className={`pixel-font text-[8px] ${colorToTw(selectedPersona.color, "text")}`}
                  >
                    {selectedPersona.name}
                  </span>
                )}
                <div className="w-8 h-8 border-2 border-arcade-green border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Online Flash */}
            {showOnline && (
              <p
                className="pixel-font text-arcade-green arcade-text text-4xl sm:text-6xl"
                style={{ animation: "shake 0.8s ease-in-out" }}
              >
                IT&apos;S ALIVE
              </p>
            )}

            {/* Ready */}
            {showReady && activeInstance.status === "running" && (
              <div className="space-y-6">
                <p className="pixel-font text-arcade-green arcade-text text-2xl sm:text-4xl">
                  READY TO WORK
                </p>

                <div className="flex flex-col items-center gap-5">
                  {activeInstance.dashboardUrl && (
                    <a
                      href={activeInstance.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onMouseEnter={() => ArcadeSounds.buttonHover()}
                      onClick={() => ArcadeSounds.buttonClick()}
                      className="pixel-font text-xs bg-arcade-green text-black py-4 px-8 border-2 border-arcade-green hover:shadow-[0_0_20px_var(--arcade-green)] hover:scale-105 transition-all duration-200 cursor-pointer"
                    >
                      OPEN DASHBOARD
                    </a>
                  )}

                  <button
                    onClick={handleBackToStart}
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    className="arcade-btn text-arcade-yellow text-[9px]"
                    style={{ borderColor: "var(--arcade-yellow)" }}
                  >
                    BACK TO HOME
                  </button>
                </div>
              </div>
            )}

            {/* Deploying progress */}
            {deploying &&
              !showOnline &&
              !showReady &&
              activeInstance.status !== "error" && (
                <div className="space-y-4">
                  {/* Health bar */}
                  <div className="w-full h-5 bg-black/60 border-2 border-white/20 rounded-sm overflow-hidden">
                    <div
                      className="health-bar"
                      style={{ animationDuration: "30s" }}
                    />
                  </div>

                  <p className="pixel-font text-arcade-green text-[9px] blink tracking-wider">
                    YOUR OPENCLAW INSTANCE IS WARMING UP. THIS IS THE HARD PART.
                  </p>
                </div>
              )}

            {/* Error state */}
            {activeInstance.status === "error" && (
              <div className="space-y-6">
                <p className="pixel-font text-arcade-red arcade-text text-2xl sm:text-4xl">
                  SOMETHING BROKE
                </p>

                {activeInstance.logs.length > 0 && (
                  <div className="arcade-panel p-4 text-left">
                    <p className="text-arcade-red text-sm font-mono">
                      {activeInstance.logs[activeInstance.logs.length - 1]}
                    </p>
                  </div>
                )}

                <button
                  onClick={() => {
                    ArcadeSounds.buttonClick();
                    ArcadeSounds.screenTransition();
                    setScreen("apikey");
                    setShowOnline(false);
                    setShowReady(false);
                  }}
                  onMouseEnter={() => ArcadeSounds.buttonHover()}
                  className="arcade-btn text-arcade-yellow"
                  style={{ borderColor: "var(--arcade-yellow)" }}
                >
                  DUST OFF AND TRY AGAIN
                </button>
              </div>
            )}

            {/* Deployment Log */}
            {activeInstance.logs.length > 0 &&
              activeInstance.status !== "error" && (
                <div className="text-left">
                  <p className="pixel-font text-[8px] text-white/40 mb-2 tracking-wider">
                    WHAT&apos;S HAPPENING UNDER THE HOOD
                  </p>
                  <div className="arcade-panel p-4 max-h-40 overflow-y-auto font-mono text-xs text-arcade-green/80 space-y-1">
                    {activeInstance.logs.map((log, i) => (
                      <div key={i}>
                        <span className="text-arcade-green/40">{">"} </span>
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
      </main>

      {/* ═══════ TEMPLATE DETAIL MODAL ═══════ */}
      {templateModalPersona && (
        <TemplateDetailModal
          persona={templateModalPersona}
          onClose={handleCloseTemplateModal}
        />
      )}

      {/* ═══════ FOOTER ═══════ */}
      <footer className="border-t border-white/10 px-4 py-4">
        <div className="max-w-4xl mx-auto flex flex-col items-center gap-2">
          <div className="flex items-center gap-4">
            {/* SOC2 Badge */}
            <a
              href="https://trust.nex.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2 py-1 border border-green-500/30 rounded bg-green-500/5 hover:border-green-500/50 hover:bg-green-500/10 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L3 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z" fill="#22c55e" fillOpacity="0.3" stroke="#22c55e" strokeWidth="1.5"/>
                <path d="M9 12l2 2 4-4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="pixel-font text-[6px] text-green-400/80 tracking-wider">SOC2 COMPLIANT ↗</span>
            </a>
            <span className="text-white/15 text-[6px]" aria-hidden="true">{"\u2502"}</span>
            <p className="pixel-font text-[6px] text-white/25 tracking-wider">
              ISOLATED DOCKER CONTAINERS {"\u2022"} YOUR KEYS NEVER LEAVE YOUR INSTANCE
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://nex.ai?utm_source=clawgent.ai&utm_medium=footer&utm_campaign=powered_by"
              target="_blank"
              rel="noopener noreferrer"
              className="pixel-font text-[6px] text-white/30 hover:text-white/50 transition-opacity tracking-wider"
            >
              POWERED BY NEX.AI
            </a>
            <span className="text-white/15 text-[6px]" aria-hidden="true">{"\u2502"}</span>
            <p className="pixel-font text-[6px] text-white/30 tracking-wider">
              CLAWGENT {"\u00A9"} 2026
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
