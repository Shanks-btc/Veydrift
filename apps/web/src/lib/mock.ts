import type {
  AgentState,
  PortfolioValuePoint,
  DrawdownPoint,
  SwapLogRow,
} from "@veydrift/shared";

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoAt(minsAgo: number): string {
  return new Date(Date.now() - minsAgo * 60_000).toISOString();
}

// ── Portfolio value series (last 24 h, ~5-min resolution) ────────────────────

const portfolioSeries: PortfolioValuePoint[] = Array.from(
  { length: 288 },
  (_, i) => {
    const base = 4_218.5;
    const noise = Math.sin(i / 20) * 80 + Math.sin(i / 7) * 30;
    return {
      timestamp: isoAt((287 - i) * 5),
      valueUsd: +(base + noise + i * 0.12).toFixed(2),
    };
  }
);

// ── Drawdown series ──────────────────────────────────────────────────────────

const drawdownSeries: DrawdownPoint[] = Array.from({ length: 288 }, (_, i) => {
  const v = -Math.abs(Math.sin(i / 40) * 6 + Math.sin(i / 15) * 2);
  return { timestamp: isoAt((287 - i) * 5), drawdownPct: +v.toFixed(2) };
});

// ── Swap log ─────────────────────────────────────────────────────────────────

const mockSwapLog: SwapLogRow[] = [
  {
    id: "sl-001",
    timestamp: isoAt(8),
    mode: "Risk-on",
    action: "Buy",
    fromAsset: "USDT",
    toAsset: "ETH",
    sizeIn: 120,
    valueUsd: 120.0,
    reason: "R=0.12 (low), rotating to volatile; rebalance band exceeded",
    txHash: "0xabc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
    explorerUrl:
      "https://bscscan.com/tx/0xabc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
  },
  {
    id: "sl-002",
    timestamp: isoAt(62),
    mode: "Neutral",
    action: "Rebalance",
    fromAsset: "ETH",
    toAsset: "USDC",
    sizeIn: 0.04,
    valueUsd: 68.8,
    reason: "R=0.41, neutral mode; trimming volatile excess",
    txHash: "0xdef456abc789012345678901234567890123456789012345678901234567890123",
    explorerUrl:
      "https://bscscan.com/tx/0xdef456abc789012345678901234567890123456789012345678901234567890123",
  },
  {
    id: "sl-003",
    timestamp: isoAt(130),
    mode: "Risk-off",
    action: "Sell",
    fromAsset: "CAKE",
    toAsset: "USDT",
    sizeIn: 22,
    valueUsd: 49.5,
    reason: "R=0.71, risk-off mode; rotating CAKE to stables",
    txHash: "0x789abc012def345678901234567890123456789012345678901234567890123456",
    explorerUrl:
      "https://bscscan.com/tx/0x789abc012def345678901234567890123456789012345678901234567890123456",
  },
  {
    id: "sl-004",
    timestamp: isoAt(195),
    mode: "Risk-on",
    action: "Hold",
    fromAsset: "ETH",
    toAsset: "ETH",
    sizeIn: 0,
    valueUsd: 0,
    reason: "R=0.22, within rebalance band; holding current allocation",
    txHash: null,
    explorerUrl: null,
  },
  {
    id: "sl-005",
    timestamp: isoAt(260),
    mode: "Neutral",
    action: "Buy",
    fromAsset: "USDC",
    toAsset: "LINK",
    sizeIn: 35,
    valueUsd: 35.0,
    reason: "R=0.38, neutral; LINK allocation below target",
    txHash: "0x012345abc678def901234567890123456789012345678901234567890123456789",
    explorerUrl:
      "https://bscscan.com/tx/0x012345abc678def901234567890123456789012345678901234567890123456789",
  },
];

// ── Full agent state ──────────────────────────────────────────────────────────

export const mockAgentState: AgentState = {
  status: "Running",
  mode: "Risk-on",
  walletAddress: "0x66af72374Eb358cf939bc1954b8F62EfcF08E10a",
  lastUpdated: isoAt(2),

  portfolioValue: {
    currentUsd: 4_234.78,
    change24hUsd: 83.42,
    change24hPct: 2.01,
    series: portfolioSeries,
  },

  pnl: {
    realizedUsd: 34.1,
    unrealizedUsd: 49.32,
    totalUsd: 83.42,
    change24hPct: 2.01,
  },

  exposure: {
    volatilePct: 78,
    stablePct: 20,
    gasPct: 2,
  },

  latestSwap: {
    id: "swap-001",
    timestamp: isoAt(8),
    fromAsset: "USDT",
    toAsset: "ETH",
    amountIn: 120,
    amountOut: 0.06982,
    valueUsd: 120.0,
    priceImpactPct: 0.01,
    slippagePct: 0.18,
    reason: "R=0.12 (low), rotating to volatile; rebalance band exceeded",
    txHash:
      "0xabc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
    explorerUrl:
      "https://bscscan.com/tx/0xabc123def456789abcdef0123456789abcdef0123456789abcdef0123456789ab",
  },

  drawdown: {
    currentPct: -4.2,
    limitPct: -12,
    killSwitchPct: -18,
    highWaterMarkUsd: 4_412.0,
    series: drawdownSeries,
  },

  holdings: [
    {
      asset: "ETH",
      role: "Volatile",
      balance: 1.312,
      valueUsd: 2_256.9,
      allocationPct: 53.3,
      change24hPct: 2.14,
    },
    {
      asset: "CAKE",
      role: "Volatile",
      balance: 148.5,
      valueUsd: 334.2,
      allocationPct: 7.9,
      change24hPct: -0.82,
    },
    {
      asset: "LINK",
      role: "Volatile",
      balance: 42.0,
      valueUsd: 710.1,
      allocationPct: 16.8,
      change24hPct: 1.37,
    },
    {
      asset: "USDT",
      role: "Stable",
      balance: 480.5,
      valueUsd: 480.5,
      allocationPct: 11.3,
      change24hPct: 0.01,
    },
    {
      asset: "USDC",
      role: "Stable",
      balance: 368.1,
      valueUsd: 368.1,
      allocationPct: 8.7,
      change24hPct: 0.0,
    },
    {
      asset: "BNB",
      role: "Gas",
      balance: 0.121,
      valueUsd: 84.98,
      allocationPct: 2.0,
      change24hPct: 0.55,
    },
  ],

  allocation: [
    { asset: "ETH", role: "Volatile", pct: 53.3, valueUsd: 2_256.9, color: "#627EEA" },
    { asset: "CAKE", role: "Volatile", pct: 7.9, valueUsd: 334.2, color: "#D1884F" },
    { asset: "LINK", role: "Volatile", pct: 16.8, valueUsd: 710.1, color: "#2A5ADA" },
    { asset: "USDT", role: "Stable", pct: 11.3, valueUsd: 480.5, color: "#26A17B" },
    { asset: "USDC", role: "Stable", pct: 8.7, valueUsd: 368.1, color: "#2775CA" },
    { asset: "BNB", role: "Gas", pct: 2.0, valueUsd: 84.98, color: "#F0B90B" },
  ],

  marketSignals: {
    fearGreed: 23,
    fearGreedLabel: "Fear",
    change1hPct: 0.24,
    change24hPct: 2.1,
    trend: "Bullish",
    assetPrice: 1_719.3,
    assetSymbol: "ETH",
  },

  riskScore: {
    R: 0.12,
    mode: "Risk-on",
    targetVolatilePct: 80,
    components: [
      { label: "1h Change", value: 0.24, contribution: 0.032 },
      { label: "24h Change", value: 2.1, contribution: 0.084 },
      { label: "Fear & Greed", value: 23, contribution: 0.0 },
    ],
  },

  proofTrail: [
    {
      id: "pt-001",
      type: "Decision",
      label: "Mode: Risk-on",
      timestamp: isoAt(2),
      verified: true,
      detail: "R=0.12, target 80% volatile",
    },
    {
      id: "pt-002",
      type: "SwapExecution",
      label: "First qualifying BSC swap",
      timestamp: "2026-06-19T08:00:00.000Z",
      txHash:
        "0x99ef6856cd679a65a7d7877b97bd5a4f525b98b0b61a2589481f2a108e6d9854",
      explorerUrl:
        "https://bscscan.com/tx/0x99ef6856cd679a65a7d7877b97bd5a4f525b98b0b61a2589481f2a108e6d9854",
      verified: true,
      detail: "minimum-risk qualifying attempt · BSC only · not Base/x402",
    },
    {
      id: "pt-003",
      type: "x402Confirmation",
      label: "x402 Paid Call",
      timestamp: isoAt(62),
      verified: false,
      detail: "Pending — fund-gated",
    },
    {
      id: "pt-004",
      type: "AgentIdentity",
      label: "Agent Identity — Registered",
      timestamp: "2026-06-01T12:00:00.000Z",
      txHash:
        "0x006151e42ceb1b151ddcd7b172b9dd2087cbabbe7fbe3a58c63274c3fa6ac305",
      explorerUrl:
        "https://bscscan.com/tx/0x006151e42ceb1b151ddcd7b172b9dd2087cbabbe7fbe3a58c63274c3fa6ac305",
      verified: true,
      detail: "0x66af72374Eb358cf939bc1954b8F62EfcF08E10a registered on BSC",
    },
    {
      id: "pt-005",
      type: "Network",
      label: "BNB Chain Mainnet",
      timestamp: isoAt(2),
      verified: true,
      detail: "chainId 56 · BSC · 3s block time",
    },
  ],

  x402: {
    totalConfirmed: 0,
    lastConfirmedAt: null,
    lastAmountUsdc: null,
    settlementChain: "Base",
  },

  swapLog: mockSwapLog,

  systemHealth: [
    { label: "Market Data (CMC)", status: "ok", detail: "Last fetched 2m ago" },
    { label: "Execution Engine (TWAK)", status: "ok", detail: "Auth confirmed" },
    { label: "Swap Quote", status: "ok", detail: "BSC quote 8m ago" },
    { label: "x402 Service", status: "warn", detail: "Not yet exercised" },
    { label: "Network (BSC)", status: "ok", detail: "chainId 56 reachable" },
    { label: "Wallet", status: "warn", detail: "Balance fetch pending re-verify" },
  ],
};
