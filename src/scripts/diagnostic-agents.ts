/**
 * AUTO-TRADE & AGENTS DIAGNOSTIC TEST
 * Tests timeouts, fallbacks, and agent behavior
 */

import { NewsAgent } from '@/core/agents/NewsAgent';
import { MarketSentimentAgent } from '@/core/agents/MarketSentimentAgent';
import { OrchestratorAgent } from '@/core/agents/OrchestratorAgent';
import { TechnicalAnalysisAgent } from '@/core/agents/TechnicalAnalysisAgent';

// Sample candle data for testing
const SAMPLE_CANDLES = [
  ...Array.from({ length: 50 }, (_, i) => ({
    timestamp: Date.now() - (50 - i) * 300000,
    open: 1.08500 + Math.random() * 0.01,
    high: 1.08600 + Math.random() * 0.01,
    low: 1.08400 + Math.random() * 0.01,
    close: 1.08500 + Math.random() * 0.01,
    volume: 1000 + Math.random() * 5000
  }))
];

interface DiagTest {
  name: string;
  result: 'PASS' | 'FAIL' | 'TIMEOUT' | 'WARN';
  duration: number;
  error?: string;
  message: string;
}

const tests: DiagTest[] = [];

function log(msg: string = '') {
  console.log(msg);
}

function addTest(test: DiagTest) {
  tests.push(test);
  const icon = test.result === 'PASS' ? '✓' : test.result === 'FAIL' ? '✗' : '⏱';
  const color = test.result === 'PASS' ? '\x1b[32m' : test.result === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
  const reset = '\x1b[0m';

  log(`${color}${icon}${reset} ${test.name} (${test.duration}ms)`);
  log(`  └─ ${test.message}`);
  if (test.error) log(`  └─ Error: ${test.error}`);
  log();
}

async function runTests() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  AUTO-TRADE & AGENT DIAGNOSTIC SUITE                       ║');
  console.log('║  Testing: NewsAgent, Sentiment, Orchestrator, AutoTrade    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // ═══════════════════════════════════════════════════════════════════════
  log('PHASE 1: AGENT TIMEOUTS\n');
  // ═══════════════════════════════════════════════════════════════════════

  // Test 1: NewsAgent Timeout
  log('Test 1.1: NewsAgent Timeout (2s max)');
  const newsStart = Date.now();
  const newsResult = await NewsAgent.analyze('EURUSD');
  const newsDuration = Date.now() - newsStart;

  if (newsDuration <= 3000) {
    addTest({
      name: 'NewsAgent Timeout Behavior',
      result: newsDuration <= 2500 ? 'PASS' : 'WARN' as any,
      duration: newsDuration,
      message: `Returned within ${newsDuration}ms (2s timeout works)`,
      error: newsResult.sentiment === 'NEUTRAL' ? undefined : 'Expected NEUTRAL fallback'
    });
  } else {
    addTest({
      name: 'NewsAgent Timeout Behavior',
      result: 'FAIL',
      duration: newsDuration,
      message: `Timeout not enforced! Took ${newsDuration}ms (should be < 2500ms)`,
      error: 'NewsAgent timeout may not be working'
    });
  }

  // Test 2: MarketSentimentAgent Timeout
  log('Test 1.2: MarketSentimentAgent Timeout (2s max)');
  const sentimentStart = Date.now();
  const sentimentResult = await MarketSentimentAgent.analyze('BTCUSD', null, 50);
  const sentimentDuration = Date.now() - sentimentStart;

  if (sentimentDuration <= 3000) {
    addTest({
      name: 'MarketSentimentAgent Timeout Behavior',
      result: sentimentDuration <= 2500 ? 'PASS' : 'WARN' as any,
      duration: sentimentDuration,
      message: `Returned within ${sentimentDuration}ms (timeout works)`,
      error: undefined
    });
  } else {
    addTest({
      name: 'MarketSentimentAgent Timeout Behavior',
      result: 'FAIL',
      duration: sentimentDuration,
      message: `Timeout not enforced! Took ${sentimentDuration}ms`,
      error: 'MarketSentimentAgent timeout may not be working'
    });
  }

  // Test 3: OrchestratorAgent Timeout
  log('Test 1.3: OrchestratorAgent Timeout (5s max)');
  const orchestratorStart = Date.now();
  const orchestratorResult = await OrchestratorAgent.evaluate(
    SAMPLE_CANDLES as any,
    'EURUSD',
    '5m',
    false
  );
  const orchestratorDuration = Date.now() - orchestratorStart;

  if (orchestratorDuration <= 6000) {
    addTest({
      name: 'OrchestratorAgent Timeout Behavior',
      result: orchestratorDuration <= 5500 ? 'PASS' : 'WARN' as any,
      duration: orchestratorDuration,
      message: `Returned within ${orchestratorDuration}ms (5s timeout works)`,
      error: orchestratorResult.signal ? undefined : 'No signal returned'
    });
  } else {
    addTest({
      name: 'OrchestratorAgent Timeout Behavior',
      result: 'FAIL',
      duration: orchestratorDuration,
      message: `Timeout not enforced! Took ${orchestratorDuration}ms`,
      error: 'OrchestratorAgent timeout may not be working'
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  log('\nPHASE 2: AGENT FALLBACK VALIDATION\n');
  // ═══════════════════════════════════════════════════════════════════════

  // Test 4: NewsAgent Fallback
  log('Test 2.1: NewsAgent Fallback Result');
  const newsFallback = newsResult.sentiment === 'NEUTRAL';
  addTest({
    name: 'NewsAgent Fallback (NEUTRAL)',
    result: newsFallback ? 'PASS' : 'FAIL',
    duration: newsDuration,
    message: newsFallback ? 'Correctly returns NEUTRAL on timeout' : `Wrong sentiment: ${newsResult.sentiment}`,
    error: newsFallback ? undefined : 'Fallback not working'
  });

  // Test 5: Sentiment Fallback
  log('Test 2.2: MarketSentimentAgent Fallback Result');
  const sentimentHasResult = sentimentResult.bias !== undefined;
  addTest({
    name: 'MarketSentimentAgent Fallback',
    result: sentimentHasResult ? 'PASS' : 'FAIL',
    duration: sentimentDuration,
    message: sentimentHasResult ? `Returned bias: ${sentimentResult.bias}` : 'No bias returned',
    error: sentimentHasResult ? undefined : 'Fallback not working'
  });

  // Test 6: OrchestratorAgent Fallback
  log('Test 2.3: OrchestratorAgent Fallback Result');
  const orchestratorHasSignal = orchestratorResult.signal !== undefined;
  const signalQuality = orchestratorResult.reason ? 'Detailed' : 'Basic';
  addTest({
    name: 'OrchestratorAgent Fallback Signal',
    result: orchestratorHasSignal ? 'PASS' : 'FAIL',
    duration: orchestratorDuration,
    message: orchestratorHasSignal ? `Signal: ${orchestratorResult.signal} (${signalQuality} reason)` : 'No signal',
    error: orchestratorHasSignal ? undefined : 'Fallback not working'
  });

  // ═══════════════════════════════════════════════════════════════════════
  log('\nPHASE 3: TECHNICAL ANALYSIS\n');
  // ═══════════════════════════════════════════════════════════════════════

  // Test 7: Technical Analysis Agent
  log('Test 3.1: TechnicalAnalysisAgent');
  const technicalStart = Date.now();
  const technicalResult = TechnicalAnalysisAgent.analyze(SAMPLE_CANDLES as any, 'EURUSD', '5m');
  const technicalDuration = Date.now() - technicalStart;

  const hasIndicators = technicalResult.indicators &&
                       technicalResult.indicators.rsi !== undefined &&
                       technicalResult.indicators.macd !== undefined;

  const macdValue = typeof technicalResult.indicators?.macd === 'number'
    ? technicalResult.indicators.macd
    : (technicalResult.indicators?.macd as any)?.macd || 0;

  addTest({
    name: 'Technical Analysis Engine',
    result: hasIndicators ? 'PASS' : 'FAIL',
    duration: technicalDuration,
    message: hasIndicators ? `RSI: ${technicalResult.indicators.rsi.toFixed(2)}, MACD: ${macdValue.toFixed(2)}` : 'Missing indicators',
    error: hasIndicators ? undefined : 'Technical analysis failed'
  });

  // ═══════════════════════════════════════════════════════════════════════
  log('\nPHASE 4: SIGNAL QUALITY\n');
  // ═══════════════════════════════════════════════════════════════════════

  // Test 8: Signal has required fields
  log('Test 4.1: Signal Completeness');
  const requiredFields = ['signal', 'confidence', 'reason', 'score'];
  const hasAllFields = requiredFields.every(field => orchestratorResult[field] !== undefined);

  addTest({
    name: 'Signal Contains Required Fields',
    result: hasAllFields ? 'PASS' : 'FAIL',
    duration: orchestratorDuration,
    message: hasAllFields ? `All fields present: ${requiredFields.join(', ')}` : `Missing: ${requiredFields.filter(f => !orchestratorResult[f]).join(', ')}`,
    error: hasAllFields ? undefined : 'Signal incomplete'
  });

  // Test 9: Signal Score is reasonable
  log('Test 4.2: Signal Score Range');
  const scoreIsValid = orchestratorResult.score >= 0 && orchestratorResult.score <= 100;

  addTest({
    name: 'Signal Score Validity (0-100)',
    result: scoreIsValid ? 'PASS' : 'FAIL',
    duration: orchestratorDuration,
    message: `Score: ${orchestratorResult.score}/100`,
    error: scoreIsValid ? undefined : 'Score out of range'
  });

  // ═══════════════════════════════════════════════════════════════════════
  log('\nPHASE 5: SUMMARY\n');
  // ═══════════════════════════════════════════════════════════════════════

  const passed = tests.filter(t => t.result === 'PASS').length;
  const failed = tests.filter(t => t.result === 'FAIL').length;
  const warned = tests.filter(t => t.result === 'WARN').length;

  console.log(`Tests Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`Tests Failed: \x1b[31m${failed}\x1b[0m`);
  console.log(`Tests Warned: \x1b[33m${warned}\x1b[0m`);
  console.log(`Total:        ${tests.length}\n`);

  const avgTime = (tests.reduce((sum, t) => sum + t.duration, 0) / tests.length).toFixed(0);
  console.log(`Average Response Time: ${avgTime}ms\n`);

  if (failed === 0) {
    console.log('\x1b[32m✓ ALL AGENT TESTS PASSED — Auto-Trade Ready!\x1b[0m\n');
    return 0;
  } else {
    console.log('\x1b[31m✗ SOME TESTS FAILED — Review issues above\x1b[0m\n');
    return 1;
  }
}

// Run tests
runTests().then(code => process.exit(code));
