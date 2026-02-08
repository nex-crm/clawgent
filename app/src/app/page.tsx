"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  },
  {
    id: "sales-assistant",
    name: "SALES ASSISTANT",
    tagline: "Does the research so you can skip the \"just checking in\" era",
    icon: "\uD83C\uDFAF",
    color: "arcade-yellow",
    skills: buildSkillSummaries("sales-assistant"),
    recommendedModel: "anthropic",
  },
  {
    id: "lead-gen",
    name: "LEAD GEN MACHINE",
    tagline: "Turns the internet into a pipeline. Legally.",
    icon: "\uD83E\uDDF2",
    color: "arcade-orange",
    skills: buildSkillSummaries("lead-gen"),
    recommendedModel: "google",
  },
  {
    id: "dev-copilot",
    name: "DEV COPILOT",
    tagline: "Reviews your PRs without the passive-aggressive comments",
    icon: "\u2328\uFE0F",
    color: "arcade-green",
    skills: buildSkillSummaries("dev-copilot"),
    recommendedModel: "anthropic",
  },
  {
    id: "support-agent",
    name: "SUPPORT AGENT",
    tagline: "Closes tickets faster than users can open them",
    icon: "\uD83D\uDEE1\uFE0F",
    color: "arcade-blue",
    skills: buildSkillSummaries("support-agent"),
    recommendedModel: "anthropic",
  },
  {
    id: "ops-automator",
    name: "OPS AUTOMATOR",
    tagline: "Automates the stuff you keep saying you'll automate next quarter",
    icon: "\u2699\uFE0F",
    color: "arcade-purple",
    skills: buildSkillSummaries("ops-automator"),
    recommendedModel: "google",
  },
  {
    id: "founder-sidekick",
    name: "FOUNDER SIDEKICK",
    tagline: "A co-founder who actually ships and doesn't want equity",
    icon: "\uD83D\uDE80",
    color: "arcade-orange",
    skills: buildSkillSummaries("founder-sidekick"),
    recommendedModel: "anthropic",
  },
  {
    id: "data-analyst",
    name: "DATA ANALYST",
    tagline: "Makes your CSVs confess things they didn't know they knew",
    icon: "\uD83D\uDCCA",
    color: "arcade-blue",
    skills: buildSkillSummaries("data-analyst"),
    recommendedModel: "google",
  },
  {
    id: "gtm-engineer",
    name: "GTM ENGINEER",
    tagline: "Your CRM is a mess. This agent doesn't judge, it fixes.",
    icon: "\uD83D\uDE80",
    color: "arcade-red",
    skills: buildSkillSummaries("gtm-engineer"),
    recommendedModel: "anthropic",
  },
];

// ─── Provider Config ────────────────────────────────────────────────

type Provider = "anthropic" | "google" | "openai";

const PROVIDERS: {
  value: Provider;
  label: string;
  shortLabel: string;
  model: string;
}[] = [
  {
    value: "anthropic",
    label: "Claude Sonnet 4.5",
    shortLabel: "CLAUDE",
    model: "anthropic/claude-sonnet-4-5",
  },
  {
    value: "google",
    label: "Gemini 3 Flash",
    shortLabel: "GEMINI",
    model: "google/gemini-3-flash-preview",
  },
  {
    value: "openai",
    label: "GPT-5.2",
    shortLabel: "GPT",
    model: "openai/gpt-5.2",
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
  return `var(--color-${color})`;
}

// ─── Main Component ─────────────────────────────────────────────────

export default function Home() {
  // Auth state (works with or without WorkOS)
  const { user: authUser, loading: authLoading } = useAuthSafe();

  // Screen state machine
  const [screen, setScreen] = useState<
    "start" | "select" | "apikey" | "deploying"
  >("start");
  const [selectedPersona, setSelectedPersona] = useState<Persona | null>(null);
  const [hoveredPersona, setHoveredPersona] = useState<Persona | null>(null);
  const [expandedSkill, setExpandedSkill] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<Provider>("anthropic");
  const [apiKey, setApiKey] = useState("");

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
          }
          if (data.status === "error") {
            ArcadeSounds.deployError();
          }
        }
      } catch {
        // ignore
      }
    },
    [fetchStatus, fetchUserData]
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
    setExpandedSkill(null);
    setSelectedProvider(persona.recommendedModel);
    setScreen("apikey");
    ArcadeSounds.screenTransition();
  }

  function handleStartFromScratch() {
    ArcadeSounds.select();
    setSelectedPersona(null);
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
      setShowAddAgentSelect(false);
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
    setApiKey("");
    setShowOnline(false);
    setShowReady(false);
  }

  // ─── Persona lookup helper ────────────────────────────────────

  function getPersonaById(id: string | undefined): Persona | undefined {
    return PERSONAS.find((p) => p.id === id);
  }

  // ─── Derived state ────────────────────────────────────────────

  const isLoading = authLoading || userDataLoading;
  const isAuthenticated = !!authUser;
  const hasInstance = !!userInstance && (userInstance.status === "running" || userInstance.status === "starting");

  // ─── Render ───────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex flex-col">
      {/* ═══════ MUTE TOGGLE ═══════ */}
      <button
        onClick={handleToggleMute}
        className="sound-mute-btn"
        title={soundMuted ? "Unmute sounds" : "Mute sounds"}
        aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"}
      >
        <span className="sound-mute-icon">{soundMuted ? "\uD83D\uDD07" : "\uD83D\uDD0A"}</span>
      </button>

      {/* ═══════ TOP BAR (when logged in) ═══════ */}
      {isAuthenticated && (
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
              <span className="pixel-font text-[7px] sm:text-[8px] text-white/50 tracking-wider">
                {authUser.email}
              </span>
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
              <p className="pixel-font text-arcade-yellow text-[10px] sm:text-xs tracking-widest max-w-sm mx-auto leading-relaxed">
                YOUR OWN OPENCLAW INSTANCE. USEFUL FROM DAY 1.
              </p>
              <p className="pixel-font text-white/25 text-[7px] tracking-wider max-w-xs mx-auto">
                PRE-LOADED AGENT TEMPLATES. REAL SKILLS. ONE CLICK.
              </p>
            </div>

            {/* AUTH GATE: Not logged in */}
            {!isAuthenticated && (
              <>
                <button
                  onClick={handleSignIn}
                  onMouseEnter={() => ArcadeSounds.buttonHover()}
                  disabled={signingIn}
                  className="pixel-font bg-white text-black text-sm sm:text-base px-10 py-4 border-4 border-white cursor-pointer transition-all duration-150 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.5)] active:scale-95 disabled:opacity-50 disabled:cursor-wait"
                >
                  {/* TODO: Re-add Google OAuth as a sign-in option */}
                  {signingIn ? "HOLD TIGHT..." : "SIGN IN"}
                </button>

                <p className="pixel-font text-white/30 text-[8px] tracking-wider max-w-xs">
                  SIGN IN TO DEPLOY YOUR OWN OPENCLAW INSTANCE
                </p>
              </>
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
                              <span className="text-2xl sm:text-3xl shrink-0">{agent.emoji}</span>
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`pixel-font text-[8px] sm:text-[9px] ${colorToTw(accentColor, "text")}`}
                                >
                                  {agent.name}
                                </p>
                                <p className="pixel-font text-[6px] text-white/30 mt-0.5">
                                  {agent.persona ? PERSONAS.find((p) => p.id === agent.persona)?.name ?? agent.persona : "CUSTOM"}
                                  {agent.skillCount > 0 && (
                                    <span className="ml-2 text-white/20">{agent.skillCount} SKILLS</span>
                                  )}
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
              <div className="w-full max-w-4xl space-y-6">
                <h2 className="pixel-font text-arcade-yellow arcade-text text-center text-sm sm:text-lg">
                  ADD AGENT TO INSTANCE
                </h2>
                <p className="pixel-font text-white/30 text-[7px] text-center tracking-wider -mt-4">
                  PICK A TEMPLATE. THE AGENT WILL USE YOUR INSTANCE&apos;S EXISTING API KEY.
                </p>

                {/* Reuse the 3x3 persona grid */}
                <div className="sf2-grid-wrapper">
                  <div className="grid grid-cols-3 gap-0 border-4 border-arcade-yellow bg-black/80 max-w-2xl mx-auto">
                    {PERSONAS.map((persona) => {
                      const isHovered = addAgentHovered?.id === persona.id;
                      return (
                        <button
                          key={persona.id}
                          onClick={() => {
                            ArcadeSounds.select();
                            addAgentToInstance(userInstance!.id, persona.id);
                          }}
                          onMouseEnter={() => { playCursorMove(); setAddAgentHovered(persona); }}
                          onMouseLeave={() => setAddAgentHovered(null)}
                          disabled={addingAgent}
                          className="relative aspect-square flex flex-col items-center justify-center cursor-pointer transition-colors duration-100 disabled:opacity-40"
                          style={{
                            border: isHovered
                              ? `3px solid ${colorToCssVar(persona.color)}`
                              : "3px solid #333",
                            background: isHovered
                              ? "rgba(255,255,255,0.06)"
                              : "transparent",
                            boxShadow: isHovered
                              ? `inset 0 0 20px ${colorToCssVar(persona.color)}33, 0 0 8px ${colorToCssVar(persona.color)}66`
                              : "none",
                          }}
                        >
                          {isHovered && (
                            <>
                              <span className="sf2-cursor sf2-cursor-tl" style={{ borderColor: colorToCssVar(persona.color) }} />
                              <span className="sf2-cursor sf2-cursor-tr" style={{ borderColor: colorToCssVar(persona.color) }} />
                              <span className="sf2-cursor sf2-cursor-bl" style={{ borderColor: colorToCssVar(persona.color) }} />
                              <span className="sf2-cursor sf2-cursor-br" style={{ borderColor: colorToCssVar(persona.color) }} />
                            </>
                          )}
                          <span className="text-3xl sm:text-4xl md:text-5xl mb-1">{persona.icon}</span>
                          <span
                            className={`pixel-font text-[6px] sm:text-[7px] ${isHovered ? colorToTw(persona.color, "text") : "text-white/40"}`}
                          >
                            {persona.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Hovered persona preview */}
                {addAgentHovered && (
                  <div className="text-center space-y-1">
                    <p className={`pixel-font text-[10px] ${colorToTw(addAgentHovered.color, "text")}`}>
                      {addAgentHovered.name}
                    </p>
                    <p className="text-white/50 text-xs">{addAgentHovered.tagline}</p>
                    <p className="pixel-font text-white/20 text-[7px]">
                      {addAgentHovered.skills.length} SKILLS
                    </p>
                  </div>
                )}

                {!addAgentHovered && !addingAgent && (
                  <p className="pixel-font text-white/30 text-[9px] text-center blink">
                    HOVER TO PREVIEW. CLICK TO ADD.
                  </p>
                )}

                {addingAgent && (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <div className="w-8 h-8 border-2 border-arcade-green border-t-transparent rounded-full animate-spin" />
                    <p className="pixel-font text-arcade-green text-[9px] blink tracking-wider">
                      CONFIGURING AGENT...
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex justify-center gap-3">
                  <button
                    onClick={() => {
                      ArcadeSounds.back();
                      ArcadeSounds.screenTransition();
                      setShowAddAgentSelect(false);
                      setAddAgentHovered(null);
                    }}
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    disabled={addingAgent}
                    className="arcade-btn text-arcade-pink"
                    style={{ borderColor: "var(--arcade-pink)" }}
                  >
                    BACK
                  </button>
                  <button
                    onClick={() => {
                      ArcadeSounds.select();
                      addAgentToInstance(userInstance!.id, null);
                    }}
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    disabled={addingAgent}
                    className="arcade-btn text-white/60 hover:text-white/80"
                    style={{ borderColor: "rgba(255,255,255,0.3)" }}
                    title="Add a blank agent with no pre-loaded skills"
                  >
                    START FROM SCRATCH
                  </button>
                </div>
              </div>
            )}

            {/* AUTH GATE: Logged in + no instance */}
            {isAuthenticated && !hasInstance && (
              <>
                <button
                  onClick={() => { ArcadeSounds.buttonClick(); ArcadeSounds.screenTransition(); setScreen("select"); }}
                  onMouseEnter={() => ArcadeSounds.buttonHover()}
                  disabled={!systemStatus?.dockerAvailable}
                  className="pixel-font bg-white text-black text-sm sm:text-base px-10 py-4 border-4 border-white cursor-pointer transition-all duration-150 hover:scale-105 hover:shadow-[0_0_20px_rgba(255,255,255,0.5)] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  DEPLOY OPENCLAW
                </button>

                {systemStatus && !systemStatus.dockerAvailable && (
                  <p className="pixel-font text-arcade-red text-[8px]">
                    DOCKER IS TAKING A PERSONAL DAY
                  </p>
                )}
              </>
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
          <div className="w-full max-w-4xl space-y-6">
            {/* Header */}
            <h2 className="pixel-font text-arcade-yellow arcade-text text-center text-sm sm:text-lg">
              PRE-LOAD AN AGENT TEMPLATE
            </h2>
            <p className="pixel-font text-white/30 text-[7px] text-center tracking-wider -mt-4">
              PICK A TEMPLATE TO MAKE YOUR INSTANCE USEFUL FROM DAY 1. YOU CAN ADD MORE AGENTS LATER.
            </p>

            {/* SF2-Style Character Grid */}
            <div className="sf2-grid-wrapper">
              <div className="grid grid-cols-3 gap-0 border-4 border-arcade-yellow bg-black/80 max-w-2xl mx-auto">
                {PERSONAS.map((persona) => {
                  const isHovered = hoveredPersona?.id === persona.id;
                  const isSelected = selectedPersona?.id === persona.id;
                  const isActive = isHovered || isSelected;
                  return (
                    <button
                      key={persona.id}
                      onClick={() => handlePersonaSelect(persona)}
                      onMouseEnter={() => { playCursorMove(); setHoveredPersona(persona); setExpandedSkill(null); }}
                      onMouseLeave={() => setHoveredPersona(null)}
                      className="relative aspect-square flex flex-col items-center justify-center cursor-pointer transition-colors duration-100"
                      style={{
                        border: isActive
                          ? `3px solid ${colorToCssVar(persona.color)}`
                          : "3px solid #333",
                        background: isActive
                          ? "rgba(255,255,255,0.06)"
                          : "transparent",
                        boxShadow: isActive
                          ? `inset 0 0 20px ${colorToCssVar(persona.color)}33, 0 0 8px ${colorToCssVar(persona.color)}66`
                          : "none",
                      }}
                    >
                      {/* Selector Cursor (animated corners) */}
                      {isActive && (
                        <>
                          <span className="sf2-cursor sf2-cursor-tl" style={{ borderColor: colorToCssVar(persona.color) }} />
                          <span className="sf2-cursor sf2-cursor-tr" style={{ borderColor: colorToCssVar(persona.color) }} />
                          <span className="sf2-cursor sf2-cursor-bl" style={{ borderColor: colorToCssVar(persona.color) }} />
                          <span className="sf2-cursor sf2-cursor-br" style={{ borderColor: colorToCssVar(persona.color) }} />
                        </>
                      )}

                      {/* Character Icon */}
                      <span className="text-3xl sm:text-4xl md:text-5xl mb-1">
                        {persona.icon}
                      </span>

                      {/* Mini Name (inside cell) */}
                      <span
                        className={`pixel-font text-[6px] sm:text-[7px] ${isActive ? colorToTw(persona.color, "text") : "text-white/40"}`}
                      >
                        {persona.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Nameplate (below grid, shows hovered/selected persona info + skills showcase) */}
            {(() => {
              const displayPersona = hoveredPersona ?? selectedPersona;
              if (!displayPersona) return (
                <div className="h-24 flex flex-col items-center justify-center gap-2">
                  <p className="pixel-font text-white/30 text-[9px] blink">
                    HOVER TO PREVIEW. CLICK TO COMMIT.
                  </p>
                  <p className="pixel-font text-white/15 text-[7px] tracking-wider">
                    EACH TEMPLATE PRE-LOADS SKILLS INTO YOUR OPENCLAW INSTANCE
                  </p>
                </div>
              );

              const accentVar = colorToCssVar(displayPersona.color);

              return (
                <div
                  className="border-4 max-w-2xl mx-auto"
                  style={{
                    borderColor: accentVar,
                    background: "rgba(0,0,0,0.7)",
                    boxShadow: `0 0 12px ${accentVar}44`,
                  }}
                >
                  {/* Top row: icon + name + tagline */}
                  <div className="flex items-center gap-6 p-4 pb-2">
                    <span className="text-4xl sm:text-5xl shrink-0">{displayPersona.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`pixel-font text-xs sm:text-sm ${colorToTw(displayPersona.color, "text")} arcade-text`}
                      >
                        {displayPersona.name}
                      </p>
                      <p className="text-white/60 text-xs mt-1">{displayPersona.tagline}</p>
                    </div>
                  </div>

                  {/* Skills section header */}
                  <div className="px-4 pt-1 pb-1">
                    <p
                      className="pixel-font text-[6px] tracking-[0.2em]"
                      style={{ color: `${accentVar}` }}
                    >
                      EQUIPPED SKILLS
                    </p>
                  </div>

                  {/* Skill tags */}
                  <div className="flex flex-wrap gap-2 px-4 pb-2">
                    {displayPersona.skills.map((skill) => {
                      const isExpanded = expandedSkill === skill.name;
                      return (
                        <button
                          key={skill.name}
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedSkill(isExpanded ? null : skill.name);
                          }}
                          className="skill-tag pixel-font text-[6px] px-2 py-1 border cursor-pointer transition-all duration-150"
                          style={{
                            borderColor: isExpanded ? accentVar : `${accentVar}66`,
                            color: accentVar,
                            background: isExpanded ? `${accentVar}15` : "transparent",
                            boxShadow: isExpanded ? `0 0 8px ${accentVar}33` : "none",
                          }}
                        >
                          <span className="mr-1">{skill.emoji}</span>
                          {skill.name}
                        </button>
                      );
                    })}
                  </div>

                  {/* Expanded skill detail panel */}
                  {expandedSkill && (() => {
                    const skill = displayPersona.skills.find((s) => s.name === expandedSkill);
                    if (!skill) return null;
                    return (
                      <div
                        className="skill-detail-panel mx-4 mb-4 p-3 border-t"
                        style={{
                          borderColor: `${accentVar}33`,
                          background: `${accentVar}08`,
                        }}
                      >
                        {/* Skill header in panel */}
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm">{skill.emoji}</span>
                          <span
                            className="pixel-font text-[8px]"
                            style={{ color: accentVar }}
                          >
                            {skill.name.toUpperCase()}
                          </span>
                        </div>

                        {/* Description */}
                        <p className="text-white/70 text-[11px] leading-relaxed">
                          {skill.description}
                        </p>

                        {/* Source attribution */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <span
                            className="pixel-font text-[5px] tracking-wider"
                            style={{ color: `${accentVar}88` }}
                          >
                            SRC:
                          </span>
                          {skill.sourceUrl ? (
                            <a
                              href={skill.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="pixel-font text-[5px] tracking-wider underline underline-offset-2 transition-colors hover:brightness-125"
                              style={{ color: `${accentVar}aa` }}
                            >
                              {skill.source}
                            </a>
                          ) : (
                            <span
                              className="pixel-font text-[5px] tracking-wider"
                              style={{ color: `${accentVar}88` }}
                            >
                              {skill.source}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })()}

            {/* Actions */}
            <div className="flex justify-center gap-3">
              <button
                onClick={handleBackToStart}
                onMouseEnter={() => ArcadeSounds.buttonHover()}
                className="arcade-btn text-arcade-pink"
                style={{ borderColor: "var(--arcade-pink)" }}
              >
                BACK
              </button>
              <button
                onClick={handleStartFromScratch}
                onMouseEnter={() => ArcadeSounds.buttonHover()}
                className="arcade-btn text-white/60 hover:text-white/80"
                style={{ borderColor: "rgba(255,255,255,0.3)" }}
                title="Deploy a blank OpenClaw instance with no pre-loaded agents. You know what you're doing."
              >
                I KNOW WHAT I&apos;M DOING
              </button>
            </div>
          </div>
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
                <span className="text-5xl">{selectedPersona.icon}</span>
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
                    pixel-font text-[8px] sm:text-[9px] py-3 px-2 transition-all duration-150 cursor-pointer
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

            {/* API Key Input */}
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLaunch();
              }}
              placeholder="sk-... (YOU KNOW THE DRILL)"
              className="arcade-input w-full py-3 px-4 text-sm"
              autoFocus
            />

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleLaunch}
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
                LAUNCH INSTANCE
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
                <span className="text-5xl sm:text-6xl">
                  {selectedPersona?.icon ?? "\uD83E\uDD16"}
                </span>
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

                {activeInstance.dashboardUrl && (
                  <a
                    href={activeInstance.dashboardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onMouseEnter={() => ArcadeSounds.buttonHover()}
                    onClick={() => ArcadeSounds.buttonClick()}
                    className="inline-block pixel-font text-xs bg-arcade-green text-black py-4 px-8 border-2 border-arcade-green hover:shadow-[0_0_20px_var(--arcade-green)] hover:scale-105 transition-all duration-200 cursor-pointer"
                  >
                    OPEN DASHBOARD
                  </a>
                )}

                <button
                  onClick={handleBackToStart}
                  onMouseEnter={() => ArcadeSounds.buttonHover()}
                  className="block mx-auto arcade-btn text-arcade-yellow text-[9px]"
                  style={{ borderColor: "var(--arcade-yellow)" }}
                >
                  BACK TO HOME
                </button>
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

      {/* ═══════ FOOTER ═══════ */}
      <footer className="border-t border-white/10 px-4 py-4">
        <div className="max-w-4xl mx-auto text-center">
          <p className="pixel-font text-[7px] text-white/30 tracking-wider">
            CLAWGENT {"\u00A9"} 2026 &mdash; EVERY INSTANCE GETS ITS OWN
            DOCKER CONTAINER. NO SHARED STATE. NO DRAMA.
          </p>
        </div>
      </footer>
    </div>
  );
}
