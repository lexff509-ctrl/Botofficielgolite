
import { externalDataService } from "./external-data.service";
import { evaluateBollingerStochSignal, Candle, Timeframe } from "../lib/trading";

export interface DataSignal {
  asset: string;
  timeframe: Timeframe;
  signal: "BUY" | "SELL" | "WAIT";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  direction: "CALL" | "PUT";
  price: number;
  candles: Candle[];
}

export class DataOrchestrator {
  /**
   * MISSION 1: Centralisation des Sources de Données
   * Récupère les bougies (candles) directement depuis les APIs fiables (Binance/Twelve Data)
   */
  static async getReliableExternalData(asset: string, timeframe: Timeframe, limit = 100): Promise<Candle[]> {
    const isOTC = asset.toUpperCase().includes("OTC") || asset.toLowerCase().includes("_otc");
    
    if (isOTC) {
      // Pour l'OTC, on retourne vide pour forcer le fallback sur PO WebSocket dans le BotRunner
      return [];
    }

    try {
      const candles = await externalDataService.getExternalCandles(asset, timeframe, limit);
      if (candles && candles.length > 0) {
        console.log(`[DataOrchestrator] Data fetched from Reliable Source for ${asset}`);
        return candles;
      }
    } catch (error) {
      console.error(`[DataOrchestrator] Failed to fetch external data for ${asset}:`, error);
    }

    return [];
  }
}

export class NonOtcSignalGenerator {
  /**
   * MISSION 2: Logique de Génération de Signaux Indépendante
   * Génère un signal basé uniquement sur les données externes stables
   */
  static async generateSignal(asset: string, timeframe: Timeframe): Promise<DataSignal | null> {
    const candles = await DataOrchestrator.getReliableExternalData(asset, timeframe, 100);
    
    if (!candles || candles.length < 30) {
      return null;
    }

    const lastCandle = candles[candles.length - 1];
    const strategy = evaluateBollingerStochSignal(candles);

    // MISSION 3: Le signal doit être généré avant toute vérification PO
    return {
      asset,
      timeframe,
      signal: strategy.signal,
      confidence: strategy.confidence,
      reason: strategy.reason,
      direction: strategy.signal === "BUY" ? "CALL" : "PUT",
      price: lastCandle.close,
      candles: candles
    };
  }
}
