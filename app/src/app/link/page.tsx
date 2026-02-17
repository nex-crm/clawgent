"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuthSafe } from "../../lib/use-auth-safe";
import { getSignInUrlAction } from "../actions/auth";

type LinkState = "idle" | "submitting" | "success" | "error";

export default function LinkPage() {
  const { user, loading: authLoading } = useAuthSafe();
  const [code, setCode] = useState("");
  const [state, setState] = useState<LinkState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function handleSignIn() {
    setSigningIn(true);
    try {
      const url = await getSignInUrlAction();
      window.location.href = url;
    } catch {
      setSigningIn(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length !== 6) return;

    setState("submitting");
    setErrorMsg("");

    try {
      const res = await fetch("/api/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();

      if (!res.ok) {
        setState("error");
        setErrorMsg(data.error || "Something went wrong.");
        return;
      }

      setState("success");
      setInstanceId(data.instanceId || "");
    } catch {
      setState("error");
      setErrorMsg("Network error. Try again.");
    }
  }

  // Loading
  if (authLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.panel}>
          <div style={styles.title}>LINK WHATSAPP</div>
          <p style={styles.text}>Loading...</p>
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!user) {
    return (
      <div style={styles.container}>
        <div style={styles.panel}>
          <div style={styles.title}>LINK WHATSAPP</div>
          <p style={styles.text}>
            Sign in to your Clawgent account to link your WhatsApp.
          </p>
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            style={styles.button}
          >
            {signingIn ? "REDIRECTING..." : "SIGN IN"}
          </button>
        </div>
      </div>
    );
  }

  // Success
  if (state === "success") {
    return (
      <div style={styles.container}>
        <div style={styles.panel}>
          <div style={styles.title}>LINKED!</div>
          <p style={styles.textGreen}>
            Your WhatsApp is now connected to your instance.
          </p>
          <p style={styles.text}>
            Send any message on WhatsApp to start chatting with your agent.
          </p>
          {instanceId && (
            <a href={`/i/${instanceId}/`} style={styles.link}>
              GO TO DASHBOARD
            </a>
          )}
          <Link href="/" style={styles.linkSecondary}>
            BACK TO HOME
          </Link>
        </div>
      </div>
    );
  }

  // Form
  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <div style={styles.title}>LINK WHATSAPP</div>
        <p style={styles.text}>
          Enter the 6-character code from WhatsApp to connect your account.
        </p>
        <p style={styles.hint}>
          Send <strong>/link</strong> on WhatsApp to get a code.
        </p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            type="text"
            value={code}
            onChange={(e) => {
              const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
              setCode(v);
              if (state === "error") setState("idle");
            }}
            placeholder="ABC123"
            maxLength={6}
            autoFocus
            style={styles.input}
            disabled={state === "submitting"}
          />
          <button
            type="submit"
            disabled={code.trim().length !== 6 || state === "submitting"}
            style={{
              ...styles.button,
              opacity: code.trim().length !== 6 || state === "submitting" ? 0.5 : 1,
            }}
          >
            {state === "submitting" ? "LINKING..." : "LINK ACCOUNT"}
          </button>
        </form>
        {state === "error" && errorMsg && (
          <p style={styles.error}>{errorMsg}</p>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#181018",
    padding: "1rem",
  },
  panel: {
    background: "#1a1a2e",
    border: "3px solid #f8d838",
    padding: "2.5rem 2rem",
    maxWidth: "420px",
    width: "100%",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
  },
  title: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "1.1rem",
    color: "#f8d838",
    marginBottom: "0.5rem",
    letterSpacing: "2px",
  },
  text: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.6rem",
    color: "#e0e0e0",
    lineHeight: "1.8",
  },
  textGreen: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.65rem",
    color: "#38c830",
    lineHeight: "1.8",
  },
  hint: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.55rem",
    color: "#888",
    lineHeight: "1.8",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "1rem",
    width: "100%",
    marginTop: "0.5rem",
  },
  input: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "1.4rem",
    textAlign: "center",
    letterSpacing: "8px",
    padding: "0.75rem 1rem",
    background: "#0d0d1a",
    border: "2px solid #f8d838",
    color: "#f8d838",
    width: "100%",
    maxWidth: "260px",
    outline: "none",
  },
  button: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.7rem",
    padding: "0.75rem 1.5rem",
    background: "transparent",
    border: "2px solid #f8d838",
    color: "#f8d838",
    cursor: "pointer",
    letterSpacing: "1px",
    transition: "all 0.15s",
  },
  link: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.65rem",
    color: "#38c830",
    border: "2px solid #38c830",
    padding: "0.6rem 1.2rem",
    textDecoration: "none",
    letterSpacing: "1px",
    marginTop: "0.5rem",
  },
  linkSecondary: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.55rem",
    color: "#888",
    textDecoration: "none",
    marginTop: "0.25rem",
  },
  error: {
    fontFamily: '"Press Start 2P", "Courier New", monospace',
    fontSize: "0.55rem",
    color: "#f83078",
    lineHeight: "1.8",
    marginTop: "0.5rem",
  },
};
