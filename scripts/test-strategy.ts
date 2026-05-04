// Test the enhanced strategy with real data
// Run with: npx tsx scripts/test-strategy.ts

import { generateSignal, type Candle } from "../src/lib/trading";
import { PocketOptionClient } from "../src/lib/pocketoption/client";
import { preFetchCookies } from "../src/lib/pocketoption/connection";
import * as dotenv from "dotenv";

dotenv.config();

const SSID = process.env.POCKET_OPTION_SSID || `42["auth",{"session":"ui79rfql07vtntchhuqrm3ikb8","isDemo":1,"uid":90720400,"platform":2}]`;

async function main() {
  console.log("=== Strategy Diagnostic Test (Strong Bullish Alignment) ===\n");

  const dummyCandles: Candle[] = [];
  let price = 1.0800;
  for (let i = 0; i < 300; i++) {
    // Continuous steady growth to ensure all EMAs and MTF align
    price += 0.00005 + (Math.random() * 0.00002); 
    dummyCandles.push({
      open: price - 0.00003,
      close: price,
      high: price + 0.00005,
      low: price - 0.00005,
      volume: 100,
      timestamp: Date.now() - (300 - i) * 60000
    });
  }
  
  evaluate(dummyCandles);
}

function evaluate(candles: Candle[]) {
  console.log(`\nEvaluating ${candles.length} candles...`);

  if (candles.length < 50) {
    console.error("Not enough candles for strategy test.");
    return;
  }

  console.log("--- Strategy Evaluation ---");
  const signal = generateSignal(candles, "EUR/USD", "1m");

  if (signal) {
    console.log(`Asset:      ${signal.asset}`);
    console.log(`Direction:  ${signal.direction}`);
    console.log(`Confidence: ${signal.confidence}`);
    console.log(`Diagnostic: ${signal.diagnostic}`);
    console.log(`Score:      ${signal.indicators.signalScore?.toFixed(4)}`);
    
    console.log("\n--- Indicator Scores ---");
    Object.entries(signal.indicators.indicatorScores || {}).forEach(([name, score]) => {
      console.log(`${name.padEnd(18)}: ${score.toFixed(3)}`);
    });

    console.log("\n--- MTF Confirmation ---");
    Object.entries(signal.multiTimeframeConfirmation).forEach(([tf, dir]) => {
      console.log(`${tf.padEnd(5)}: ${dir}`);
    });
  } else {
    console.log("Failed to generate signal.");
  }
}

main().then(() => process.exit(0)).catch(() => process.exit(1));
