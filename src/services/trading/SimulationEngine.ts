/**
 * SimulationEngine — Paper Trading (M9)
 * 
 * Mirrors all signals from StrategyEngineV6 without real execution.
 * Tracks: Win rate, Drawdown, Profit Factor, Streaks.
 * Compares paper performance vs real performance.
 */

import { StrategyOutput } from "./StrategyEngineV6";

export interface PaperTrade {
  id: string;
  asset: string;
  direction: "BUY" | "SELL";
  signal: StrategyOutput;
  openedAt: number;
  closedAt: number | null;
  openPrice: number;
  closePrice: number | null;
  amount: number;
  pnl: number | null;
  result: "WIN" | "LOSS" | "PENDING";
  payoutRate: number;
}

export interface SimulationMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;          // 0-1
  totalPnl: number;
  maxDrawdown: number;
  profitFactor: number;     // gross profit / gross loss
  currentStreak: number;    // positive = wins, negative = losses
  maxWinStreak: number;
  maxLossStreak: number;
  avgScore: number;
  sharpeSim: number;        // simplified Sharpe
}

export class SimulationEngine {
  private trades: PaperTrade[] = [];
  private baseAmount: number;
  private payoutRate: number;

  constructor(baseAmount = 1, payoutRate = 0.92) {
    this.baseAmount = baseAmount;
    this.payoutRate = payoutRate;
  }

  /** Record a signal for paper trading */
  openTrade(
    asset: string,
    direction: "BUY" | "SELL",
    openPrice: number,
    signal: StrategyOutput
  ): string {
    const id = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.trades.push({
      id, asset, direction, signal,
      openedAt: Date.now(),
      closedAt: null,
      openPrice,
      closePrice: null,
      amount: this.baseAmount,
      pnl: null,
      result: "PENDING",
      payoutRate: this.payoutRate,
    });
    return id;
  }

  /** Close a paper trade with result price */
  closeTrade(id: string, closePrice: number, durationSec: number): PaperTrade | null {
    const trade = this.trades.find(t => t.id === id);
    if (!trade || trade.result !== "PENDING") return null;

    trade.closedAt = Date.now();
    trade.closePrice = closePrice;

    const isWin = (trade.direction === "BUY" && closePrice > trade.openPrice) ||
                  (trade.direction === "SELL" && closePrice < trade.openPrice);

    trade.pnl = isWin
      ? trade.amount * trade.payoutRate
      : -trade.amount;
    trade.result = isWin ? "WIN" : "LOSS";

    return trade;
  }

  /** Compute full metrics */
  getMetrics(): SimulationMetrics {
    const closed = this.trades.filter(t => t.result !== "PENDING");
    const wins   = closed.filter(t => t.result === "WIN");
    const losses = closed.filter(t => t.result === "LOSS");

    const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const grossProfit = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
    const grossLoss   = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

    // Max drawdown
    let peak = 0, maxDrawdown = 0, running = 0;
    for (const t of closed) {
      running += t.pnl ?? 0;
      if (running > peak) peak = running;
      const dd = peak - running;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Streaks
    let currentStreak = 0, maxWinStreak = 0, maxLossStreak = 0, tempStreak = 0;
    let lastResult: string | null = null;
    for (const t of closed) {
      if (t.result === lastResult) {
        tempStreak++;
      } else {
        tempStreak = 1;
        lastResult = t.result;
      }
      if (t.result === "WIN") {
        maxWinStreak  = Math.max(maxWinStreak, tempStreak);
        currentStreak = tempStreak;
      } else {
        maxLossStreak  = Math.max(maxLossStreak, tempStreak);
        currentStreak = -tempStreak;
      }
    }

    const avgScore = closed.length > 0
      ? Math.round(closed.reduce((s, t) => s + t.signal.score, 0) / closed.length)
      : 0;

    // Simplified Sharpe (pnl / stddev of pnls)
    const pnls = closed.map(t => t.pnl ?? 0);
    const mean = pnls.length > 0 ? totalPnl / pnls.length : 0;
    const variance = pnls.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / (pnls.length || 1);
    const stddev = Math.sqrt(variance);
    const sharpeSim = stddev > 0 ? parseFloat((mean / stddev).toFixed(2)) : 0;

    return {
      totalTrades: closed.length,
      wins: wins.length,
      losses: losses.length,
      winRate: closed.length > 0 ? parseFloat((wins.length / closed.length).toFixed(3)) : 0,
      totalPnl: parseFloat(totalPnl.toFixed(2)),
      maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
      profitFactor: grossLoss > 0 ? parseFloat((grossProfit / grossLoss).toFixed(2)) : 0,
      currentStreak,
      maxWinStreak,
      maxLossStreak,
      avgScore,
      sharpeSim,
    };
  }

  /** Compare paper vs real */
  compareWithReal(realWins: number, realLosses: number, realPnl: number): Record<string, any> {
    const paper = this.getMetrics();
    const realWinRate = (realWins + realLosses) > 0
      ? realWins / (realWins + realLosses) : 0;
    return {
      paper_winRate: paper.winRate,
      real_winRate:  parseFloat(realWinRate.toFixed(3)),
      paper_pnl:     paper.totalPnl,
      real_pnl:      parseFloat(realPnl.toFixed(2)),
      paper_drawdown: paper.maxDrawdown,
      strategy_edge: parseFloat((paper.winRate - realWinRate).toFixed(3)),
    };
  }

  reset(): void { this.trades = []; }
  getTrades(): PaperTrade[] { return [...this.trades]; }
}
