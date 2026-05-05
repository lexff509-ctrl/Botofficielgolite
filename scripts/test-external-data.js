require('dotenv').config();
const { externalDataService } = require('./dist/services/external-data.service');

async function test() {
  console.log('Testing External Data Service (Binance)...');
  try {
    const assets = ['BTC/USD', 'ETH/USD', 'EUR/USD'];
    for (const asset of assets) {
      console.log(`\nFetching ${asset}...`);
      const candles = await externalDataService.getExternalCandles(asset, '1m', 5);
      if (candles.length > 0) {
        console.log(`✅ Success! Received ${candles.length} candles for ${asset}`);
        console.log('Last candle:', JSON.stringify(candles[candles.length - 1], null, 2));
      } else {
        console.log(`❌ Failed to fetch candles for ${asset}`);
      }
    }
  } catch (err) {
    console.error('Test error:', err);
  }
}

test();
