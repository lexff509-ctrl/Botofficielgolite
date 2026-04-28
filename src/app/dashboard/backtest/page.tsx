"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

const REGULAR_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD",
  "USD/CAD", "EUR/GBP", "BTC/USD", "ETH/USD",
];
const OTC_ASSETS = [
  "EUR/USD (OTC)", "GBP/USD (OTC)", "USD/JPY (OTC)",
  "AUD/USD (OTC)", "BTC/USD (OTC)", "ETH/USD (OTC)",
];

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
  asset: string;
  direction: string;
  result: string;
  profit: number;
  amount: string;
}

interface Trade {
  id: number;
  asset: string;
  direction: string;
  amount: string;
  profit: string;
  result: string;
  mode: string;
  isAutomatic: boolean;
  openedAt: string;
}

export default function BacktestPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [poConnected, setPoConnected] = useState(false);
  const [filterAsset, setFilterAsset] = useState("");
  const [filterMode, setFilterMode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterMode) params.set("mode", filterMode);
      if (filterAsset) params.set("asset", filterAsset);

      const res = await fetch(`/api/backtest?${params.toString()}`);
      const data = await res.json();
      if (data.stats) setStats(data.stats);
      if (data.equityCurve) setEquityCurve(data.equityCurve);
      if (data.trades) setRecentTrades(data.trades);
      if (data.poConnected !== undefined) setPoConnected(data.poConnected);
    } catch {}
    setLoading(false);
  }, [filterAsset, filterMode]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleImport = async () => {
    setImporting(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 200 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur d'importation");
      } else {
        setMessage(data.message || `${data.imported} trades importes`);
        fetchStats();
      }
    } catch {
      setError("Erreur de connexion");
    }
    setImporting(false);
  };

  const maxEquity = equityCurve.length > 0 ? Math.max(...equityCurve.map((p) => p.equity)) : 10000;
  const minEquity = equityCurve.length > 0 ? Math.min(...equityCurve.map((p) => p.equity)) : 9000;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">
              Module de <span className="gradient-text">Backtesting</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Analysez vos trades reels depuis votre compte PocketOption
            </p>
          </div>
          <button
            onClick={handleImport}
            disabled={importing || !poConnected}
            className={`px-5 py-2.5 rounded-xl font-bold text-sm transition-all ${
              poConnected
                ? "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                : "bg-slate-700 text-slate-400 cursor-not-allowed"
            }`}
          >
            {importing ? "Import en cours..." : poConnected ? "Importer mes trades PocketOption" : "Connectez PocketOption d'abord"}
          </button>
        </div>

        {!poConnected && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-yellow-400 text-sm">
            Pour importer vos trades reels, demarrez le bot avec votre SSID PocketOption d'abord.
          </div>
        )}

        {message && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm">{message}</div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>
        )}

        {/* Filters */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">FILTRES</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Mode</label>
              <select value={filterMode} onChange={(e) => setFilterMode(e.target.value)} className="w-full bg-[#0a0f1e] border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm">
                <option value="">Tous</option>
                <option value="DEMO">DEMO</option>
                <option value="LIVE">LIVE</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Actif</label>
              <select value={filterAsset} onChange={(e) => setFilterAsset(e.target.value)} className="w-full bg-[#0a0f1e] border border-slate-700 rounded-xl px-3 py-2.5 text-white text-sm">
                <option value="">Tous</option>
                <optgroup label="Marche Regulier">
                  {REGULAR_ASSETS.map((a) => (<option key={a} value={a}>{a}</option>))}
                </optgroup>
                <optgroup label="Marche OTC">
                  {OTC_ASSETS.map((a) => (<option key={a} value={a}>{a}</option>))}
                </optgroup>
              </select>
            </div>
            <div className="flex items-end">
              <button onClick={fetchStats} className="w-full bg-white/5 hover:bg-white/10 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm font-medium transition-colors">
                Actualiser
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="glass-card rounded-xl p-12 text-center"><div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Total Trades", value: stats?.totalTrades || 0, icon: "📊", color: "text-white" },
                { label: "Win Rate", value: `${stats?.winRate.toFixed(1) || 0}%`, icon: "🎯", color: (stats?.winRate || 0) >= 50 ? "text-emerald-400" : "text-red-400" },
                { label: "Profit Net", value: `$${stats?.totalProfit.toFixed(2) || 0}`, icon: "💰", color: (stats?.totalProfit || 0) >= 0 ? "text-emerald-400" : "text-red-400" },
                { label: "Profit Factor", value: stats?.profitFactor.toFixed(2) || "0", icon: "⚡", color: (stats?.profitFactor || 0) >= 1 ? "text-cyan-400" : "text-red-400" },
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
                <div className="text-slate-400 text-xs font-medium mb-4">DISTRIBUTION DES RESULTATS</div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-sm mb-1.5"><span className="text-emerald-400">Victoires</span><span className="text-white font-bold">{stats?.wins || 0}</span></div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${stats?.winRate || 0}%` }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm mb-1.5"><span className="text-red-400">Defaites</span><span className="text-white font-bold">{stats?.losses || 0}</span></div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-red-500 rounded-full" style={{ width: `${100 - (stats?.winRate || 0)}%` }} /></div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-slate-400">Gains Bruts</div><div className="text-emerald-400 font-bold">${stats?.grossProfit.toFixed(2) || 0}</div></div>
                  <div className="bg-white/5 rounded-lg p-3"><div className="text-xs text-slate-400">Pertes Brutes</div><div className="text-red-400 font-bold">${stats?.grossLoss.toFixed(2) || 0}</div></div>
                </div>
              </div>
              <div className="glass-card rounded-xl p-5">
                <div className="text-slate-400 text-xs font-medium mb-4">COURBE D'EQUITE</div>
                {equityCurve.length === 0 ? (
                  <div className="h-32 flex items-center justify-center text-slate-500 text-sm">
                    {poConnected ? "Importez vos trades pour voir la courbe" : "Aucune donnee disponible"}
                  </div>
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

            {recentTrades.length > 0 && (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="p-4 border-b border-slate-800 font-semibold text-white">
                  Derniers Trades ({recentTrades.length})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-800">
                        <th className="text-left text-xs text-slate-400 px-4 py-3">Actif</th>
                        <th className="text-left text-xs text-slate-400 px-4 py-3">Direction</th>
                        <th className="text-left text-xs text-slate-400 px-4 py-3">Montant</th>
                        <th className="text-left text-xs text-slate-400 px-4 py-3">Profit</th>
                        <th className="text-left text-xs text-slate-400 px-4 py-3">Mode</th>
                        <th className="text-left text-xs text-slate-400 px-4 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentTrades.map((trade) => (
                        <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-white/5">
                          <td className="px-4 py-3 text-sm text-white">{trade.asset}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.direction === "CALL" ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
                              {trade.direction}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-white">${parseFloat(trade.amount).toFixed(2)}</td>
                          <td className="px-4 py-3 text-sm font-mono">
                            <span className={parseFloat(trade.profit) >= 0 ? "text-emerald-400" : "text-red-400"}>
                              ${parseFloat(trade.profit).toFixed(2)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.mode === "LIVE" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"}`}>
                              {trade.mode}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {new Date(trade.openedAt).toLocaleString("fr-FR")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
