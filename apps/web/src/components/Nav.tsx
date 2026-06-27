"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLive, setIsLive] = useState(false);

  const checkHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { mode?: string }) => setIsLive(d?.mode === "LIVE"))
      .catch(() => setIsLive(false));
  }, []);

  useEffect(() => {
    checkHealth();
    const id = setInterval(checkHealth, 60_000);
    return () => clearInterval(id);
  }, [checkHealth]);

  const links = [
    { href: "/", label: "Overview" },
    { href: "/console", label: "Console" },
    { href: "/journal", label: "Journal" },
    { href: "/playbook", label: "Playbook" },
  ];

  const tabIcons = ["⌂", "◉", "≡", "◈"];

  return (
    <>
      <nav className="nav-bar">
        {/* Left: wordmark + subtitle */}
        <div style={{ display: "flex", alignItems: "center" }}>
          <Link href="/" className="nav-wordmark">Veydrift</Link>
          <span className="nav-subtitle">AUTONOMOUS SPOT AGENT · BITGET</span>
        </div>

        {/* Center: page links */}
        <div className="nav-links">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`nav-link${pathname === l.href ? " active" : ""}`}
            >
              {l.label}
            </Link>
          ))}
        </div>

        {/* Right: live status + refresh */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <div className="status-pill">
            <span
              className={`status-dot${isLive ? " pulse" : ""}`}
              style={{ background: isLive ? "var(--green)" : "var(--text-muted)" }}
            />
            <span style={{ color: isLive ? "var(--green)" : "var(--text-muted)" }}>
              {isLive ? "LIVE" : "OFFLINE"}
            </span>
          </div>
          <button
            className="nav-btn"
            onClick={() => router.refresh()}
            title="Refresh page data"
          >
            ↻
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar */}
      <nav className="mobile-tab-bar">
        {links.map((l, i) => (
          <Link
            key={l.href}
            href={l.href}
            className={`mobile-tab${pathname === l.href ? " active" : ""}`}
          >
            <span style={{ fontSize: "18px", lineHeight: 1 }}>{tabIcons[i]}</span>
            {l.label}
          </Link>
        ))}
      </nav>
    </>
  );
}
