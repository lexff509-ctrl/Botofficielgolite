/**
 * OrchestratorAgent — Pipeline IA complet V6
 * 
 * Architecture Multi-Couche :
 *   1. TechnicalAnalysisAgent  → MarketState (indicateurs bruts)
 *   2. MTFAnalysisAgent        → Alignement multi-timeframe
 *   3. NewsAgent               → Biais macro-économique
 *   4. MarketSentimentAgent    → Sentiment réel du marché (F&G + RSI + News)
 *   5. ConfidenceAgent         → Score de confiance final (avec bonus/malus MTF & Sentiment)
 */

import { TechnicalAnalysisAgent } from "./TechnicalAnalysisAgent";
import { ConfidenceAgent } from "./ConfidenceAgent";
import { NewsAgent } from "./NewsAgent";
import { MTFAnalysisAgent } from "./MTFAnalysisAgent";
import { MarketSentimentAgent } from "./MarketSentimentAgent";
import { Candle } from "./types";
import { evaluateBollingerStochSignal } from "@/lib/trading";

export class OrchestratorAgent {
  /**
   * Évalue un signal de trading en utilisant tous les agents IA.
   * Fallback automatique si données insuffisantes.
   */
  public static async evaluate(candles: Candle[], asset: string, timeframe: string, isOtc: boolean = false) {
    try {
      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 1 : Analyse Technique (Indicateurs bruts)
      // ═══════════════════════════════════════════════════════════════════
      const marketState = TechnicalAnalysisAgent.analyze(candles, asset, timeframe);

      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 2 : Analyse Multi-Timeframe (Trend HTF)
      // ═══════════════════════════════════════════════════════════════════
      const mtf = MTFAnalysisAgent.analyze(candles, timeframe);

      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 3 : Biais Macro (News) — parallèle avec Sentiment
      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 3 : News + Sentiment en parallèle (news d'abord, sentiment ensuite avec biais)
      // ═══════════════════════════════════════════════════════════════════
      const newsBias = await NewsAgent.analyze(asset);
      marketState.newsBias = newsBias;

      // Fix 4: Single Sentiment call (avec newsBias) — supprime le doublon inutile
      const sentimentFull = await MarketSentimentAgent.analyze(
        asset,
        newsBias,
        marketState.indicators.rsi
      );

      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 4 : Confidence Agent (Score de base)
      // ═══════════════════════════════════════════════════════════════════
      const decision = ConfidenceAgent.evaluate(marketState);

      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 5 : Ajustement MTF + Sentiment (Bonus/Malus)
      // ═══════════════════════════════════════════════════════════════════
      let adjustedScore = decision.confidence;
      const adjustmentReasons: string[] = [];

      // ── Guard: si ConfidenceAgent a déjà bloqué (WAIT forcé MQS), ne rien ajouter ──
      const volIsLow = marketState.structure?.volatility === "LOW";
      const mqsOk    = (decision.marketQuality ?? 100) >= 35;

      // — MTF Adjustments — (désactivé si vol LOW ou MQS mauvais)
      if (decision.action !== "WAIT" && !volIsLow && mqsOk) {
        const signalBias = decision.action === "BUY" ? "BULLISH" : "BEARISH";

        if (mtf.confirmation === "STRONG" && mtf.htf1Trend === signalBias) {
          adjustedScore += 12;
          adjustmentReasons.push(`+12 MTF Strong`);
        } else if (mtf.confirmation === "MODERATE" && mtf.htf1Trend === signalBias) {
          adjustedScore += 6;
          adjustmentReasons.push(`+6 MTF Moderate`);
        } else if (mtf.confirmation === "CONFLICT") {
          adjustedScore -= 12;
          adjustmentReasons.push(`-12 MTF Conflict`);
        } else if (mtf.htf1Trend !== "NEUTRAL" && mtf.htf1Trend !== signalBias) {
          adjustedScore -= 8;
          adjustmentReasons.push(`-8 MTF Opposed`);
        }
      } else if (volIsLow) {
        adjustmentReasons.push(`MTF bonus désactivé (Vol LOW)`);
      }

      // — Sentiment Adjustments — (max ±5 pts, secondaire uniquement, jamais seul) —
      if (decision.action !== "WAIT" && !volIsLow && mqsOk) {
        const signalBias = decision.action === "BUY" ? "BULLISH" : "BEARISH";
        const MAX_SENTIMENT = 5; // Sentiment ne peut jamais transformer WAIT→signal seul

        if (sentimentFull.bias === signalBias && sentimentFull.confidence >= 40) {
          adjustedScore += MAX_SENTIMENT;
          adjustmentReasons.push(`+${MAX_SENTIMENT} Sentiment ✓`);
        } else if (sentimentFull.bias !== "NEUTRAL" && sentimentFull.bias !== signalBias && sentimentFull.confidence >= 40) {
          adjustedScore -= MAX_SENTIMENT;
          adjustmentReasons.push(`-${MAX_SENTIMENT} Sentiment ✗`);
        }
      }

      adjustedScore = Math.max(0, Math.min(100, Math.round(adjustedScore)));

      // Final action: WAIT only if score is truly too low (after MTF/sentiment adjustments)
      // This allows MTF alignment to rescue a borderline 45% → 57% signal
      let finalAction = decision.action;
      if (adjustedScore < 48 || decision.action === "WAIT") {
        // Re-check: if MTF strongly agrees with one side, override weak WAIT
        const mtfBias = mtf.alignmentScore > 20 ? "BULLISH" : mtf.alignmentScore < -20 ? "BEARISH" : "NEUTRAL";
        if (mtfBias !== "NEUTRAL" && mtf.confirmation !== "CONFLICT" && adjustedScore >= 40) {
          finalAction = mtfBias === "BULLISH" ? "BUY" : "SELL";
          adjustedScore = Math.max(adjustedScore, 50);
          adjustmentReasons.push(`MTF override: ${mtfBias} (${mtf.alignmentScore}pts)`);
        } else {
          finalAction = "WAIT";
        }
      }

      const fullReason = [
        `[IA V6] ${finalAction} (${adjustedScore}%) |`,
        mtf.reason,
        sentimentFull.reason,
        ...adjustmentReasons,
        ...decision.reasons.slice(0, 3)
      ].join(" | ");

      const finalStrength = adjustedScore >= 75 ? "HIGH" : adjustedScore >= 60 ? "MEDIUM" : "LOW";

      return {
        signal: finalAction as "BUY" | "SELL" | "WAIT",
        confidence: finalStrength as "HIGH" | "MEDIUM" | "LOW",
        score: adjustedScore,
        reason: fullReason,
        isReversal: false,
        metrics: {
          buyScore: finalAction === "BUY" ? adjustedScore : 0,
          sellScore: finalAction === "SELL" ? adjustedScore : 0,
          mtfAlignment: mtf.alignmentScore,
          sentimentScore: sentimentFull.finalScore,
          htf1: mtf.htf1Trend,
          htf2: mtf.htf2Trend,
          mtfConfirmation: mtf.confirmation
        },
        marketState,
        mtf,
        sentiment: sentimentFull
      };

    } catch (e: any) {
      console.warn(`[OrchestratorAgent] IA insuffisante sur ${asset} (${candles.length} bougies) — fallback moteur classique`);

      // ─── Fallback: moteur Bollinger+Stoch (fonctionne dès 5 bougies) ────
      if (candles.length >= 5) {
        try {
          const fallback = evaluateBollingerStochSignal(candles as any);

          // Quick MTF even on fallback
          let mtfBonus = 0;
          try {
            const mtf = MTFAnalysisAgent.analyze(candles, timeframe);
            const expectedBias = fallback.signal === "BUY" ? "BULLISH" : "BEARISH";
            if (mtf.htf1Trend === expectedBias) mtfBonus = 8;
            else if (mtf.htf1Trend !== "NEUTRAL" && mtf.htf1Trend !== expectedBias) mtfBonus = -8;
          } catch {}

          const baseScore = fallback.confidence === "HIGH" ? 75 : fallback.confidence === "MEDIUM" ? 62 : 51;
          const finalScore = Math.max(0, Math.min(100, baseScore + mtfBonus));

          return {
            signal: fallback.signal as "BUY" | "SELL" | "WAIT",
            confidence: (finalScore >= 75 ? "HIGH" : finalScore >= 62 ? "MEDIUM" : "LOW") as "HIGH" | "MEDIUM" | "LOW",
            score: finalScore,
            reason: `[Fallback V6] ${fallback.signal} — ${fallback.reason}`,
            isReversal: false,
            metrics: {}
          };
        } catch {}
      }

      // ─── Last resort ──────────────────────────────────────────────────
      return {
        signal: "WAIT" as "BUY" | "SELL" | "WAIT",
        confidence: "LOW" as "HIGH" | "MEDIUM" | "LOW",
        score: 0,
        reason: `WAIT: Données insuffisantes (${candles.length} bougies — ${e.message})`,
        isReversal: false,
        metrics: {}
      };
    }
  }
}
