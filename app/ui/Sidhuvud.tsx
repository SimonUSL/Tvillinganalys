"use client";

import { useEffect, useState } from "react";

const LOGO_SRC =
  "https://cdn.prod.website-files.com/5dd4488fdda3ce628d8173ce/5ddfe48c64e4a62b7bd48be9_optimal_kommunikation_logo.svg";

export type Vy = "verktyg" | "granska" | "historik";

// Sidhuvudet med länkarna mellan verktyget, granskningskön och historiken.
export default function Sidhuvud({ admin, vy }: { admin: boolean; vy: Vy }) {
  const [koAntal, setKoAntal] = useState(0);
  useEffect(() => {
    if (vy === "granska") return;
    fetch("/api/granska?antal=1")
      .then((r) => r.json())
      .then((d) => setKoAntal(d.antal || 0))
      .catch(() => {});
  }, [vy]);

  const bas = admin ? "/admin" : "";
  const lankar: { vy: Vy; href: string; text: string }[] = [
    { vy: "verktyg", href: bas || "/", text: "Verktyget" },
    { vy: "granska", href: `${bas}/granska`, text: `Granska${koAntal ? ` (${koAntal})` : ""}` },
    { vy: "historik", href: `${bas}/historik`, text: "Historik" },
  ];

  async function loggaUt() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = admin ? "/admin/login" : "/login";
  }

  return (
    <header className="app-header">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <img src={LOGO_SRC} alt="Optimal Kommunikation" />
        {admin && <span className="badge badge-accent">Admin</span>}
      </div>
      <nav aria-label="Huvudmeny" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {lankar.map((l) => (
          <a
            key={l.vy}
            className="btn-link"
            href={l.href}
            aria-current={l.vy === vy ? "page" : undefined}
            style={l.vy === vy ? { fontWeight: 700, textDecoration: "underline" } : undefined}
          >
            {l.text}
          </a>
        ))}
        <button type="button" className="btn-link" onClick={loggaUt}>
          Logga ut
        </button>
      </nav>
    </header>
  );
}
