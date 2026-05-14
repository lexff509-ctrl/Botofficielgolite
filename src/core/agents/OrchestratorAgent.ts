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
      const [newsBias, sentiment] = await Promise.all([
        NewsAgent.analyze(asset),
        MarketSentimentAgent.analyze(
          asset,
          null, // newsBias will be merged after
          marketState.indicators.rsi
        )
      ]);
      marketState.newsBias = newsBias;

      // Recompute sentiment with news bias included
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

      // — MTF Adjustments —
      if (decision.action !== "WAIT") {
        const signalBias = decision.action === "BUY" ? "BULLISH" : "BEARISH";

        if (mtf.confirmation === "STRONG" && mtf.htf1Trend === signalBias) {
          adjustedScore += 12;
          adjustmentReasons.push(`+12 pts MTF: HTF fortement aligné (${signalBias})`);
        } else if (mtf.confirmation === "MODERATE" && mtf.htf1Trend === signalBias) {
          adjustedScore += 6;
          adjustmentReasons.push(`+6 pts MTF: HTF modérément aligné`);
        } else if (mtf.confirmation === "CONFLICT") {
          adjustedScore -= 12;
          adjustmentReasons.push(`-12 pts MTF: Conflit HTF (signal contre-tendance risqué)`);
        } else if (mtf.htf1Trend !== "NEUTRAL" && mtf.htf1Trend !== signalBias) {
          adjustedScore -= 8;
          adjustmentReasons.push(`-8 pts MTF: HTF opposé au signal`);
        }
      }

      // — Sentiment Adjustments —
      if (decision.action !== "WAIT") {
        const signalBias = decision.action === "BUY" ? "BULLISH" : "BEARISH";

        if (sentimentFull.bias === signalBias && sentimentFull.confidence >= 40) {
          adjustedScore += 8;
          adjustmentReasons.push(`+8 pts Sentiment: Marché ${sentimentFull.bias} confirmé (${sentimentFull.finalScore > 0 ? "+" : ""}${sentimentFull.finalScore})`);
        } else if (sentimentFull.bias !== "NEUTRAL" && sentimentFull.bias !== signalBias && sentimentFull.confidence >= 40) {
          adjustedScore -= 8;
          adjustmentReasons.push(`-8 pts Sentiment: Marché contre-directionnel (${sentimentFull.finalScore > 0 ? "+" : ""}${sentimentFull.finalScore})`);
        }
      }

      adjustedScore = Math.max(0, Math.min(100, Math.round(adjustedScore)));

      // ═══════════════════════════════════════════════════════════════════
      // ÉTAPE 6 : Décision Finale avec score ajusté
      // ═══════════════════════════════════════════════════════════════════
      const finalStrength = adjustedScore >= 75 ? "HIGH" : adjustedScore >= 60 ? "MEDIUM" : "LOW";
      const finalAction = adjustedScore < 48 ? "WAIT" : decision.action;

      const fullReason = [
        `[IA V6] ${finalAction} (${adjustedScore}%) |`,
        mtf.reason,
        sentimentFull.reason,
        ...adjustmentReasons,
        ...decision.reasons.slice(0, 3)
      ].join(" | ");

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
