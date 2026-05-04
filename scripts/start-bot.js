const http = require('http');
function post(path, body, cookie) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = { hostname: 'localhost', port: 3000, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } };
    if (cookie) opts.headers['Cookie'] = cookie;
    const req = http.request(opts, res => {
      let b = ''; const sc = res.headers['set-cookie'];
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b, cookie: sc }));
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data); req.end();
  });
}
async function main() {
  const login = await post('/api/auth/login', { identifier: 'Admin@golite.com', password: 'Admin1234' });
  console.log('Login:', login.status);
  if (login.status !== 200) { console.log('FAIL:', login.body.substring(0, 300)); return; }
  const cookie = login.cookie ? login.cookie[0].split(';')[0] : '';
  console.log('Cookie OK');
  const start = await post('/api/bot', {
    action: 'START', botType: 'auto', asset: 'EUR/USD (OTC)', timeframe: '1m',
    mode: 'DEMO', tradeAmount: 1, confidenceMode: 'standard',
    ssid: 'YOUR_SSID_HERE'
  }, cookie);
  console.log('Bot:', start.status, start.body.substring(0, 500));
}
main().catch(e => console.error('ERR:', e.message));
