/**
 * SkillsAgent — Expert Advisor Panel V6
 *
 * Collection of domain-expert prompts embedded as TypeScript functions.
 * Each advisor returns a structured analysis object that can be injected
 * into the main pipeline at any point to get specialist guidance.
 *
 * Usage:
 *   import { SkillsAgent } from "@/core/agents/SkillsAgent";
 *   const advice = await SkillsAgent.consult("WEBSOCKET_SAFETY", context);
 */

export type SkillDomain =
  | "BOT_DEVELOPMENT"
  | "WEBSOCKET_SAFETY"
  | "TRADING_STRATEGY"
  | "TECHNICAL_ANALYSIS"
  | "RISK_MANAGEMENT"
  | "PERFORMANCE_OPTIMIZATION"
  | "DEBUG_AND_FIX"
  | "CODE_ORGANIZATION"
  | "SECURITY"
  | "API_INTEGRATION";

export interface ExpertAdvice {
  domain: SkillDomain;
  severity: "INFO" | "WARNING" | "CRITICAL";
  diagnosis: string;
  recommendation: string;
  codeHint?: string;
  shouldBlock: boolean; // true = block pipeline until resolved
}

export interface SkillContext {
  errorMessage?: string;
  wsState?: string;
  hostCount?: number;
  reachableHosts?: number;
  candleCount?: number;
  ssidStatus?: string;
  score?: number;
  volatility?: string;
  reconnectAttempts?: number;
  asset?: string;
  payload?: Record<string, unknown>;
}

// ── Expert Advisor Definitions ─────────────────────────────────────────────────

const ADVISORS: Record<SkillDomain, (ctx: SkillContext) => ExpertAdvice> = {

  BOT_DEVELOPMENT: (ctx) => {
    const hasError = !!ctx.errorMessage;
    return {
      domain: "BOT_DEVELOPMENT",
      severity: hasError ? "WARNING" : "INFO",
      diagnosis: hasError
        ? `Bot error detected: ${ctx.errorMessage}`
        : "Bot lifecycle nominal.",
      recommendation: hasError
        ? "Ensure BotRunner tick loop is guarded by isTickRunning flag. Verify resume() resets reconnectAttempts."
        : "Bot is operating normally. Monitor consecutiveErrors counter.",
      codeHint: "if (this.isTickRunning) return; this.isTickRunning = true; try { await this.tick(); } finally { this.isTickRunning = false; }",
      shouldBlock: false,
    };
  },

  WEBSOCKET_SAFETY: (ctx) => {
    const isCrash = ctx.errorMessage?.includes("closed before") || ctx.wsState === "CLOSED";
    return {
      domain: "WEBSOCKET_SAFETY",
      severity: isCrash ? "CRITICAL" : "INFO",
      diagnosis: isCrash
        ? `WebSocket crash detected: "${ctx.errorMessage}". Socket closed before READY.`
        : `WebSocket state: ${ctx.wsState ?? "unknown"}`,
      recommendation: isCrash
        ? "Wrap all ws.close() / ws.terminate() in try/catch inside setTimeout. Never call methods on a WS that is CLOSING or CLOSED."
        : "WebSocket stable. Heartbeat pong monitoring active.",
      codeHint: `setTimeout(() => { try { if (ws.readyState !== WebSocket.CLOSED) ws.close(); } catch(e) { console.warn(e.message); } }, 200);`,
      shouldBlock: isCrash,
    };
  },

  TRADING_STRATEGY: (ctx) => {
    const score = ctx.score ?? 0;
    const mode = score >= 70 ? "AGGRESSIVE" : score >= 40 ? "BALANCED" : "DEFENSIVE";
    const canTrade = score >= 50;
    return {
      domain: "TRADING_STRATEGY",
      severity: !canTrade ? "WARNING" : "INFO",
      diagnosis: `Score: ${score}/100 → Mode: ${mode}. ${!canTrade ? "Below minimum threshold (50)." : "Trade eligible."}`,
      recommendation: !canTrade
        ? "Score too low. Wait for stronger convergence (RSI + MTF + Sentiment alignment)."
        : `Proceed with ${mode} mode. Min threshold met.`,
      codeHint: "signal = score >= 65 ? evaluate() : score >= 50 && mode === 'AGGRESSIVE' ? evaluate() : 'no_trade'",
      shouldBlock: !canTrade,
    };
  },

  TECHNICAL_ANALYSIS: (ctx) => {
    const candles = ctx.candleCount ?? 0;
    const lowData = candles < 30;
    return {
      domain: "TECHNICAL_ANALYSIS",
      severity: lowData ? "WARNING" : "INFO",
      diagnosis: lowData
        ? `Insufficient candle data: ${candles} candles (need ≥30 for reliable indicators).`
        : `Data quality OK: ${candles} candles available.`,
      recommendation: lowData
        ? "Bootstrap historical candles via client.requestCandleHistory() before running TA pipeline."
        : "EMA/RSI/MACD/Bollinger computable. Proceed with analysis.",
      codeHint: "if (candles.length < 30) { const hist = await client.requestCandleHistory(asset, period, 200); candleCache.seedCandles(asset, period, hist); }",
      shouldBlock: lowData,
    };
  },

  RISK_MANAGEMENT: (ctx) => {
    const vol = ctx.volatility ?? "NORMAL";
    const isHighRisk = vol === "HIGH";
    return {
      domain: "RISK_MANAGEMENT",
      severity: isHighRisk ? "WARNING" : "INFO",
      diagnosis: `Volatility: ${vol}. ${isHighRisk ? "High volatility detected — consider reducing position size." : "Risk levels nominal."}`,
      recommendation: isHighRisk
        ? "Apply OTC multiplier 0.3×. Cap trade amount to 1% of balance. Widen stop tolerance."
        : "Standard sizing applicable. Volatility engine: LOW=-10pts, NORMAL=0, HIGH=+15pts (never blocks).",
      codeHint: "const sizeMultiplier = isOtc ? 0.3 : vol === 'HIGH' ? 1.5 : 1.0;",
      shouldBlock: false,
    };
  },

  PERFORMANCE_OPTIMIZATION: (ctx) => {
    const reconnects = ctx.reconnectAttempts ?? 0;
    const isSpamming = reconnects > 5;
    return {
      domain: "PERFORMANCE_OPTIMIZATION",
      severity: isSpamming ? "WARNING" : "INFO",
      diagnosis: isSpamming
        ? `Reconnect storm: ${reconnects} attempts. Risk of CPU saturation and rate-limit.`
        : "Performance nominal.",
      recommendation: isSpamming
        ? "Apply exponential backoff: [5s, 10s, 20s, 30s, 60s, 120s] + ±20% jitter. Enter COOLDOWN after 6 failures."
        : "Use sequential host discovery batches (3 at a time) to avoid socket exhaustion.",
      codeHint: "const delay = BACKOFF[Math.min(attempt, BACKOFF.length-1)] * (0.8 + Math.random() * 0.4);",
      shouldBlock: false,
    };
  },

  DEBUG_AND_FIX: (ctx) => {
    const isBlackout = (ctx.reachableHosts ?? 1) === 0;
    return {
      domain: "DEBUG_AND_FIX",
      severity: isBlackout ? "CRITICAL" : "INFO",
      diagnosis: isBlackout
        ? `Network blackout: 0/${ctx.hostCount ?? "?"} hosts reachable. Likely Render rate-limit from parallel pings.`
        : "Network connectivity OK.",
      recommendation: isBlackout
        ? "Switch from parallel to sequential batch discovery (3 hosts/batch). Add 60s COOLDOWN on full failure. Use cached fallback hosts."
        : "Host cache valid. No discovery needed until TTL expires (5min).",
      codeHint: "for (let i=0; i<hosts.length; i+=3) { const batch = hosts.slice(i,i+3); const results = await Promise.all(batch.map(testHost)); if (found>=2) break; }",
      shouldBlock: isBlackout,
    };
  },

  CODE_ORGANIZATION: (_ctx) => ({
    domain: "CODE_ORGANIZATION",
    severity: "INFO",
    diagnosis: "Architecture check: ensure separation of Connection, Strategy, Execution layers.",
    recommendation: [
      "ConnectionManager   → IDLE/CONNECTING/READY/RECONNECTING/COOLDOWN/BLOCKED",
      "DataPipeline        → Raw→Validator→CandleBuilder→GapDetector→StableBuffer",
      "StrategyEngineV6    → Stateless pure function (no WebSocket knowledge)",
      "ExecutionLayer      → Only executes signals, does not compute anything",
      "SimulationEngine    → Mirrors real trades, never executes real orders",
    ].join("\n"),
    shouldBlock: false,
  }),

  SECURITY: (ctx) => {
    const ssidOk = ctx.ssidStatus === "VALID";
    return {
      domain: "SECURITY",
      severity: !ssidOk ? "WARNING" : "INFO",
      diagnosis: !ssidOk
        ? `SSID status: ${ctx.ssidStatus}. Session may be invalid or expired.`
        : "SSID valid. Session encrypted in DB.",
      recommendation: !ssidOk
        ? "SSID auto-refresh via Bridge only. Never retry expired SSID more than once. Enter BLOCKED state and await Bridge sync."
        : "SSID lifecycle: Bridge→encryptSSID→DB→decryptSSID→connect. Rotation on each Bridge sync.",
      codeHint: "client.onSsidExpired(() => { state = 'BLOCKED'; updateSsidStatus(userId, 'EXPIRED'); });",
      shouldBlock: ctx.ssidStatus === "EXPIRED",
    };
  },

  API_INTEGRATION: (ctx) => {
    const reachable = (ctx.reachableHosts ?? 1) > 0;
    return {
      domain: "API_INTEGRATION",
      severity: !reachable ? "CRITICAL" : "INFO",
      diagnosis: !reachable
        ? "PocketOption API unreachable. All hosts failed discovery."
        : `API connected. Host pool active (${ctx.reachableHosts} hosts).`,
      recommendation: !reachable
        ? "1. Check Render outbound firewall rules.\n2. Use sequential discovery.\n3. Fallback to LEGACY_HOSTS if all fail.\n4. Bridge extension is alternative session source."
        : "Host scoring active. Lowest-latency host selected automatically.",
      codeHint: "const fallback = isDemo ? 'demo-api-eu.po.market' : 'api-eu.po.market'; return [fallback];",
      shouldBlock: !reachable,
    };
  },
};

// ── Main Entry Point ───────────────────────────────────────────────────────────

export class SkillsAgent {
  /**
   * Consult a specific expert advisor.
   */
  static consult(domain: SkillDomain, context: SkillContext = {}): ExpertAdvice {
    const advisor = ADVISORS[domain];
    if (!advisor) {
      return {
        domain,
        severity: "INFO",
        diagnosis: "Unknown domain.",
        recommendation: "No advisor available for this domain.",
        shouldBlock: false,
      };
    }
    return advisor(context);
  }

  /**
   * Run all advisors at once — returns full system health report.
   * Blocks the pipeline if any CRITICAL advisor sets shouldBlock=true.
   */
  static fullDiagnostic(context: SkillContext): {
    advices: ExpertAdvice[];
    shouldBlock: boolean;
    criticals: string[];
    warnings: string[];
  } {
    const domains = Object.keys(ADVISORS) as SkillDomain[];
    const advices = domains.map(d => SkillsAgent.consult(d, context));
    const criticals = advices.filter(a => a.severity === "CRITICAL").map(a => `[${a.domain}] ${a.diagnosis}`);
    const warnings  = advices.filter(a => a.severity === "WARNING").map(a => `[${a.domain}] ${a.diagnosis}`);
    const shouldBlock = advices.some(a => a.shouldBlock);
    return { advices, shouldBlock, criticals, warnings };
  }
}
