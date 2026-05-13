import { TechnicalAnalysisAgent } from "../core/agents/TechnicalAnalysisAgent";
import { ConfidenceAgent } from "../core/agents/ConfidenceAgent";
import { Candle } from "../core/agents/types";

// Helper pour générer 30 bougies de base
function generateBaseCandles(startPrice: number, trend: "UP" | "DOWN" | "FLAT"): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  const now = Date.now();
  
  for (let i = 0; i < 28; i++) {
    let open = price;
    let close = price;
    if (trend === "UP") close += 0.0010;
    else if (trend === "DOWN") close -= 0.0010;
    
    candles.push({
      timestamp: now - (30 - i) * 60000,
      open: open,
      close: close,
      high: Math.max(open, close) + 0.0005,
      low: Math.min(open, close) - 0.0005,
      volume: 100
    });
    price = close;
  }
  return candles;
}

// ==========================================
// SCÉNARIO 1 : ACHAT PARFAIT
// Tendance haussière, correction vers le support, rejet avec Pinbar Bullish, RSI bas.
// ==========================================
function getPerfectBuyScenario(): Candle[] {
  const candles = generateBaseCandles(1.1000, "UP");
  const lastPrice = candles[candles.length - 1].close;
  
  // Correction baissière (Toupie vers support)
  candles.push({
    timestamp: Date.now() - 120000,
    open: lastPrice,
    close: lastPrice - 0.0030,
    high: lastPrice + 0.0005,
    low: lastPrice - 0.0035,
    volume: 500
  });
  
  // Rejet massif du support (Pinbar haussier avec très longue mèche basse)
  candles.push({
    timestamp: Date.now() - 60000,
    open: lastPrice - 0.0030,
    close: lastPrice - 0.0010,
    high: lastPrice - 0.0005,
    low: lastPrice - 0.0080, // Mèche extrêmement basse (rejet)
    volume: 800
  });
  
  return candles;
}

// ==========================================
// SCÉNARIO 2 : VENTE PARFAITE
// Tendance baissière, rebond vers résistance, avalement baissier (Engulfing).
// ==========================================
function getPerfectSellScenario(): Candle[] {
  const candles = generateBaseCandles(1.1000, "DOWN");
  const lastPrice = candles[candles.length - 1].close;
  
  // Rebond technique (Toupie vers résistance)
  candles.push({
    timestamp: Date.now() - 120000,
    open: lastPrice,
    close: lastPrice + 0.0030,
    high: lastPrice + 0.0035,
    low: lastPrice - 0.0005,
    volume: 500
  });
  
  // Rejet massif de la résistance (Avalement Baissier / Bearish Engulfing)
  candles.push({
    timestamp: Date.now() - 60000,
    open: lastPrice + 0.0035,
    close: lastPrice - 0.0010, // Clôture plus bas que l'ouverture précédente
    high: lastPrice + 0.0040,
    low: lastPrice - 0.0015,
    volume: 800
  });
  
  return candles;
}

// ==========================================
// SCÉNARIO 3 : PIÈGE (RANGEMENT MORT)
// Volatilité nulle, marché plat, indicateurs indécis. Doit forcer le WAIT.
// ==========================================
function getWaitScenario(): Candle[] {
  const candles = generateBaseCandles(1.1000, "FLAT");
  // Clôtures parfaitement plates pour casser la volatilité (Squeeze extrême)
  candles.push({
    timestamp: Date.now() - 120000,
    open: 1.1000, close: 1.1000, high: 1.1001, low: 1.0999, volume: 10
  });
  candles.push({
    timestamp: Date.now() - 60000,
    open: 1.1000, close: 1.1000, high: 1.1001, low: 1.0999, volume: 10
  });
  return candles;
}

function runSimulation() {
  console.log("==================================================");
  console.log("🧪 DÉMARRAGE DE LA SIMULATION IA (AGENTS 1 & 2)");
  console.log("==================================================\n");

  const scenarios = [
    { name: "🟢 SCÉNARIO 1 : ACHAT IDÉAL (Rejet Support + Pinbar)", data: getPerfectBuyScenario() },
    { name: "🔴 SCÉNARIO 2 : VENTE IDÉALE (Rejet Résistance + Engulfing)", data: getPerfectSellScenario() },
    { name: "⚪ SCÉNARIO 3 : PIÈGE EN RANGE (Volatilité Morte / Ambiguïté)", data: getWaitScenario() }
  ];

  scenarios.forEach(scenario => {
    console.log(`\n${scenario.name}`);
    console.log("--------------------------------------------------");

    try {
      // ==========================================
      // ÉTAPE 1 : AGENT ANALYSE TECHNIQUE (CERVEAU)
      // ==========================================
      const state = TechnicalAnalysisAgent.analyze(scenario.data, "SIMULATION", "1m");
      
      console.log(`[Agent 1] Market State extrait :`);
      console.log(`   - Tendance : ${state.structure.trend} (Force: ${state.structure.trendStrength})`);
      console.log(`   - Volatilité : ${state.structure.volatility}`);
      console.log(`   - Proximité : Support(${state.structure.isNearSupport}) | Résistance(${state.structure.isNearResistance})`);
      console.log(`   - Price Action : Pinbar Bull(${state.priceAction.isBullishPinbar}) | Engulfing Bear(${state.priceAction.isBearishEngulfing})`);
      console.log(`   - RSI : ${state.indicators.rsi.toFixed(2)} | MACD: ${state.indicators.macd.histogram?.toFixed(5)}`);

      // ==========================================
      // ÉTAPE 2 : AGENT CONFIANCE (FILTRE PRO)
      // ==========================================
      const decision = ConfidenceAgent.evaluate(state);

      console.log(`\n[Agent 2] Verdict du Juge Institutionnel :`);
      const actionIcon = decision.action === "BUY" ? "🟢" : decision.action === "SELL" ? "🔴" : "⚪";
      console.log(`   - Action : ${actionIcon} ${decision.action}`);
      console.log(`   - Score Final : ${decision.confidence}% (Force: ${decision.strength})`);
      console.log(`   - Justifications détaillées :`);
      decision.reasons.forEach(r => console.log(`      * ${r}`));

    } catch (e: any) {
      console.error(`Erreur lors de la simulation: ${e.message}`);
    }
  });

  console.log("\n==================================================");
  console.log("✅ FIN DE LA SIMULATION");
  console.log("==================================================");
}

runSimulation();
