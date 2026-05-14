import { MarketState, ConfidenceResult } from "./types";

interface MarketQuality {
  score: number;
  isTradable: boolean;
  reason: string;
}

function computeMarketQuality(state: MarketState): MarketQuality {
  const { indicators, priceAction, structure } = state;
  let score = 100;
  const issues: string[] = [];

  // BLOCAGE DUR — volatilité morte
  if (structure.volatility === "LOW") {
    return { score: 0, isTradable: false, reason: "❌ Volatilité morte (LOW)" };
  }

  // EMA gap trop faible → marché sans direction
  const emaGap = Math.abs(indicators.ema9 - indicators.ema21);
  const emaPct  = indicators.ema21 > 0 ? (emaGap / indicators.ema21) * 100 : 0;
  if (emaPct < 0.015) {
    score -= 40; issues.push("EMA9≈EMA21 (marché plat)");
  } else if (emaPct < 0.04) {
    score -= 15; issues.push("EMA gap faible");
  }

  // Force de tendance insuffisante (seulement en range/neutre)
  const isTrending = structure.trend === "BULLISH" || structure.trend === "BEARISH";
  if (!isTrending && structure.trendStrength < 25) {
    score -= 20; issues.push(`Trend faible (${structure.trendStrength})`);
  }

  // Aucune price action ET structure faible → mauvaise qualité
  const hasPriceAction =
    priceAction.isBullishPinbar || priceAction.isBearishPinbar ||
    priceAction.isBullishEngulfing || priceAction.isBearishEngulfing;
  if (!hasPriceAction && !isTrending) {
    score -= 20; issues.push("Aucune PA + pas de trend");
  }

  // RSI neutre en range → indécision totale
  if (!isTrending && indicators.rsi >= 45 && indicators.rsi <= 55) {
    score -= 10; issues.push(`RSI neutre (${indicators.rsi.toFixed(1)})`);
  }

  score = Math.max(0, Math.min(100, score));
  const isTradable = score >= 30;
  const reason = isTradable
    ? `MQS: ${score}/100 — OK`
    : `MQS: ${score}/100 — Bloqué (${issues.join(", ")})`;

  return { score, isTradable, reason };
}

export class ConfidenceAgent {
  /**
   * ConfidenceAgent V6.1 — Scoring institutionnel adaptatif.
   *
   * Règles clés :
   *  - Breakout institutionnel reconnu (trend fort + vol HIGH) → bonus continuation
   *  - RSI smart : extrême + trend fort = confirmation, pas pénalité
   *  - No PA penalty : uniquement en range (pas en trend fort)
   *  - Vol LOW → WAIT forcé (priorité absolue, aucun override)
   */
  public static evaluate(state: MarketState): ConfidenceResult {
    const { indicators, priceAction, structure } = state;
    const reasons: string[] = [];

    // ══════════════════════════════════════════════════════════════════
    // COUCHE 0 : MARKET QUALITY SCORE
    // ══════════════════════════════════════════════════════════════════
    const mqs = computeMarketQuality(state);
    reasons.push(`[MQS] ${mqs.reason}`);

    if (!mqs.isTradable) {
      return { action: "WAIT", confidence: 0, strength: "weak", reasons, marketQuality: mqs.score };
    }

    let finalBuyScore  = 0;
    let finalSellScore = 0;

    const isTrendBullish = structure.trend === "BULLISH" && indicators.ema9 > indicators.ema21;
    const isTrendBearish = structure.trend === "BEARISH" && indicators.ema9 < indicators.ema21;
    const isHighVol      = structure.volatility === "HIGH";

    // ══════════════════════════════════════════════════════════════════
    // COUCHE 1 : STRUCTURE (45 pts max) + BREAKOUT RECOGNITION
    // ══════════════════════════════════════════════════════════════════
    if (isTrendBullish) {
      if (structure.isNearSupport) {
        finalBuyScore += 45;
        reasons.push("[Structure] +45 pts : Uptrend + Rebond Support (Setup Parfait).");
      } else if (structure.isNearResistance) {
        // Breakout institutionnel si volatilité HIGH → continuation probable
        const pts = isHighVol ? 40 : 30;
        finalBuyScore += pts;
        reasons.push(`[Structure] +${pts} pts : Uptrend + ${isHighVol ? "Breakout Résistance (Institutionnel)" : "Résistance (Breakout)"}.`);
      } else {
        finalBuyScore += 35;
        reasons.push("[Structure] +35 pts : Uptrend sain.");
      }
    } else if (isTrendBearish) {
      if (structure.isNearResistance) {
        finalSellScore += 45;
        reasons.push("[Structure] +45 pts : Downtrend + Rejet Résistance (Setup Parfait).");
      } else if (structure.isNearSupport) {
        const pts = isHighVol ? 40 : 30;
        finalSellScore += pts;
        reasons.push(`[Structure] +${pts} pts : Downtrend + ${isHighVol ? "Breakdown Support (Institutionnel)" : "Support (Breakdown)"}.`);
      } else {
        finalSellScore += 35;
        reasons.push("[Structure] +35 pts : Downtrend sain.");
      }
    } else {
      // RANGE
      if (structure.isNearSupport) {
        finalBuyScore += 22;
        reasons.push("[Structure] +22 pts : Range — Rebond Support.");
      } else if (structure.isNearResistance) {
        finalSellScore += 22;
        reasons.push("[Structure] +22 pts : Range — Rejet Résistance.");
      } else {
        if (indicators.ema9 > indicators.ema21) {
          finalBuyScore += 10;
          reasons.push("[Structure] +10 pts : Range — EMA biais haussier léger.");
        } else {
          finalSellScore += 10;
          reasons.push("[Structure] +10 pts : Range — EMA biais baissier léger.");
        }
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // COUCHE 2 : MOMENTUM (30 pts max) — RSI Smart Filter
    // ══════════════════════════════════════════════════════════════════
    let buyMom = 0;
    let sellMom = 0;

    // RSI Smart : extrême + trend fort = CONFIRMATION (continuation institutionnelle)
    if (indicators.rsi > 80) {
      if (isTrendBullish && isHighVol) {
        // Breakout institutionnel confirmé — RSI élevé = momentum, pas danger
        buyMom += 2; reasons.push(`[Momentum] RSI ${indicators.rsi.toFixed(0)} + Uptrend + Vol HIGH → Continuation institutionnelle.`);
      } else if (isTrendBullish) {
        buyMom += 1; reasons.push(`[Momentum] RSI suracheté mais trend haussier (continuation).`);
      } else {
        sellMom += 2; reasons.push(`[Momentum] RSI ${indicators.rsi.toFixed(0)} suracheté (rejet potentiel).`);
      }
    } else if (indicators.rsi < 20) {
      if (isTrendBearish && isHighVol) {
        sellMom += 2; reasons.push(`[Momentum] RSI ${indicators.rsi.toFixed(0)} + Downtrend + Vol HIGH → Continuation institutionnelle.`);
      } else if (isTrendBearish) {
        sellMom += 1; reasons.push(`[Momentum] RSI survendu mais trend baissier (continuation).`);
      } else {
        buyMom += 2; reasons.push(`[Momentum] RSI ${indicators.rsi.toFixed(0)} survendu (rebond potentiel).`);
      }
    } else if (indicators.rsi > 65) {
      if (isTrendBullish) { buyMom  += 2; } else { sellMom += 2; }
    } else if (indicators.rsi < 35) {
      if (isTrendBearish) { sellMom += 2; } else { buyMom  += 2; }
    } else if (indicators.rsi > 52) { buyMom  += 1; }
    else if (indicators.rsi < 48)   { sellMom += 1; }

    if ((indicators.macd.histogram || 0) > 0) buyMom  += 1;
    else if ((indicators.macd.histogram || 0) < 0) sellMom += 1;

    if (indicators.stochastic.k > indicators.stochastic.d) buyMom  += 1;
    else sellMom += 1;

    const buyMomScore  = Math.round((buyMom  / 4) * 30);
    const sellMomScore = Math.round((sellMom / 4) * 30);
    if (buyMomScore  > 0) { finalBuyScore  += buyMomScore;  reasons.push(`[Momentum] +${buyMomScore} pts Achat (${buyMom}/4).`);  }
    if (sellMomScore > 0) { finalSellScore += sellMomScore; reasons.push(`[Momentum] +${sellMomScore} pts Vente (${sellMom}/4).`); }

    // ══════════════════════════════════════════════════════════════════
    // COUCHE 3 : PRICE ACTION (25 pts max)
    // ══════════════════════════════════════════════════════════════════
    const hasBullishPA = priceAction.isBullishPinbar || priceAction.isBullishEngulfing;
    const hasBearishPA = priceAction.isBearishPinbar || priceAction.isBearishEngulfing;
    const hasPriceAction = hasBullishPA || hasBearishPA;

    if (hasBullishPA) {
      finalBuyScore += 25;
      reasons.push("[Price Action] +25 pts : Signal Achat fort.");
    } else if (hasBearishPA) {
      finalSellScore += 25;
      reasons.push("[Price Action] +25 pts : Signal Vente fort.");
    } else if (priceAction.isDoji) {
      finalBuyScore  += 5;
      finalSellScore += 5;
      reasons.push("[Price Action] +5 pts : Doji (indécision).");
    } else {
      // Continuation : bonus réduit
      if (isTrendBullish) { finalBuyScore  += 10; }
      if (isTrendBearish) { finalSellScore += 10; }
      reasons.push("[Price Action] +10 pts : Continuation (pas de rejet).");
    }

    // ══════════════════════════════════════════════════════════════════
    // FILTRE "NO PRICE ACTION"
    // Pénalité uniquement en RANGE (pas en trend institutionnel fort)
    // ══════════════════════════════════════════════════════════════════
    const isStrongTrend = (isTrendBullish || isTrendBearish) && structure.trendStrength >= 60;
    if (!hasPriceAction && !priceAction.isDoji && !isStrongTrend) {
      finalBuyScore  = Math.max(0, finalBuyScore  - 15);
      finalSellScore = Math.max(0, finalSellScore - 15);
      reasons.push("[Filtre] -15 pts : Aucune PA confirmée (range ou trend faible).");
    } else if (isStrongTrend && !hasPriceAction) {
      reasons.push("[Filtre] Pas de pénalité PA : Trend institutionnel confirmé.");
    }

    // Cap
    finalBuyScore  = Math.max(0, Math.min(100, Math.round(finalBuyScore)));
    finalSellScore = Math.max(0, Math.min(100, Math.round(finalSellScore)));

    // ══════════════════════════════════════════════════════════════════
    // DÉCISION FINALE — Seuil 50%, marge 5 pts
    // ══════════════════════════════════════════════════════════════════
    const THRESHOLD = 50;
    const MARGIN    = 5;

    let action:    "BUY" | "SELL" | "WAIT" = "WAIT";
    let confidence = 0;
    let strength:  "weak" | "medium" | "strong" = "weak";

    if (finalBuyScore >= THRESHOLD && finalBuyScore > finalSellScore + MARGIN) {
      action     = "BUY";
      confidence = finalBuyScore;
    } else if (finalSellScore >= THRESHOLD && finalSellScore > finalBuyScore + MARGIN) {
      action     = "SELL";
      confidence = finalSellScore;
    } else {
      action     = "WAIT";
      confidence = Math.max(finalBuyScore, finalSellScore);
      reasons.push(`WAIT — Achat: ${finalBuyScore}% vs Vente: ${finalSellScore}%.`);
    }

    if (confidence >= 75)      strength = "strong";
    else if (confidence >= 60) strength = "medium";
    else                       strength = "weak";

    return { action, confidence, strength, reasons, marketQuality: mqs.score };
  }
}
