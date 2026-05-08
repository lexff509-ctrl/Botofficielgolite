
import { evaluateBollingerStochSignal, Candle } from "../src/lib/trading";

function testFinalLogic() {
  console.log("=== FINAL LOGIC VALIDATION TEST ===");

  // 1. Test CALL Scenario (Bullish Trend + Bounce)
  const callCandles: Candle[] = [];
  let price = 1.1000;
  for (let i = 0; i < 100; i++) {
    price += 0.0001; // Rising trend
    callCandles.push({
      open: price - 0.0001,
      close: price,
      high: price + 0.0001,
      low: price - 0.0001,
      volume: 100,
      timestamp: Date.now() - (100 - i) * 60000
    });
  }
  
  const callResult = evaluateBollingerStochSignal(callCandles);
  console.log(`\nScenario CALL (Bullish):`);
  console.log(`Signal: ${callResult.signal}`);
  console.log(`Reason: ${callResult.reason}`);
  
  const isCallCorrect = callResult.signal === "BUY" && callResult.reason.includes("CALL (HAUT)");
  console.log(`Result: ${isCallCorrect ? "✅ PASSED" : "❌ FAILED"}`);

  // 2. Test PUT Scenario (Bearish Trend + Bounce)
  const putCandles: Candle[] = [];
  price = 1.2000;
  for (let i = 0; i < 100; i++) {
    price -= 0.0001; // Falling trend
    putCandles.push({
      open: price + 0.0001,
      close: price,
      high: price + 0.0001,
      low: price - 0.0001,
      volume: 100,
      timestamp: Date.now() - (100 - i) * 60000
    });
  }

  const putResult = evaluateBollingerStochSignal(putCandles);
  console.log(`\nScenario PUT (Bearish):`);
  console.log(`Signal: ${putResult.signal}`);
  console.log(`Reason: ${putResult.reason}`);
  
  const isPutCorrect = putResult.signal === "SELL" && putResult.reason.includes("PUT (BAS)");
  console.log(`Result: ${isPutCorrect ? "✅ PASSED" : "❌ FAILED"}`);

  if (isCallCorrect && isPutCorrect) {
    console.log("\n🚀 ALL TRADING LOGIC TESTS PASSED!");
  } else {
    process.exit(1);
  }
}

testFinalLogic();
