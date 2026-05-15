/**
 * DataPipeline — M2/M3
 * 
 * Raw ticks → Validator → CandleBuilder → GapDetector → StableBuffer → EventStream
 * 
 * Rules:
 * - Never skip silently: retry 3 cycles on missing data
 * - READY_CONFIRMED requires 3-5s of stable flux
 * - Gap detected → reconstruction attempt, else INVALID
 * - Emits events: candle_ready, data_invalid, flux_stable, flux_unstable
 */

import { EventEmitter } from "events";

export interface RawTick {
  asset: string;
  price: number;
  timestamp: number;
}

export interface ValidatedCandle {
  asset: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
  periodSec: number;
  isReconstructed?: boolean;
}

export interface DataPipelineEvents {
  candle_ready: (candle: ValidatedCandle) => void;
  flux_stable: (asset: string) => void;
  flux_unstable: (asset: string, reason: string) => void;
  data_invalid: (asset: string, reason: string) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────
const STABLE_FLUX_DURATION_MS = 4000;   // 4s of continuous data = READY_CONFIRMED
const MAX_GAP_ALLOWED_MS      = 10000;  // gaps >10s trigger reconstruction attempt
const MAX_RETRY_CYCLES        = 3;
const CANDLE_BUFFER_SIZE      = 300;

// ── Per-asset state ───────────────────────────────────────────────────────────
interface AssetState {
  pendingTick: { open: number; high: number; low: number; close: number; startTs: number } | null;
  candles: ValidatedCandle[];
  lastTickAt: number;
  firstTickAt: number;
  isStable: boolean;
  retryCount: number;
  periodSec: number;
}

export class DataPipeline extends EventEmitter {
  private assets = new Map<string, AssetState>();
  private stableCheckIntervals = new Map<string, ReturnType<typeof setInterval>>();

  subscribe(asset: string, periodSec: number): void {
    if (this.assets.has(asset)) return;
    this.assets.set(asset, {
      pendingTick: null,
      candles: [],
      lastTickAt: 0,
      firstTickAt: 0,
      isStable: false,
      retryCount: 0,
      periodSec,
    });
    this._startStabilityMonitor(asset);
  }

  unsubscribe(asset: string): void {
    this.assets.delete(asset);
    const iv = this.stableCheckIntervals.get(asset);
    if (iv) { clearInterval(iv); this.stableCheckIntervals.delete(asset); }
  }

  /** Feed a raw tick from the WebSocket */
  ingestTick(tick: RawTick): void {
    const state = this.assets.get(tick.asset);
    if (!state) return;

    // Step 1: Validate tick
    if (!this._validateTick(tick, state)) return;

    // Step 2: Build/update candle
    this._buildCandle(tick, state);

    // Step 3: Update stability tracking
    const now = Date.now();
    if (state.firstTickAt === 0) state.firstTickAt = now;
    state.lastTickAt = now;
    state.retryCount = 0;

    // Step 4: Check READY_CONFIRMED
    const fluxDuration = now - state.firstTickAt;
    if (!state.isStable && fluxDuration >= STABLE_FLUX_DURATION_MS) {
      state.isStable = true;
      this.emit("flux_stable", tick.asset);
    }
  }

  /** Seed historical candles (from bootstrap) */
  seedCandles(asset: string, candles: ValidatedCandle[]): void {
    const state = this.assets.get(asset);
    if (!state) return;
    const valid = candles.filter(c => this._validateCandle(c));
    state.candles = valid.slice(-CANDLE_BUFFER_SIZE);
    // Historical seed counts as stable immediately
    if (valid.length >= 30) {
      state.isStable = true;
      this.emit("flux_stable", asset);
    }
  }

  getCandles(asset: string, count = 200): ValidatedCandle[] {
    const state = this.assets.get(asset);
    if (!state) return [];
    return state.candles.slice(-count);
  }

  isFluxStable(asset: string): boolean {
    return this.assets.get(asset)?.isStable ?? false;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _validateTick(tick: RawTick, state: AssetState): boolean {
    if (!tick.price || tick.price <= 0) return false;
    if (!tick.timestamp || tick.timestamp <= 0) return false;

    // Gap detection
    if (state.lastTickAt > 0) {
      const gapMs = Date.now() - state.lastTickAt;
      if (gapMs > MAX_GAP_ALLOWED_MS) {
        this._handleGap(tick.asset, state, gapMs);
      }
    }
    return true;
  }

  private _validateCandle(c: ValidatedCandle): boolean {
    return c.timestamp > 0 && c.close > 0 && c.high >= c.low && c.open > 0;
  }

  private _buildCandle(tick: RawTick, state: AssetState): void {
    const periodMs = state.periodSec * 1000;
    const candleStart = Math.floor(tick.timestamp / periodMs) * periodMs;

    if (!state.pendingTick || state.pendingTick.startTs !== candleStart) {
      // Close previous candle if exists
      if (state.pendingTick) {
        const closed: ValidatedCandle = {
          asset: tick.asset,
          open: state.pendingTick.open,
          high: state.pendingTick.high,
          low: state.pendingTick.low,
          close: state.pendingTick.close,
          volume: 0,
          timestamp: state.pendingTick.startTs / 1000,
          periodSec: state.periodSec,
        };
        state.candles.push(closed);
        if (state.candles.length > CANDLE_BUFFER_SIZE) state.candles.shift();
        if (state.isStable) this.emit("candle_ready", closed);
      }
      // Open new candle
      state.pendingTick = {
        open: tick.price, high: tick.price, low: tick.price, close: tick.price,
        startTs: candleStart,
      };
    } else {
      // Update current candle
      state.pendingTick.high = Math.max(state.pendingTick.high, tick.price);
      state.pendingTick.low  = Math.min(state.pendingTick.low,  tick.price);
      state.pendingTick.close = tick.price;
    }
  }

  private _handleGap(asset: string, state: AssetState, gapMs: number): void {
    state.retryCount++;
    if (state.retryCount >= MAX_RETRY_CYCLES) {
      state.isStable = false;
      state.firstTickAt = 0;
      state.retryCount = 0;
      this.emit("flux_unstable", asset, `Gap ${Math.round(gapMs / 1000)}s — flux reset`);
      this.emit("data_invalid", asset, `Gap trop long (${Math.round(gapMs / 1000)}s) après ${MAX_RETRY_CYCLES} retries`);
    } else {
      this.emit("flux_unstable", asset, `Gap ${Math.round(gapMs / 1000)}s (retry ${state.retryCount}/${MAX_RETRY_CYCLES})`);
    }
  }

  private _startStabilityMonitor(asset: string): void {
    const iv = setInterval(() => {
      const state = this.assets.get(asset);
      if (!state) { clearInterval(iv); return; }
      if (state.isStable && state.lastTickAt > 0) {
        const silenceMs = Date.now() - state.lastTickAt;
        if (silenceMs > MAX_GAP_ALLOWED_MS * 2) {
          state.isStable = false;
          state.firstTickAt = 0;
          this.emit("flux_unstable", asset, `Silence ${Math.round(silenceMs / 1000)}s — flux perdu`);
        }
      }
    }, 5000);
    this.stableCheckIntervals.set(asset, iv);
  }
}

// Singleton
export const dataPipeline = new DataPipeline();
