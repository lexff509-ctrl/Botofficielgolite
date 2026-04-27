"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

interface Trade {
  id: number;
  mode: string;
  asset: string;
  direction: string;
  amount: string;
  openPrice: string;
  closePrice: string;
  timeframe: string;
  result: string;
  profit: string;
  isAutomatic: boolean;
  openedAt: string;
  closedAt: string;
}

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("ALL");
  const [placing, setPlacing] = useState(false);
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeForm, setTradeForm] = useState({
    asset: "EUR/USD",
    direction: "CALL",
    amount: "10",
    timeframe: "1m",
  });

  const fetchTrades = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "ALL" ? "/api/trades" : `/api/trades?mode=${filter}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.trades) setTrades(data.trades);
    } catch {}
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const placeTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlacing(true);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...tradeForm,
          amount: parseFloat(tradeForm.amount),
          openPrice: 1.0852 + Math.random() * 0.01,
        }),
      });
      if (res.ok) {
        setShowTradeForm(false);
        fetchTrades();
      }
    } catch {}
    setPlacing(false);
  };

  const totals = {
    wins: trades.filter((t) => t.result === "WIN").length,
    losses: trades.filter((t) => t.result === "LOSS").length,
    profit: trades.reduce((acc, t) => acc + parseFloat(t.profit || "0"), 0),
  };

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">
              Historique des <span className="gradient-text">Trades</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">Tous vos trades démo et live</p>
          </div>
          <button onClick={() => setShowTradeForm(true)} className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition-all">
            + Trade Manuel
          </button>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="glass-card rounded-xl p-4 text-center">
            <div className="text-2xl font-black text-emerald-400">{totals.wins}</div>
            <div className="text-xs text-slate-400">Victoires</div>
          </div>
          <div className="glass-card rounded-xl p-4 text-center">
            <div className="text-2xl font-black text-red-400">{totals.losses}</div>
            <div className="text-xs text-slate-400">Défaites</div>
          </div>
          <div className="glass-card rounded-xl p-4 text-center">
            <div className={`text-2xl font-black ${totals.profit >= 0 ? "text-emerald-400" : "text-red-400"}`}>${totals.profit.toFixed(2)}</div>
            <div className="text-xs text-slate-400">Profit Net</div>
          </div>
        </div>

        <div className="flex gap-2">
          {["ALL", "DEMO", "LIVE"].map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${filter === f ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30" : "text-slate-400 hover:text-white"}`}>
              {f}
            </button>
          ))}
        </div>

        <div className="glass-card rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center"><div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full mx-auto" /></div>
          ) : trades.length === 0 ? (
            <div className="p-12 text-center text-slate-500"><div className="text-4xl mb-3">📋</div>Aucun trade pour le moment</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    {["Mode", "Paire", "Direction", "Montant", "Résultat", "Profit", "TF", "Date"].map((h) => (
                      <th key={h} className="text-left text-xs text-slate-400 px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr key={trade.id} className="border-b border-slate-800/50 hover:bg-white/5 transition-colors">
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.mode === "LIVE" ? "bg-green-500/20 text-green-400" : "bg-blue-500/20 text-blue-400"}`}>{trade.mode}</span></td>
                      <td className="px-4 py-3 text-sm font-semibold text-white">{trade.asset}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.direction === "CALL" ? "badge-call" : "badge-put"}`}>{trade.direction === "CALL" ? "⬆ CALL" : "⬇ PUT"}</span></td>
                      <td className="px-4 py-3 text-sm text-white font-mono">${parseFloat(trade.amount).toFixed(2)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold ${trade.result === "WIN" ? "bg-emerald-500/20 text-emerald-400" : trade.result === "LOSS" ? "bg-red-500/20 text-red-400" : "bg-slate-500/20 text-slate-400"}`}>{trade.result === "WIN" ? "✓ WIN" : trade.result === "LOSS" ? "✗ LOSS" : "⏳"}</span></td>
                      <td className="px-4 py-3 text-sm font-mono"><span className={parseFloat(trade.profit) >= 0 ? "text-emerald-400" : "text-red-400"}>{parseFloat(trade.profit) >= 0 ? "+" : ""}${parseFloat(trade.profit).toFixed(2)}</span></td>
                      <td className="px-4 py-3 text-xs text-slate-400 font-mono">{trade.timeframe}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{new Date(trade.openedAt).toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {showTradeForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80" onClick={() => setShowTradeForm(false)} />
            <div className="relative glass-card rounded-2xl p-6 w-full max-w-md border border-slate-700">
              <h3 className="font-black text-white text-lg mb-5">Trade Manuel</h3>
              <form onSubmit={placeTrade} className="space-y-4">
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Paire</label>
                  <select value={tradeForm.asset} onChange={(e) => setTradeForm({ ...tradeForm, asset: e.target.value })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm">
                    {["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "BTC/USD"].map((a) => (<option key={a} value={a}>{a}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Direction</label>
                  <div className="flex gap-2">
                    {["CALL", "PUT"].map((d) => (
                      <button key={d} type="button" onClick={() => setTradeForm({ ...tradeForm, direction: d })} className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-2 transition-all ${tradeForm.direction === d ? d === "CALL" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" : "border-red-500/50 bg-red-500/10 text-red-400" : "border-slate-700 text-slate-400"}`}>
                        {d === "CALL" ? "⬆️ CALL" : "⬇️ PUT"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Montant ($)</label>
                  <input type="number" min="1" value={tradeForm.amount} onChange={(e) => setTradeForm({ ...tradeForm, amount: e.target.value })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm" />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Timeframe</label>
                  <select value={tradeForm.timeframe} onChange={(e) => setTradeForm({ ...tradeForm, timeframe: e.target.value })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm">
                    {["5s", "10s", "15s", "30s", "1m", "3m", "5m"].map((tf) => (<option key={tf} value={tf}>{tf}</option>))}
                  </select>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowTradeForm(false)} className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm">Annuler</button>
                  <button type="submit" disabled={placing} className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm disabled:opacity-50">{placing ? "En cours..." : "Placer le Trade"}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
