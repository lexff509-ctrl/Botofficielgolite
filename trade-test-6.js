const https = require('https');
const SSID = '42["auth",{ "session":"ui79rfql07vtntchhuqrm3ikb8", "isDemo":1, "uid":90720400, "platform":2, "isFastHistory":true, "isOptimized":true}]';
const HOST = 'botofficielgolite.onrender.com';

function req(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('🔐 Login');
  const loginPayload = JSON.stringify({ identifier: 'admin@golite.com', password: 'Admin1234' });
  const login = await req({ hostname: HOST, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginPayload) } }, loginPayload);
  const cookie = (login.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  console.log('Login status', login.status);

  async function api(path, method, body) {
    const b = body ? JSON.stringify(body) : null;
    const headers = { 'Cookie': cookie, 'Content-Type': 'application/json' };
    if (b) headers['Content-Length'] = Buffer.byteLength(b);
    const resp = await req({ hostname: HOST, path, method, headers }, b);
    try { return { status: resp.status, json: JSON.parse(resp.body) }; } catch { return { status: resp.status, raw: resp.body.slice(0,200) }; }
  }

  // Ensure no bot is running
  await api('/api/bot', 'POST', { action: 'STOP' });

  const pairs = [
    { name: 'EUR/USD (OTC)', asset: 'EUR/USD (OTC)', type: 'OTC' },
    { name: 'GBP/USD (OTC)', asset: 'GBP/USD (OTC)', type: 'OTC' },
    { name: 'BTC/USD (OTC)', asset: 'BTC/USD (OTC)', type: 'OTC' },
    { name: 'EUR/USD', asset: 'EUR/USD', type: 'NON-OTC' },
    { name: 'BTC/USD', asset: 'BTC/USD', type: 'NON-OTC' },
    { name: 'GBP/USD', asset: 'GBP/USD', type: 'NON-OTC' }
  ];

  const results = [];

  for (const p of pairs) {
    console.log('\n=== START', p.name, '===');
    const start = await api('/api/bot', 'POST', {
      action: 'START',
      ssid: SSID,
      asset: p.asset,
      timeframe: '1m',
      botType: 'auto',
      mode: 'DEMO',
      tradeAmount: 1,
      confidenceMode: 'standard'
    });
    console.log('Start HTTP', start.status);
    if (start.json?.error) { console.log('❌ Start error', start.json.error); results.push({ pair: p.name, type: p.type, status: 'START_ERR', error: start.json.error }); continue; }

    // wait for PO websocket to connect (15 s)
    await new Promise(r => setTimeout(r, 15000));
    // wait for a full candle + trade processing (60 s)
    await new Promise(r => setTimeout(r, 60000));

    const health = await api('/api/health', 'GET');
    const runner = (health.json?.runners || []).find(r => r.asset === p.asset);
    const botInfo = await api('/api/bot', 'GET');
    const session = botInfo.json?.activeSession;
    console.log('Runner after wait', runner);
    console.log('Session', session);
    results.push({ pair: p.name, type: p.type, runner, session });
    // stop before next test
    await api('/api/bot', 'POST', { action: 'STOP' });
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n=== FINAL REPORT ===');
  for (const r of results) {
    const icon = r.status === 'START_ERR' ? '❌' : (r.runner?.tradesExecuted > 0 ? '✅' : '🔴');
    console.log(icon, '[' + r.type + ']', r.pair);
    if (r.runner) console.log('  Signals:', r.runner.signalsGenerated, 'Trades:', r.runner.tradesExecuted, 'Paused:', r.runner.paused);
    if (r.session) console.log('  Session trades:', r.session.totalTrades, 'W/L:', r.session.wins, '/', r.session.losses, 'Profit:', r.session.totalProfit);
  }
}

main().catch(err => console.error('FATAL', err));
