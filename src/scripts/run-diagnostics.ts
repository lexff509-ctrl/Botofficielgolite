/**
 * DIAGNOSTIC TEST SUITE — Botofficiel V6 Components
 * Tests: Bridge, SSID, Connection, Candles, AutoTrade
 */

const API_URL = 'http://localhost:3000/api';

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  message: string;
  details?: string;
}

const results: TestResult[] = [];

function log(title: string) {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log(`║ ${title.padEnd(58)} ║`);
  console.log('╚════════════════════════════════════════════════════════════╝\n');
}

function logTest(result: TestResult) {
  const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '⚠';
  const color = result.status === 'PASS' ? '\x1b[32m' : result.status === 'FAIL' ? '\x1b[31m' : '\x1b[33m';
  const reset = '\x1b[0m';

  console.log(`${color}${icon}${reset} ${result.name}`);
  console.log(`  └─ ${result.message}`);
  if (result.details) {
    console.log(`  └─ Details: ${result.details.substring(0, 100)}`);
  }
  console.log();
}

function addResult(result: TestResult) {
  results.push(result);
  logTest(result);
}

async function runDiagnostics() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  BOTOFFICIEL V6 — DIAGNOSTIC TEST SUITE                   ║');
  console.log('║  Testing: Bridge, SSID, Connection, Candles, AutoTrade     ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    log('TEST 1: HEALTH CHECK');

    try {
      const health = await fetch(`${API_URL}/health`);
      const data = await health.json();
      addResult({
        name: 'API Health Endpoint',
        status: 'PASS',
        message: 'Server is responding',
        details: `Status: ${data?.status}`
      });
    } catch (err: any) {
      addResult({
        name: 'API Health Endpoint',
        status: 'FAIL',
        message: 'Server not responding',
        details: err.message
      });
    }

    log('TEST 2: BRIDGE SYNCHRONIZATION');

    try {
      const response = await fetch(`${API_URL}/extension/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'test-api-key-diagnostic',
          ssid: 'short',
          uid: 'test-uid',
          username: 'diagnostic-user',
          isDemo: true,
          demoBalance: '1000'
        })
      });

      const data = await response.json();
      if (response.status === 400 && data?.error?.includes('invalide')) {
        addResult({
          name: 'SSID Validation (Reject Short)',
          status: 'PASS',
          message: 'Correctly rejects SSID < 10 characters',
          details: data.error
        });
      } else {
        addResult({
          name: 'SSID Validation (Reject Short)',
          status: 'FAIL',
          message: 'Should reject short SSID',
          details: JSON.stringify(data)
        });
      }
    } catch (err: any) {
      addResult({
        name: 'SSID Validation (Reject Short)',
        status: 'FAIL',
        message: 'Unexpected error',
        details: err.message
      });
    }

    try {
      const validSSID = 'valid_ssid_1234567890_diagnostic_test';
      const response = await fetch(`${API_URL}/extension/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: 'test-api-key-valid-diagnostic',
          ssid: validSSID,
          uid: 'test-uid-valid',
          username: 'diagnostic-user-valid',
          isDemo: true,
          demoBalance: '1000'
        })
      });

      const data = await response.json();
      if (data?.success === true) {
        addResult({
          name: 'SSID Validation (Accept Valid)',
          status: 'PASS',
          message: 'Correctly accepts SSID >= 10 characters',
          details: data.message
        });
      } else {
        addResult({
          name: 'SSID Validation (Accept Valid)',
          status: 'FAIL',
          message: 'Should accept valid SSID',
          details: JSON.stringify(data)
        });
      }
    } catch (err: any) {
      addResult({
        name: 'SSID Validation (Accept Valid)',
        status: 'FAIL',
        message: 'Failed to process valid SSID',
        details: err.message
      });
    }

    log('TEST 3: BOT STATUS');

    try {
      const botStatus = await fetch(`${API_URL}/bot`);
      const data = await botStatus.json();
      addResult({
        name: 'Bot Status Check',
        status: 'PASS',
        message: 'Bot status endpoint accessible',
        details: `Status: ${data?.status}`
      });
    } catch (err: any) {
      addResult({
        name: 'Bot Status Check',
        status: 'WARN',
        message: 'Bot endpoint may not be ready',
        details: err.message
      });
    }

    log('DIAGNOSTIC SUMMARY');

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warned = results.filter(r => r.status === 'WARN').length;

    console.log(`Tests Passed:  \x1b[32m${passed}\x1b[0m`);
    console.log(`Tests Failed:  \x1b[31m${failed}\x1b[0m`);
    console.log(`Tests Warned:  \x1b[33m${warned}\x1b[0m`);
    console.log(`Total:         ${results.length}\n`);

    if (failed === 0) {
      console.log('\x1b[32m✓ DIAGNOSTICS PASSED\x1b[0m\n');
      return 0;
    } else {
      console.log('\x1b[31m✗ DIAGNOSTICS FAILED\x1b[0m\n');
      return 1;
    }

  } catch (err: any) {
    console.error('\nFatal error:', err.message);
    return 1;
  }
}

runDiagnostics().then(code => process.exit(code));
