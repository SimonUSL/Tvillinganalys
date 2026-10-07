"use client";

import { useState } from "react";

const ACCENT = "#EB5F62";
const DARK = "#2B2B2B";
const BORDER = "#EEF0F3";
const CARD_BG = "#FFFFFF";
const LOGO_SRC =
  "https://cdn.prod.website-files.com/5dd4488fdda3ce628d8173ce/5ddfe48c64e4a62b7bd48be9_optimal_kommunikation_logo.svg";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 6,
  border: `1px solid ${BORDER}`,
  fontFamily: "'Poppins', system-ui, sans-serif",
  fontSize: 14,
  boxSizing: "border-box",
  marginBottom: 16,
};

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(data.error || "Något gick fel. Försök igen.");
        setLoading(false);
        return;
      }
      // Full sidladdning så middleware ser den nya cookien direkt.
      window.location.href = "/";
    } catch {
      setError("Kunde inte nå servern. Försök igen.");
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "80px 16px" }}>
      <img
        src={LOGO_SRC}
        alt="Optimal Kommunikation"
        style={{ height: 32, display: "block", margin: "0 auto 28px" }}
      />

      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 28,
        }}
      >
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 4,
            color: DARK,
            textAlign: "center",
          }}
        >
          Logga in
        </h1>
        <p
          style={{
            color: "#64646A",
            marginTop: 0,
            marginBottom: 24,
            fontSize: 14,
            textAlign: "center",
          }}
        >
          Tvillinganalys — internt verktyg för Optimal Kommunikation.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor="username"
            style={{ display: "block", fontSize: 13, fontWeight: 600, color: DARK, marginBottom: 6 }}
          >
            Användarnamn
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            style={inputStyle}
          />

          <label
            htmlFor="password"
            style={{ display: "block", fontSize: 13, fontWeight: 600, color: DARK, marginBottom: 6 }}
          >
            Lösenord
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />

          {error && (
            <p
              role="alert"
              style={{
                color: ACCENT,
                fontSize: 13,
                marginTop: -4,
                marginBottom: 16,
                fontWeight: 500,
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: ACCENT,
              color: "white",
              border: `2px solid ${ACCENT}`,
              borderRadius: 6,
              padding: "10px 22px 8px",
              fontFamily: "'Poppins', system-ui, sans-serif",
              fontWeight: 600,
              fontSize: 13,
              textTransform: "uppercase",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Loggar in..." : "Logga in"}
          </button>
        </form>
      </div>
    </main>
  );
}
