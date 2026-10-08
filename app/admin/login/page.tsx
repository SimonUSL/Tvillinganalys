"use client";

import { useState } from "react";

const LOGO_SRC =
  "https://cdn.prod.website-files.com/5dd4488fdda3ce628d8173ce/5ddfe48c64e4a62b7bd48be9_optimal_kommunikation_logo.svg";

export default function AdminLogin() {
  const [losenord, setLosenord] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [laddar, setLaddar] = useState(false);

  async function loggaIn(e: React.FormEvent) {
    e.preventDefault();
    if (laddar) return;
    setLaddar(true);
    setFel(null);
    try {
      const resp = await fetch("/api/admin-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: losenord }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || "Något gick fel.");
      // Full sidladdning så att middleware ser den nya cookien.
      window.location.href = "/admin";
    } catch (e: any) {
      setFel(e.message || String(e));
      setLaddar(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "0 auto", padding: "80px 16px" }}>
      <img src={LOGO_SRC} alt="Optimal Kommunikation" style={{ height: 30, display: "block", margin: "0 auto 28px" }} />
      <form className="card stack" onSubmit={loggaIn}>
        <h1 style={{ fontSize: 22, textAlign: "center" }}>Admin</h1>
        <div className="field">
          <label htmlFor="losenord">Lösenord</label>
          <input
            id="losenord"
            type="password"
            autoComplete="current-password"
            value={losenord}
            onChange={(e) => setLosenord(e.target.value)}
            autoFocus
            required
          />
        </div>
        {fel && (
          <p className="alert" role="alert">
            {fel}
          </p>
        )}
        <button type="submit" className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
          {laddar ? "Loggar in…" : "Logga in"}
        </button>
      </form>
    </main>
  );
}
