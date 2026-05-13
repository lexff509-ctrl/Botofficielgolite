import { MarketState, ConfidenceResult } from "./types";

export class ConfidenceAgent {
  /**
   * Juge de probabilité institutionnel (V5 - Calibration Réelle / Pro Trading).
   * Modèle additif pur. Accepte l'imperfection du marché.
   * Scores : 75-100 (Strong), 60-75 (Valid), 50-60 (Weak but tradable), <50 (WAIT).
   */
  public static evaluate(state: MarketState): ConfidenceResult {
    const { indicators, priceAction, structure } = state;
    const reasons: string[] = [];

    let finalBuyScore = 0;
    let finalSellScore = 0;

    // ==========================================
    // COUCHE 1 : STRUCTURE DU MARCHÉ (Poids max: 45 points)
    // ==========================================
    const isTrendBullish = structure.trend === "BULLISH" && indicators.ema9 > indicators.ema21;
    const isTrendBearish = structure.trend === "BEARISH" && indicators.ema9 < indicators.ema21;

    if (isTrendBullish) {
      if (structure.isNearSupport) {
        finalBuyScore += 45; // Setup Parfait
        reasons.push("[Structure] +45 pts : Tendance Haussière avec rebond sur Support (Idéal).");
      } else if (structure.isNearResistance) {
        finalBuyScore += 30; // Imperfection tolérée
        reasons.push("[Structure] +30 pts : Tendance Haussière puissante mais proche Résistance (Breakout).");
      } else {
        finalBuyScore += 35; // Sain
        reasons.push("[Structure] +35 pts : Tendance Haussière saine.");
      }
    } else if (isTrendBearish) {
      if (structure.isNearResistance) {
        finalSellScore += 45;
        reasons.push("[Structure] +45 pts : Tendance Baissière avec rejet sur Résistance (Idéal).");
      } else if (structure.isNearSupport) {
        finalSellScore += 30;
        reasons.push("[Structure] +30 pts : Tendance Baissière puissante mais proche Support (Breakdown).");
      } else {
        finalSellScore += 35;
        reasons.push("[Structure] +35 pts : Tendance Baissière saine.");
      }
    } else {
      // Range : On accorde quelques points aux extrêmes
      if (structure.isNearSupport) {
        finalBuyScore += 25;
        reasons.push("[Structure] +25 pts : Rebond sur Support en Range.");
      } else if (structure.isNearResistance) {
        finalSellScore += 25;
        reasons.push("[Structure] +25 pts : Rejet sur Résistance en Range.");
      } else {
        reasons.push("[Structure] +0 pts : Marché plat au milieu de nulle part.");
      }
    }

    // ==========================================
    // COUCHE 2 : MOMENTUM (Poids max: 30 points)
    // ==========================================
    let buyMom = 0;
    let sellMom = 0;

    // RSI Contextuel
    if (indicators.rsi > 65) {
      if (isTrendBullish) { buyMom += 2; reasons.push("[Momentum] RSI Haussier fort (Continuation)."); }
      else { sellMom += 2; reasons.push("[Momentum] RSI Suracheté (Rejet potentiel)."); }
    } else if (indicators.rsi < 35) {
      if (isTrendBearish) { sellMom += 2; reasons.push("[Momentum] RSI Baissier fort (Continuation)."); }
      else { buyMom += 2; reasons.push("[Momentum] RSI Survendu (Rebond potentiel)."); }
    } else if (indicators.rsi >= 50) {
      buyMom += 1;
    } else {
      sellMom += 1;
    }

    // MACD
    if ((indicators.macd.histogram || 0) > 0) buyMom += 1;
    else if ((indicators.macd.histogram || 0) < 0) sellMom += 1;

    // Stochastique
    if (indicators.stochastic.k > indicators.stochastic.d) buyMom += 1;
    else sellMom += 1;

    // Ajout proportionnel direct et sans blocage (4 points max = 30 score)
    const buyMomScore = (buyMom / 4) * 30;
    const sellMomScore = (sellMom / 4) * 30;
    
    if (buyMomScore > 0) {
      finalBuyScore += buyMomScore;
      reasons.push(`[Momentum] +${buyMomScore} pts : Signaux Achat (${buyMom}/4).`);
    }
    if (sellMomScore > 0) {
      finalSellScore += sellMomScore;
      reasons.push(`[Momentum] +${sellMomScore} pts : Signaux Vente (${sellMom}/4).`);
    }

    // ==========================================
    // COUCHE 3 : PRICE ACTION (Poids max: 25 points)
    // ==========================================
    if (priceAction.isBullishPinbar || priceAction.isBullishEngulfing) {
      finalBuyScore += 25;
      reasons.push("[Price Action] +25 pts : Action d'Achat forte (Pinbar/Engulfing).");
    } else if (priceAction.isBearishPinbar || priceAction.isBearishEngulfing) {
      finalSellScore += 25;
      reasons.push("[Price Action] +25 pts : Action de Vente forte (Pinbar/Engulfing).");
    } else if (priceAction.isDoji) {
      finalBuyScore += 5;
      finalSellScore += 5;
      reasons.push("[Price Action] +5 pts : Doji (Indécision légère).");
    } else {
      // S'il n'y a pas de figure d'opposition, on donne un bonus de continuation à la tendance
      if (isTrendBullish) finalBuyScore += 10;
      if (isTrendBearish) finalSellScore += 10;
      reasons.push("[Price Action] +10 pts : Pas de signal de rejet (Continuation tolérée).");
    }

    // ==========================================
    // FILTRES ET GESTION DES RISQUES
    // ==========================================
    if (structure.volatility === "LOW") {
      finalBuyScore -= 15;
      finalSellScore -= 15;
      reasons.push("[Filtre] -15 pts : Volatilité morte (Danger).");
    }

    // Limiter entre 0 et 100
    finalBuyScore = Math.max(0, Math.min(100, Math.round(finalBuyScore)));
    finalSellScore = Math.max(0, Math.min(100, Math.round(finalSellScore)));

    // ==========================================
    // DÉCISION FINALE (Seuil : 50%)
    // ==========================================
    let action: "BUY" | "SELL" | "WAIT" = "WAIT";
    let confidence = 0;
    let strength: "weak" | "medium" | "strong" = "weak";

    // V5 Thresholds: 75-100 (Strong), 60-75 (Valid), 50-60 (Weak but tradable)
    const THRESHOLD = 50;
    const MARGIN = 10; // Différence minimale entre Achat et Vente pour éviter un conflit pur

    if (finalBuyScore >= THRESHOLD && finalBuyScore > finalSellScore + MARGIN) {
      action = "BUY";
      confidence = finalBuyScore;
    } else if (finalSellScore >= THRESHOLD && finalSellScore > finalBuyScore + MARGIN) {
      action = "SELL";
      confidence = finalSellScore;
    } else {
      action = "WAIT";
      confidence = Math.max(finalBuyScore, finalSellScore);
      
      if (confidence < THRESHOLD) {
        reasons.push(`Décision finale : WAIT (Score max ${confidence}% < ${THRESHOLD}%).`);
      } else {
        reasons.push(`Décision finale : WAIT (Conflit Achat ${finalBuyScore}% vs Vente ${finalSellScore}%).`);
      }
    }

    if (confidence >= 75) strength = "strong";
    else if (confidence >= 60) strength = "medium";
    else strength = "weak";

    return {
      action,
      confidence,
      strength,
      reasons
    };
  }
}
