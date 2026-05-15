/**
 * StrategyEngineV6 — M4/M5 (Stateless)
 * 
 * Pure function engine: takes market inputs, returns signal.
 * NO knowledge of WebSocket, ConnectionManager, or BotRunner.
 * 
 * Adaptive modes:
 *   AGGRESSIVE  → score > 70 required for non-aggressive mode, 50+ allowed
 *   BALANCED    → score ≥ 65 required
 *   DEFENSIVE   → score ≥ 75 required
 * 
 * Volatility Engine (M6):
 *   LOW   = -10 pts
 *   MEDIUM =  0 pts
 *   HIGH  = +15 pts
 *   Never blocks — adjusts score only
 */

export type SignalOutput = "signal_buy" | "signal_sell" | "no_trade";
export type AdaptiveMode = "BALANCED" | "AGGRESSIVE" | "DEFENSIVE";

export interface StrategyInput {
  candles: Array<{
    open: number; high: number; low: number;
    close: number; volume: number; timestamp: number;
  }>;
  asset: string;
  timeframe: string;
  isOtc?: boolean;
  mode?: AdaptiveMode;  // override, else auto-detected from market_quality_score
}

export interface StrategyOutput {
  signal: SignalOutput;
  score: number;
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  adaptiveMode: AdaptiveMode;
  volatilityAdjustment: number;
  metrics: Record<string, number | string>;
  timestamp: number;
}

// ── M6: Volatility Engine ──────────────────────────────────────────────────────
function computeVolatilityAdjustment(
  bollingerWidth: number,
  isOtc: boolean
): { adjustment: number; label: string } {
  let level: "LOW" | "MEDIUM" | "HIGH" = "MEDIUM";
  if (bollingerWidth > 0.005) level = "HIGH";
  else if (bollingerWidth < 0.0004) level = "LOW";

  const otcMultiplier = isOtc ? 0.3 : 1.0;
  const baseAdjustment = level === "HIGH" ? 15 : level === "LOW" ? -10 : 0;
  const highVolMultiplier = level === "HIGH" ? 1.5 : 1.0;

  const adjustment = Math.round(baseAdjustment * otcMultiplier * highVolMultiplier);
  return { adjustment, label: `Vol ${level} (${adjustment > 0 ? "+" : ""}${adjustment}pts)` };
}

// ── M7: Market State Aggregator ────────────────────────────────────────────────
export interface MarketStateV6 {
  trend_strength: number;    // 0-100
  volatility: number;        // -10 | 0 | +15
  alignment: number;         // MTF alignment score
  sentiment: number;         // -100 to +100
  noise_level: number;       // 0-100 (inverse of signal quality)
  market_quality_score: number; // composite 0-100
}

function computeMarketState(
  trendStrength: number,
  volatilityAdj: number,
  mtfAlignment: number,
  sentimentScore: number,
  mqsRaw: number
): MarketStateV6 {
  const noiseLevel = Math.max(0, 100 - trendStrength - Math.abs(sentimentScore) * 0.2);
  const normalizedAlignment = Math.max(0, Math.min(100, 50 + mtfAlignment));
  const market_quality_score = Math.round(
    (mqsRaw * 0.4) +
    (trendStrength * 0.3) +
    (normalizedAlignment * 0.2) +
    (Math.abs(sentimentScore) * 0.1)
  );
  return {
    trend_strength: trendStrength,
    volatility: volatilityAdj,
    alignment: mtfAlignment,
    sentiment: sentimentScore,
    noise_level: Math.round(noiseLevel),
    market_quality_score: Math.min(100, market_quality_score),
  };
}

// ── M8: Adaptive Mode System ───────────────────────────────────────────────────
function detectAdaptiveMode(marketQualityScore: number, override?: AdaptiveMode): AdaptiveMode {
  if (override) return override;
  if (marketQualityScore >= 70) return "AGGRESSIVE";
  if (marketQualityScore >= 40) return "BALANCED";
  return "DEFENSIVE";
}

function getScoreThreshold(mode: AdaptiveMode): { min: number; aggressiveMin: number } {
  switch (mode) {
    case "AGGRESSIVE":  return { min: 50, aggressiveMin: 50 };
    case "BALANCED":    return { min: 65, aggressiveMin: 65 };
    case "DEFENSIVE":   return { min: 75, aggressiveMin: 75 };
  }
}

// ── Main Entry Point ───────────────────────────────────────────────────────────
export class StrategyEngineV6 {
  /**
   * Pure stateless evaluation.
   * Returns signal + full reasoning. Never throws — returns no_trade on any error.
   */
  public static async evaluate(input: StrategyInput): Promise<StrategyOutput> {
    const ts = Date.now();

    try {
      const { OrchestratorAgent } = await import("@/core/agents/OrchestratorAgent");

      const result = await OrchestratorAgent.evaluate(
        input.candles as any,
        input.asset,
        input.timeframe,
        input.isOtc ?? false
      );

      // M6: Volatility adjustment
      const bollingerWidth = (result.marketState as any)?.indicators?.bollinger?.width ?? 0.002;
      const { adjustment: volAdj, label: volLabel } = computeVolatilityAdjustment(
        bollingerWidth,
        input.isOtc ?? false
      );

      // Apply volatility adjustment to score
      const rawScore = result.score;
      const adjustedScore = Math.max(0, Math.min(100, rawScore + volAdj));

      // M7: Market State
      const marketState = computeMarketState(
        (result.marketState as any)?.structure?.trendStrength ?? 50,
        volAdj,
        result.metrics?.mtfAlignment ?? 0,
        result.sentiment?.finalScore ?? 0,
        (result.marketState as any)?.marketQuality ?? 50
      );

      // M8: Adaptive Mode
      const adaptiveMode = detectAdaptiveMode(marketState.market_quality_score, input.mode);
      const threshold = getScoreThreshold(adaptiveMode);

      // Decision
      let signal: SignalOutput = "no_trade";
      if (result.signal !== "WAIT" && adjustedScore >= threshold.min) {
        signal = result.signal === "BUY" ? "signal_buy" : "signal_sell";
      }

      const confidence: "HIGH" | "MEDIUM" | "LOW" =
        adjustedScore >= 75 ? "HIGH" : adjustedScore >= 60 ? "MEDIUM" : "LOW";

      const reason = [
        `[V6/${adaptiveMode}] ${signal} (${adjustedScore}%)`,
        volLabel,
        `MQS:${marketState.market_quality_score}`,
        result.reason,
      ].join(" | ");

      return {
        signal,
        score: adjustedScore,
        reason,
        confidence,
        adaptiveMode,
        volatilityAdjustment: volAdj,
        metrics: {
          rawScore,
          trendStrength: marketState.trend_strength,
          noiseLevel: marketState.noise_level,
          mtfAlignment: marketState.alignment,
          sentimentScore: marketState.sentiment,
          mqScore: marketState.market_quality_score,
        },
        timestamp: ts,
      };

    } catch (err: any) {
      return {
        signal: "no_trade",
        score: 0,
        reason: `[V6] Erreur pipeline: ${err.message}`,
        confidence: "LOW",
        adaptiveMode: input.mode ?? "BALANCED",
        volatilityAdjustment: 0,
        metrics: {},
        timestamp: ts,
      };
    }
  }
}
