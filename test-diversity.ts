
import { generateSignal, type Candle, type Timeframe } from './src/lib/trading';

/**
 * Simulates real market movement to test the bot's analysis diversity.
 * We want to see if the bot correctly generates both CALL and PUT signals
 * based on the price action we feed it.
 */
async function runDiversityTest() {
  console.log("--- STARTING BOT ANALYSIS DIVERSITY TEST ---");
  
  // 1. Initial Bearish Setup (to trigger PUT)
  let basePrice = 1.0500;
  const bearishCandles: Candle[] = [];
  for (let i = 0; i < 50; i++) {
    basePrice -= 0.0001;
    bearishCandles.push({
      timestamp: Date.now() - (50 - i) * 60000,
      open: basePrice + 0.00005,
      close: basePrice,
      high: basePrice + 0.0001,
      low: basePrice - 0.00005,
      volume: 100,
    });
  }

  const putSignal = generateSignal(bearishCandles, "EURUSD", "1m");
  console.log(`Test 1 (Bearish Trend): Expected PUT, Got: ${putSignal?.direction} (Confidence: ${putSignal?.confidence}%)`);

  // 2. Reversal Setup (to trigger CALL)
  const reversalCandles = [...bearishCandles];
  for (let i = 0; i < 20; i++) {
    basePrice += 0.0002; // Stronger move up
    reversalCandles.push({
      timestamp: Date.now() - (20 - i) * 60000,
      open: basePrice - 0.0001,
      close: basePrice,
      high: basePrice + 0.00005,
      low: basePrice - 0.00015,
      volume: 100,
    });
  }

  const callSignal = generateSignal(reversalCandles, "EURUSD", "1m");
  console.log(`Test 2 (Bullish Reversal): Expected CALL, Got: ${callSignal?.direction} (Confidence: ${callSignal?.confidence}%)`);

  // 3. Evaluation
  if (putSignal?.direction === "PUT" && callSignal?.direction === "CALL") {
    console.log("SUCCESS: Bot correctly analyzed both directions based on price action.");
  } else {
    console.error("FAILURE: Bot is still biased or failed to detect trend change.");
  }
  
  console.log("--- TEST COMPLETE ---");
}

runDiversityTest().catch(console.error);
