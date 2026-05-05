require('dotenv').config();
const ccxt = require('ccxt');

async function test() {
  const binance = new ccxt.binance();
  console.log('Testing Binance Connectivity...');
  try {
    const ohlcv = await binance.fetchOHLCV('BTC/USDT', '1m', undefined, 5);
    console.log('✅ Success! Received ' + ohlcv.length + ' candles from Binance');
    console.log('Last candle:', JSON.stringify(ohlcv[ohlcv.length - 1]));
  } catch (err) {
    console.error('❌ Binance error:', err.message);
  }
}

test();
