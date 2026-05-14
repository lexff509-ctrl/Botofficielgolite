/**
 * Simulation V6 — Pipeline complet
 * Tests: TechnicalAnalysisAgent + MTFAnalysisAgent + MarketSentimentAgent + ConfidenceAgent
 * 
 * Exécution: npx ts-node --project tsconfig.json -e "require('./src/scripts/simulate-v6.ts')"
 * Ou via: npm run simulate (si script configuré)
 */

import { TechnicalAnalysisAgent } from "../core/agents/TechnicalAnalysisAgent";
import { ConfidenceAgent } from "../core/agents/ConfidenceAgent";
import { MTFAnalysisAgent } from "../core/agents/MTFAnalysisAgent";
import { MarketSentimentAgent } from "../core/agents/MarketSentimentAgent";
import { OrchestratorAgent } from "../core/agents/OrchestratorAgent";
import { Candle } from "../core/agents/types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function pad(s: string, len = 50) { return s.padEnd(len); }

function generateCandles(
  startPrice: number,
  trend: "UP" | "DOWN" | "FLAT",
  count = 100,
  volatility = 0.0010
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const noise = (Math.random() - 0.5) * volatility;
    const drift = trend === "UP" ? volatility * 0.4 : trend === "DOWN" ? -volatility * 0.4 : 0;
    const open = price;
    const close = Math.max(0.0001, price + drift + noise);
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low  = Math.min(open, close) - Math.random() * volatility * 0.5;
    candles.push({
      timestamp: now - (count - i) * 60000,
      open, close, high, low,
      volume: Math.round(100 + Math.random() * 500)
    });
    price = close;
  }
  return candles;
}

function addPinbarBottom(candles: Candle[]): Candle[] {
  const last = candles[candles.length - 1];
  candles.push({
    timestamp: Date.now() - 120000,
    open: last.close, close: last.close + 0.0005,
    high: last.close + 0.0008,
    low: last.close - 0.0060, // Long lower wick = bullish rejection
    volume: 900
  });
  candles.push({
    timestamp: Date.now() - 60000,
    open: last.close + 0.0005, close: last.close + 0.0020,
    high: last.close + 0.0025, low: last.close - 0.0002,
    volume: 700
  });
  return candles;
}

function addBearEngulfing(candles: Candle[]): Candle[] {
  const last = candles[candles.length - 1];
  candles.push({
    timestamp: Date.now() - 120000,
    open: last.close, close: last.close + 0.0020,
    high: last.close + 0.0025, low: last.close - 0.0002,
    volume: 400
  });
  candles.push({
    timestamp: Date.now() - 60000,
    open: last.close + 0.0025, close: last.close - 0.0015, // Big bearish candle
    high: last.close + 0.0030, low: last.close - 0.0020,
    volume: 1100
  });
  return candles;
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

const SCENARIOS: Array<{
  name: string;
  icon: string;
  candles: Candle[];
  asset: string;
  timeframe: string;
  expectedSignal: "BUY" | "SELL" | "WAIT";
}> = [
  {
    name: "ACHAT PARFAIT — Uptrend + Rejet Support (Pinbar)",
    icon: "🟢",
    candles: addPinbarBottom(generateCandles(1.1000, "UP", 100, 0.0008)),
    asset: "EUR/USD",
    timeframe: "1m",
    expectedSignal: "BUY"
  },
  {
    name: "VENTE PARFAITE — Downtrend + Rejet Résistance (Engulfing)",
    icon: "🔴",
    candles: addBearEngulfing(generateCandles(1.1000, "DOWN", 100, 0.0008)),
    asset: "GBP/USD",
    timeframe: "1m",
    expectedSignal: "SELL"
  },
  {
    name: "RANGE MORT — Volatilité nulle (Doit WAIT)",
    icon: "⚪",
    candles: generateCandles(1.1000, "FLAT", 100, 0.00005),
    asset: "EUR/USD",
    timeframe: "1m",
    expectedSignal: "WAIT"
  },
  {
    name: "OTC — Peu de bougies (fallback moteur classique)",
    icon: "🟡",
    candles: generateCandles(1.1000, "UP", 7, 0.0010), // 7 bougies < 10 → fallback
    asset: "EUR/USD (OTC)",
    timeframe: "1m",
    expectedSignal: "BUY"
  },
  {
    name: "CRYPTO — BTC Uptrend (Fear & Greed attendu)",
    icon: "🔵",
    candles: generateCandles(65000, "UP", 100, 200),
    asset: "BTC/USD",
    timeframe: "1m",
    expectedSignal: "BUY"
  }
];

// ─── Runner ──────────────────────────────────────────────────────────────────

async function runSimulation() {
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║     🧪 SIMULATION IA V6 — PIPELINE COMPLET                  ║");
  console.log("║     MTF + Sentiment + ConfidenceAgent + TechnicalAgent       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  let passed = 0;
  let total  = SCENARIOS.length;

  for (const sc of SCENARIOS) {
    console.log(`\n┌─ ${sc.icon} ${sc.name}`);
    console.log(`│  Asset: ${sc.asset} | TF: ${sc.timeframe} | Bougies: ${sc.candles.length}`);
    console.log("│");

    try {
      // Scénario OTC (< 10 bougies) : utilise directement OrchestratorAgent avec fallback
      if (sc.candles.length < 10) {
        const result = await OrchestratorAgent.evaluate(sc.candles, sc.asset, sc.timeframe, true);
        const ok = result.signal === sc.expectedSignal;
        console.log(`│  [Fallback OrchestratorAgent]`);
        console.log(`│  ╔══ VERDICT FINAL V6 ══════════════════════════════════`);
        console.log(`│  ║  Signal   : ${result.signal === "BUY" ? "🟢" : result.signal === "SELL" ? "🔴" : "⚪"} ${result.signal}`);
        console.log(`│  ║  Score    : ${result.score}% (${result.confidence})`);
        console.log(`│  ║  Raison   : ${result.reason.slice(0, 80)}`);
        console.log(`│  ║  Attendu  : ${sc.expectedSignal} → ${ok ? "✅ CORRECT" : "❌ INATTENDU"}`);
        console.log(`│  ╚══════════════════════════════════════════════════════`);
        if (ok) passed++;
        continue;
      }
      // ── Agent 1: TechnicalAnalysis ───────────────────────────────────
      const marketState = TechnicalAnalysisAgent.analyze(sc.candles, sc.asset, sc.timeframe);
      const ind = marketState.indicators;
      const str = marketState.structure;
      console.log(`│  [Agent 1 — Technique]`);
      console.log(`│    Trend: ${str.trend.padEnd(10)} | Force: ${str.trendStrength.toFixed(0).padEnd(6)} | Vol: ${str.volatility}`);
      console.log(`│    RSI: ${ind.rsi.toFixed(1).padEnd(7)} | EMA9: ${ind.ema9.toFixed(5)} | EMA21: ${ind.ema21.toFixed(5)}`);
      console.log(`│    Support⬇: ${str.isNearSupport} | Resist⬆: ${str.isNearResistance}`);
      console.log(`│    PinbarBull: ${marketState.priceAction.isBullishPinbar} | PinbarBear: ${marketState.priceAction.isBearishPinbar}`);
      console.log(`│    EngulfBull: ${marketState.priceAction.isBullishEngulfing} | EngulfBear: ${marketState.priceAction.isBearishEngulfing}`);

      // ── Agent 2: MTF ─────────────────────────────────────────────────
      const mtf = MTFAnalysisAgent.analyze(sc.candles, sc.timeframe);
      console.log(`│`);
      console.log(`│  [Agent 2 — Multi-Timeframe]`);
      console.log(`│    HTF1: ${mtf.htf1Trend.padEnd(10)} | HTF2: ${mtf.htf2Trend.padEnd(10)} | Alignment: ${mtf.alignmentScore > 0 ? "+" : ""}${mtf.alignmentScore}`);
      console.log(`│    Confirmation: ${mtf.confirmation}`);

      // ── Agent 3: Sentiment ────────────────────────────────────────────
      const sentiment = await MarketSentimentAgent.analyze(sc.asset, null, ind.rsi);
      console.log(`│`);
      console.log(`│  [Agent 3 — Sentiment Marché]`);
      console.log(`│    Score: ${sentiment.finalScore > 0 ? "+" : ""}${sentiment.finalScore}/100 | Bias: ${sentiment.bias} | Confiance: ${sentiment.confidence}%`);
      sentiment.sources.forEach(s => console.log(`│    • ${s.source}: ${s.label}`));

      // ── Agent 4: ConfidenceAgent ───────────────────────────────────
      const decision = ConfidenceAgent.evaluate(marketState);
      console.log(`│`);
      console.log(`│  [Agent 4 — ConfidenceAgent Base]`);
      console.log(`│    Action: ${decision.action.padEnd(6)} | Score: ${decision.confidence}% | Force: ${decision.strength}`);

      // ── Ajustements MTF + Sentiment ───────────────────────────────
      let adjustedScore = decision.confidence;
      const signalBias = decision.action === "BUY" ? "BULLISH" : "BEARISH";
      const adjustments: string[] = [];

      if (decision.action !== "WAIT") {
        if (mtf.confirmation === "STRONG" && mtf.htf1Trend === signalBias) {
          adjustedScore += 12; adjustments.push("+12 MTF Strong");
        } else if (mtf.confirmation === "MODERATE" && mtf.htf1Trend === signalBias) {
          adjustedScore += 6; adjustments.push("+6 MTF Moderate");
        } else if (mtf.confirmation === "CONFLICT") {
          adjustedScore -= 12; adjustments.push("-12 MTF Conflict");
        } else if (mtf.htf1Trend !== "NEUTRAL" && mtf.htf1Trend !== signalBias) {
          adjustedScore -= 8; adjustments.push("-8 MTF Opposed");
        }
        if (sentiment.bias === signalBias && sentiment.confidence >= 40) {
          adjustedScore += 8; adjustments.push("+8 Sentiment ✓");
        } else if (sentiment.bias !== "NEUTRAL" && sentiment.bias !== signalBias && sentiment.confidence >= 40) {
          adjustedScore -= 8; adjustments.push("-8 Sentiment ✗");
        }
      }
      adjustedScore = Math.max(0, Math.min(100, Math.round(adjustedScore)));
      const finalAction = adjustedScore < 48 ? "WAIT" : decision.action;
      const finalConf   = adjustedScore >= 75 ? "HIGH" : adjustedScore >= 60 ? "MEDIUM" : "LOW";

      // ── Verdict Final ─────────────────────────────────────────────
      const icon = finalAction === "BUY" ? "🟢" : finalAction === "SELL" ? "🔴" : "⚪";
      const ok   = finalAction === sc.expectedSignal;
      console.log(`│`);
      console.log(`│  ╔══ VERDICT FINAL V6 ══════════════════════════════════`);
      console.log(`│  ║  Signal   : ${icon} ${finalAction}`);
      console.log(`│  ║  Score    : ${adjustedScore}% (${finalConf}) [Base: ${decision.confidence}% → Ajust: ${adjustments.join(", ") || "aucun"}]`);
      console.log(`│  ║  Attendu  : ${sc.expectedSignal} → ${ok ? "✅ CORRECT" : "❌ INATTENDU"}`);
      console.log(`│  ╚══════════════════════════════════════════════════════`);

      if (ok) passed++;

    } catch (e: any) {
      console.log(`│  ❌ ERREUR: ${e.message}`);
    }
  }

  // ── Résumé ─────────────────────────────────────────────────────────────
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log(`║  📊 RÉSULTAT: ${passed}/${total} scénarios corrects ${passed === total ? "🏆 PARFAIT" : passed >= total * 0.8 ? "✅ BON" : "⚠️ À AMÉLIORER"}`);
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

runSimulation().catch(console.error);
