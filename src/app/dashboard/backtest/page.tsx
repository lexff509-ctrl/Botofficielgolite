"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";

interface Stats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
}

interface EquityPoint {
  date: string;
  equity: number;
  result: string;
}

export default function BacktestPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [config, setConfig] = useState({
    capital: 10000,
    tradeSize: 10,
    asset: "EUR/USD",
    numTrades: 50,
    timeframe: "1m",
  });

  const fetchStats = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/trades/stats?mode=DEMO");
      const data = await res.json();
      if (data.stats) {
        setStats(data.stats);
        setEquityCurve(data.equityCurve || []);
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const runBacktest = async () => {
    setRunning(true);
    try {
      const promises = Array.from({ length: config.numTrades }, () =>
        fetch("/api/trades", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asset: config.asset,
            direction: Math.random() > 0.5 ? "CALL" : "PUT",
            amount: config.tradeSize,
            timeframe: config.timeframe,
            mode: "DEMO",
            openPrice: 1.0852 + Math.random() * 0.01,
          }),
        })
      );
      await Promise.all(promises);
      await fetchStats();
    } catch {}
    setRunning(false);
  };

  const maxEquity = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.equity)) : 10000;
  const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve.map((p) => p.equity)) : 9000;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Module de <span className="gradient-text">Backtesting</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Testez votre stratégie sur des données historiques simulées</p>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">CONFIGURATION DU BACKTEST</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Capital ($)</label>
              <input type="number" value={config.capital} onChange={(e) => setConfig({ ...config, capital: parseInt(e.target.value) })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Taille Trade ($)</label>
              <input type="number" value={config.tradeSize} onChange={(e) => setConfig({ ...config, tradeSize: parseInt(e.target.value) })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Nb de Trades</label>
              <input type="number" min="1" max="100" value={config.numTrades} onChange={(e) => setConfig({ ...config, numTrades: parseInt(e.target.value) })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Paire</label>
              <select value={config.asset} onChange={(e) => setConfig({ ...config, asset: e.target.value })} className="w-full bg-[#0a0f1e] border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm">
                {["EUR/USD", "GBP/USD", "USD/JPY", "BTC/USD"].map((a) => (<option key={a} value={a}>{a}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Timeframe</label>
              <select value={config.timeframe} onChange={(e) => setConfig({ ...config, timeframe: e.target.value })} className="w-full bg-[#0a0f1e] border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm">
                {["5s", "10s", "15s", "30s", "1m", "3m", "5m"].map((tf) => (<option key={tf} value={tf}>{tf}</option>))}
              </select>
            </div>
          </div>
          <button onClick={runBacktest} disabled={running} className="mt-4 bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl transition-all text-sm">
            {running ? "⏳ Simulation en cours..." : "🔬 Lancer le Backtest"}
          </button>
        </div>

        {loading ? (
          <div className="glass-card rounded-xl p-12 text-center"><div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Trades", value: stats?.totalTrades || 0, icon: "📊", color: "text-white" },
                { label: "Win Rate", value: `${stats?.winRate || 0}%`, icon: "🎯", color: (stats?.winRate || 0) >= 50 ? "text-emerald-400" : "text-red-400" },
                { label: "Profit Net", value: `$${stats?.totalProfit || 0}`, icon: "💰", color: (stats?.totalProfit || 0) >= 0 ? "text-emerald-400" : "text-red-400" },
                { label: "Profit Factor", value: stats?.profitFactor || 0, icon: "⚡", color: (stats?.profitFactor || 0) >= 1 ? "text-cyan-400" : "text-red-400" },
              ].map((card) => (
                <div key={card.label} className="glass-card rounded-xl p-5">
                  <div className="text-2xl mb-2">{card.icon}</div>
                  <div className={`text-2xl font-black ${card.color}`}>{card.value}</div>
                  <div className="text-slate-400 text-xs mt-1">{card.label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card rounded-xl p-5">
                <div className="text-slate-400 text-xs font-medium mb-4">DISTRIBUTION DES RÉSULTATS</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1.5"><span className="text-emerald-400">Victoires</span><span className="text-white font-bold">{stats?.wins || 0}</span></div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${stats?.winRate || 0}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1.5"><span className="text-red-400">Défaites</span><span className="text-white font-bold">{stats?.losses || 0}</span></div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{ width: `${100 - (stats?.winRate || 0)}%` }} /></div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-slate-400">Gains Bruts</div><div className="text-emerald-400 font-bold">${stats?.grossProfit || 0}</div></div>
                  <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-slate-400">Pertes Brutes</div><div className="text-red-400 font-bold">${stats?.grossLoss || 0}</div></div>
                </div>
              </div>
              <div className="glass-card rounded-xl p-5">
                <div className="text-slate-400 text-xs font-medium mb-4">COURBE D'ÉQUITÉ</div>
                {equityCurve.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-slate-500 text-sm">Lancez un backtest pour voir la courbe</div>
                ) : (
                  <>
                    <div className="h-32 flex items-end gap-0.5">
                      {equityCurve.slice(-60).map((point, i) => {
                        const range = maxEquity - minEquity || 1;
                        const height = ((point.equity - minEquity) / range) * 100;
                        return <div key={i} className="flex-1 min-w-[1px] rounded-t transition-all" style={{ height: `${Math.max(1, height)}%`, backgroundColor: point.result === "WIN" ? "#10b981" : "#ef4444" }} />;
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-slate-500 mt-2"><span>${minEquity.toFixed(0)}</span><span>${maxEquity.toFixed(0)}</span></div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
