/**
 * MarketSentimentAgent — Real market sentiment pipeline
 * 
 * Sources (in priority order):
 *   1. Fear & Greed Index (alternative.me — free, no API key)
 *   2. RSI-based synthetic sentiment from HTF candles
 *   3. News bias from NewsAgent (already computed)
 * 
 * Output: -100 (extreme fear/bearish) to +100 (extreme greed/bullish)
 */

import { NewsBias } from "./NewsAgent";

export interface SentimentResult {
  score: number;            // -100 to +100
  label: string;            // Human-readable
  source: string;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  weight: number;           // 0-1 (how much to trust this signal)
}

export interface CombinedSentiment {
  finalScore: number;
  bias: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number;       // 0-100
  sources: SentimentResult[];
  reason: string;
}

// Cache Fear & Greed to avoid hammering the free API
let fngCache: { value: number; label: string; timestamp: number } | null = null;
const FNG_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
let fngCircuitBreakerTrips = 0;
const FNG_CIRCUIT_BREAKER_THRESHOLD = 3; // fail after 3 consecutive failures

async function fetchFearAndGreed(): Promise<{ value: number; label: string } | null> {
  try {
    // ✅ BUG FIX #6: Circuit breaker — stop hammering API after repeated failures
    if (fngCircuitBreakerTrips >= FNG_CIRCUIT_BREAKER_THRESHOLD) {
      console.warn("[Fear&Greed] Circuit breaker open — using cache or neutral");
      if (fngCache) return { value: fngCache.value, label: fngCache.label };
      return null;
    }

    if (fngCache && Date.now() - fngCache.timestamp < FNG_CACHE_TTL) {
      fngCircuitBreakerTrips = 0; // Reset on successful cache use
      return { value: fngCache.value, label: fngCache.label };
    }

    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      signal: AbortSignal.timeout(5000) // ✅ Increased from 3s to 5s for reliability
    });
    if (!res.ok) {
      fngCircuitBreakerTrips++;
      return fngCache ? { value: fngCache.value, label: fngCache.label } : null;
    }
    const data = await res.json();
    const entry = data?.data?.[0];
    if (!entry) {
      fngCircuitBreakerTrips++;
      return null;
    }

    const result = {
      value: parseInt(entry.value),
      label: entry.value_classification as string
    };
    fngCache = { ...result, timestamp: Date.now() };
    fngCircuitBreakerTrips = 0; // Reset on success
    return result;
  } catch (err) {
    fngCircuitBreakerTrips++;
    console.warn("[Fear&Greed] API error (trip count: " + fngCircuitBreakerTrips + "):", err);
    return fngCache ? { value: fngCache.value, label: fngCache.label } : null;
  }
}

export class MarketSentimentAgent {
  /**
   * Aggregates all real-time sentiment signals into a single score.
   */
  public static async analyze(
    asset: string,
    newsBias: NewsBias | null,
    rsiValue: number = 50
  ): Promise<CombinedSentiment> {
    const sources: SentimentResult[] = [];
    const isCrypto = asset.includes("BTC") || asset.includes("ETH") || asset.includes("XRP");
    const isOtc = asset.toUpperCase().includes("OTC");

    // ─── SOURCE 1: Fear & Greed Index (crypto + general markets) ────────────
    if (isCrypto) {
      const fng = await fetchFearAndGreed();
      if (fng) {
        // Convert 0-100 (fear=0, greed=100) to -100...+100
        const score = (fng.value - 50) * 2;
        const bias = score > 15 ? "BULLISH" : score < -15 ? "BEARISH" : "NEUTRAL";
        sources.push({
          score,
          label: `Fear & Greed: ${fng.value}/100 (${fng.label})`,
          source: "alternative.me",
          bias,
          weight: 0.35
        });
      }
    }

    // ─── SOURCE 2: RSI Synthetic Sentiment ────────────────────────────────
    // RSI > 60 = bullish sentiment, RSI < 40 = bearish, 40-60 = neutral
    const rsiScore = rsiValue > 70 ? 60
      : rsiValue > 60 ? 35
      : rsiValue > 55 ? 15
      : rsiValue < 30 ? -60
      : rsiValue < 40 ? -35
      : rsiValue < 45 ? -15
      : 0;

    const rsiBias = rsiScore > 10 ? "BULLISH" : rsiScore < -10 ? "BEARISH" : "NEUTRAL";
    const rsiWeight = isOtc ? 0.50 : 0.30;
    sources.push({
      score: rsiScore,
      label: `RSI Sentiment: ${rsiValue.toFixed(1)} → ${rsiBias}`,
      source: "RSI-synthetic",
      bias: rsiBias,
      weight: rsiWeight
    });

    // ─── SOURCE 3: News Macro Bias ────────────────────────────────────────
    if (newsBias && newsBias.sentiment !== "NEUTRAL" && newsBias.strength > 0) {
      const newsScore = newsBias.sentiment === "BULLISH"
        ? newsBias.strength * 0.8
        : -newsBias.strength * 0.8;
      sources.push({
        score: newsScore,
        label: newsBias.reason,
        source: "NewsAgent",
        bias: newsBias.sentiment,
        weight: 0.35
      });
    } else if (!isCrypto && !isOtc) {
      // No news = slight neutral weight for forex
      sources.push({
        score: 0,
        label: "Aucun catalyseur macro actif",
        source: "NewsAgent",
        bias: "NEUTRAL",
        weight: 0.15
      });
    }

    // ─── AGGREGATE ────────────────────────────────────────────────────────
    let totalWeight = sources.reduce((s, src) => s + src.weight, 0);
    if (totalWeight === 0) totalWeight = 1;

    const weightedScore = sources.reduce((s, src) => s + src.score * (src.weight / totalWeight), 0);
    const finalScore = Math.round(Math.max(-100, Math.min(100, weightedScore)));

    const bias: "BULLISH" | "BEARISH" | "NEUTRAL" =
      finalScore > 15 ? "BULLISH" : finalScore < -15 ? "BEARISH" : "NEUTRAL";

    const confidence = Math.min(95, Math.round(Math.abs(finalScore)));

    const reason = [
      `[Sentiment] Score: ${finalScore > 0 ? "+" : ""}${finalScore}/100 → ${bias}`,
      ...sources.map(s => s.label)
    ].join(" | ");

    return { finalScore, bias, confidence, sources, reason };
  }
}
