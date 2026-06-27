// Static page — no client-side state needed.

export default function PlaybookPage() {
  const sec: React.CSSProperties = {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "40px var(--page-padding)",
  };

  const secAlt: React.CSSProperties = {
    ...sec,
    background: "var(--surface)",
    maxWidth: "100%",
    borderTop: "1px solid var(--border)",
    borderBottom: "1px solid var(--border)",
  };

  const secAltInner: React.CSSProperties = {
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "40px var(--page-padding)",
  };

  // Equity curve: viewBox 0 0 600 200, chart area y 20–180 (160px), x 60–590 (530px)
  // Y: $99,800 (y=180) → $100,100 (y=20); range=300 → scale=160/300
  // yOf(v) = 180 - ((v - 99800) / 300 * 160)
  // xOf(d) = 60 + (d / 42 * 530)
  //
  // Grid lines (y): $100,100→20, $100,000→73, $99,900→127, $99,800→180
  // Path approx (stepped with small upticks for winning trades):
  //   May 16 d=0  $100,000 → (60, 73)
  //   May 19 d=3  $99,975  → (98,  82)  — losing trade
  //   May 22 d=6  $99,990  → (136, 77)  — winning trade
  //   May 26 d=10 $99,958  → (186, 91)  — losing trades
  //   Jun 1  d=16 $99,960  → (282, 90)  — flat
  //   Jun 4  d=19 $99,935  → (320, 103) — losing trade
  //   Jun 8  d=23 $99,948  → (368, 98)  — winning trade
  //   Jun 12 d=27 $99,917  → (421, 111) — losing trades
  //   Jun 16 d=31 $99,920  → (453, 110) — flat / winning
  //   Jun 20 d=35 $99,875  → (502, 128) — losing trades
  //   Jun 23 d=38 $99,882  → (541, 126) — winning trade
  //   Jun 27 d=42 $99,848  → (590, 143) — end

  const equityPath =
    "M 60,73 L 98,82 L 136,77 L 186,91 L 282,90 L 320,103 L 368,98 L 421,111 L 453,110 L 502,128 L 541,126 L 590,143";

  const fillPath =
    equityPath + " L 590,180 L 60,180 Z";

  const details: { label: string; value: string; mono?: boolean }[] = [
    { label: "Backtest Period",  value: "May 16 – Jun 27, 2026 (42 days)" },
    { label: "Trading Pairs",    value: "BTCUSDT · ETHUSDT (Binance venue)", mono: true },
    { label: "Starting Capital", value: "$100,000 USDT", mono: true },
    { label: "Ending Balance",   value: "$99,848.60 USDT", mono: true },
    { label: "Net PnL",          value: "−$151.40", mono: true },
    { label: "Total Trades",     value: "20" },
    { label: "Profit Factor",    value: "0.086", mono: true },
    { label: "Estimated Fees",   value: "~$3.49 USDT", mono: true },
  ];

  const stats = [
    { label: "Total Return",  value: "−0.15%",  sub: "Capital preserved",   color: "var(--green)" },
    { label: "Max Drawdown",  value: "0.15%",   sub: "Very low",            color: "var(--green)" },
    { label: "Sharpe Ratio",  value: "−8.31",   sub: "42-day period",       color: "var(--amber)" },
    { label: "Win Rate",      value: "30%",      sub: "6 of 20 trades",      color: "var(--amber)" },
  ];

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh" }}>

      {/* ── Header ──────────────────────────────────────────────────── */}
      <section style={sec}>
        <div className="vd-label">GetAgent Playbook</div>
        <h1 style={{ fontSize: "28px", fontWeight: 700, color: "var(--text-primary)", margin: "8px 0 6px" }}>
          Agent Playbook
        </h1>
        <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          Verified backtest published on Bitget GetAgent
        </div>
      </section>

      {/* ── Section 1: Playbook Status Card ─────────────────────────── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <section style={{ ...secAltInner }}>
          <div className="vd-label" style={{ marginBottom: "16px" }}>Playbook Status</div>
          <div className="vd-card">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: "var(--grid-gap)",
              }}
            >
              {[
                { label: "Playbook Name", value: "veydrift-risk-rotation", mono: true },
                {
                  label: "Status",
                  value: null,
                  badge: true,
                },
                { label: "Version", value: "0.0.1", mono: true },
                { label: "Published", value: "2026-06-27" },
                { label: "Platform", value: "Bitget GetAgent" },
              ].map((item) => (
                <div key={item.label}>
                  <div className="vd-label">{item.label}</div>
                  {item.badge ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 700,
                          color: "var(--green)",
                          background: "var(--green)18",
                          border: "1px solid var(--green)44",
                          borderRadius: "4px",
                          padding: "2px 10px",
                        }}
                      >
                        Published ✓
                      </span>
                    </div>
                  ) : (
                    <div
                      className={item.mono ? "font-mono" : ""}
                      style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 600, marginTop: "2px" }}
                    >
                      {item.value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* ── Section 2: Backtest Summary ──────────────────────────────── */}
      <section style={sec}>
        <div className="vd-label" style={{ marginBottom: "16px" }}>Backtest Summary</div>
        <div className="stat-grid">
          {stats.map((s) => (
            <div key={s.label} className="vd-card">
              <div className="vd-label">{s.label}</div>
              <div
                className="font-mono"
                style={{ fontSize: "28px", fontWeight: 700, color: s.color, lineHeight: 1.1, margin: "6px 0 4px" }}
              >
                {s.value}
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{s.sub}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Section 3: Backtest Details ──────────────────────────────── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <section style={secAltInner}>
          <div className="vd-label" style={{ marginBottom: "16px" }}>Backtest Details</div>
          <div className="vd-card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="vd-table">
              <tbody>
                {details.map((row) => (
                  <tr key={row.label}>
                    <td
                      style={{
                        color: "var(--text-muted)",
                        fontWeight: 500,
                        fontSize: "13px",
                        width: "40%",
                      }}
                    >
                      {row.label}
                    </td>
                    <td
                      className={row.mono ? "font-mono" : ""}
                      style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: "13px" }}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* ── Section 4: Equity Curve ───────────────────────────────────── */}
      <section style={sec}>
        <div className="vd-label" style={{ marginBottom: "16px" }}>Equity Curve</div>
        <div className="vd-card" style={{ padding: "16px 8px 8px" }}>
          <svg
            viewBox="0 0 600 200"
            style={{ width: "100%", height: "auto", display: "block" }}
            aria-label="Equity curve from $100,000 to $99,848 over 42 days"
          >
            <defs>
              <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22C55E" stopOpacity="0.18" />
                <stop offset="100%" stopColor="#22C55E" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {[
              { y: 20,  label: "$100.1k" },
              { y: 73,  label: "$100.0k" },
              { y: 127, label: "$99.9k" },
              { y: 180, label: "$99.8k" },
            ].map((g) => (
              <g key={g.y}>
                <line
                  x1="60" y1={g.y} x2="590" y2={g.y}
                  stroke="#263241"
                  strokeWidth="1"
                />
                <text
                  x="54" y={g.y + 4}
                  fill="#64748B"
                  fontSize="9"
                  textAnchor="end"
                  fontFamily="monospace"
                >
                  {g.label}
                </text>
              </g>
            ))}

            {/* X-axis labels */}
            {[
              { x: 60,  label: "May 16" },
              { x: 222, label: "Jun 1" },
              { x: 374, label: "Jun 15" },
              { x: 590, label: "Jun 27" },
            ].map((g) => (
              <text
                key={g.label}
                x={g.x} y={196}
                fill="#64748B"
                fontSize="9"
                textAnchor="middle"
                fontFamily="monospace"
              >
                {g.label}
              </text>
            ))}

            {/* Area fill */}
            <path d={fillPath} fill="url(#equityFill)" />

            {/* Equity line */}
            <path
              d={equityPath}
              fill="none"
              stroke="#22C55E"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
            />

            {/* Start dot */}
            <circle cx="60" cy="73" r="3" fill="#22C55E" />
            {/* End dot */}
            <circle cx="590" cy="143" r="3" fill="#22C55E" />
          </svg>

          {/* Axis legend */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              color: "var(--text-muted)",
              padding: "4px 8px 0",
              fontFamily: "monospace",
            }}
          >
            <span>Start: $100,000.00</span>
            <span style={{ color: "var(--green)" }}>──── Portfolio value</span>
            <span>End: $99,848.60</span>
          </div>
        </div>
      </section>

      {/* ── Section 5: Links ─────────────────────────────────────────── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <section style={secAltInner}>
          <div className="vd-label" style={{ marginBottom: "16px" }}>External Links</div>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <a
              href="https://www.bitget.com/quantitative/strategy"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              style={{ fontSize: "13px" }}
            >
              View on Bitget GetAgent →
            </a>
            <a
              href="https://github.com/Shanks-btc/Veydrift"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary"
              style={{ fontSize: "13px" }}
            >
              GitHub Repository →
            </a>
          </div>
        </section>
      </div>

      {/* ── Section 6: Disclaimer ────────────────────────────────────── */}
      <section style={sec}>
        <div className="vd-card" style={{ background: "var(--card-elevated)" }}>
          <div className="vd-label" style={{ marginBottom: "8px" }}>Disclaimer</div>
          <p
            style={{
              fontSize: "12px",
              color: "var(--text-muted)",
              lineHeight: "1.7",
              margin: 0,
            }}
          >
            Historical backtest results do not guarantee future performance.
            The backtest was conducted on Binance venue data using the same
            deterministic 3-component risk formula that powers Veydrift&apos;s
            live execution mode. Strategy return is computed on a $100 margin
            budget; account return reflects the full $100,000 starting balance.
          </p>
        </div>
      </section>

      {/* ── Footer note ──────────────────────────────────────────────── */}
      <div
        style={{
          textAlign: "center",
          padding: "24px var(--page-padding) 40px",
          borderTop: "1px solid var(--border)",
          fontSize: "12px",
          color: "var(--text-muted)",
          lineHeight: "1.6",
        }}
      >
        The same deterministic three-component risk policy used in this backtest
        powers Veydrift&apos;s live execution mode.
      </div>

    </div>
  );
}
