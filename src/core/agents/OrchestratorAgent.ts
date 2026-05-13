import { TechnicalAnalysisAgent } from "./TechnicalAnalysisAgent";
import { ConfidenceAgent } from "./ConfidenceAgent";
import { NewsAgent } from "./NewsAgent";
import { Candle } from "./types";

export class OrchestratorAgent {
  /**
   * Point d'entrée principal de l'Intelligence Artificielle.
   * Remplace l'ancien AdvancedStrategyEngine monolithique.
   * 
   * Flux :
   * 1. Boucles brutes (PO / Binance) -> Agent 1 (Cerveau) -> MarketState
   * 2. NewsAgent -> Analyse l'impact macro-économique
   * 3. MarketState + News -> Agent 2 (Filtre Pro) -> Décision finale
   * 4. Décision -> Format legacy pour le TradeEngine
   */
  public static async evaluate(candles: Candle[], asset: string, timeframe: string, isOtc: boolean = false) {
    try {
      // ÉTAPE 1 : Le Cerveau analyse les données brutes
      const marketState = TechnicalAnalysisAgent.analyze(candles, asset, timeframe);

      // ÉTAPE 1.5 : Le NewsAgent récupère la direction macro
      const newsBias = await NewsAgent.analyze(asset);
      marketState.newsBias = newsBias;

      // ÉTAPE 2 : Le Juge Institutionnel filtre et score
      const decision = ConfidenceAgent.evaluate(marketState);

      // ÉTAPE 3 : Rétrocompatibilité avec l'existant (BotRunner)
      return {
        signal: decision.action as "BUY" | "SELL" | "WAIT",
        confidence: (decision.strength === "strong" ? "HIGH" : decision.strength === "medium" ? "MEDIUM" : "LOW") as "HIGH" | "MEDIUM" | "LOW",
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
        signal: "WAIT" as "BUY" | "SELL" | "WAIT", 
        confidence: "LOW" as "HIGH" | "MEDIUM" | "LOW", 
        score: 0, 
        reason: `WAIT: Analyse impossible (${e.message})`,
        isReversal: false,
        metrics: {}
      };
    }
  }
}
