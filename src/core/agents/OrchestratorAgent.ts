import { TechnicalAnalysisAgent } from "./TechnicalAnalysisAgent";
import { ConfidenceAgent } from "./ConfidenceAgent";
import { Candle } from "./types";

export class OrchestratorAgent {
  /**
   * Point d'entrée principal de l'Intelligence Artificielle.
   * Remplace l'ancien AdvancedStrategyEngine monolithique.
   * 
   * Flux :
   * 1. Boucles brutes (PO / Binance) -> Agent 1 (Cerveau) -> MarketState
   * 2. MarketState -> Agent 2 (Filtre Pro) -> Décision finale
   * 3. Décision -> Format legacy pour le TradeEngine
   */
  public static evaluate(candles: Candle[], asset: string, timeframe: string, isOtc: boolean = false) {
    try {
      // ÉTAPE 1 : Le Cerveau analyse les données brutes
      const marketState = TechnicalAnalysisAgent.analyze(candles, asset, timeframe);

      // ÉTAPE 2 : Le Juge Institutionnel filtre et score
      const decision = ConfidenceAgent.evaluate(marketState);

      // ÉTAPE 3 : Rétrocompatibilité avec l'existant (BotRunner)
      return {
        signal: decision.action,
        confidence: decision.strength === "strong" ? "HIGH" : decision.strength === "medium" ? "MEDIUM" : "LOW",
        score: decision.confidence,
        reason: `[IA Orchestrator] ${decision.action} (${decision.confidence}%) - ` + decision.reasons.join(" | "),
        isReversal: false, // Historique
        metrics: {
          buyScore: decision.action === "BUY" ? decision.confidence : 0,
          sellScore: decision.action === "SELL" ? decision.confidence : 0
        },
        marketState
      };
    } catch (e: any) {
      console.warn(`[OrchestratorAgent] Échec de l'analyse sur ${asset}: ${e.message}`);
      return { 
        signal: "WAIT", 
        confidence: "LOW", 
        score: 0, 
        reason: `WAIT: Analyse impossible (${e.message})`,
        isReversal: false,
        metrics: {}
      };
    }
  }
}
