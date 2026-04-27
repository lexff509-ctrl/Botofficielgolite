"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

const ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD",
  "USD/CAD", "EUR/GBP", "BTC/USD", "ETH/USD",
];
const TIMEFRAMES = ["5s", "10s", "15s", "30s", "1m", "3m", "5m"];

interface Signal {
  id: number;
  asset: string;
  direction: string;
  timeframe: string;
  confidence: string;
  rsi: string;
  macd: string;
  stochastic: string;
  multiTimeframeConfirmation: Record<string, string>;
  createdAt: string;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [asset, setAsset] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("1m");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastSignal, setLastSignal] = useState<{direction: string; asset: string; confidence: string} | null>(null);

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/signals");
      const data = await res.json();
      if (data.signals) setSignals(data.signals);
    } catch {}
    setLoading(false);
  }, []);

  const generateSignal = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/signals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset, timeframe }),
      });
      const data = await res.json();
      if (data.signal) {
        setLastSignal({
          direction: data.signal.direction,
          asset: data.signal.asset,
          confidence: data.signal.confidence,
        });
        fetchSignals();
      }
    } catch {}
    setGenerating(false);
  };

  useEffect(() => {
    fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(generateSignal, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, asset, timeframe]);

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">
              Signaux <span className="gradient-text">Trading</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Signaux CALL/PUT générés par analyse technique multi-timeframe
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">Auto</span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                autoRefresh ? "bg-cyan-500" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  autoRefresh ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Paire</label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="bg-[#0a0f1e] border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500"
              >
                {ASSETS.map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="bg-[#0a0f1e] border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>
            <button
              onClick={generateSignal}
              disabled={generating}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl transition-all text-sm"
            >
              {generating ? "Analyse en cours..." : "🔍 Analyser"}
            </button>
          </div>
        </div>

        {lastSignal && (
          <div
            className={`rounded-xl p-5 border-2 text-center animate-slide-up ${
              lastSignal.direction === "CALL"
                ? "bg-emerald-500/10 border-emerald-500/50"
                : "bg-red-500/10 border-red-500/50"
            }`}
          >
            <div className="text-4xl font-black mb-2">
              {lastSignal.direction === "CALL" ? "⬆️ CALL" : "⬇️ PUT"}
            </div>
            <div className="text-xl font-bold text-white">{lastSignal.asset}</div>
            <div className="text-slate-400 mt-1">
              Confiance: <span className="text-cyan-400 font-bold">{parseFloat(lastSignal.confidence).toFixed(1)}%</span>
            </div>
          </div>
        )}

        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex items-center justify-between">
            <div className="font-semibold text-white">Historique des Signaux</div>
            <button
              onClick={fetchSignals}
              disabled={loading}
              className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors"
            >
              {loading ? "Chargement..." : "↻ Actualiser"}
            </button>
          </div>

          {signals.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div className="text-4xl mb-3">📡</div>
              <div>Aucun signal pour le moment</div>
              <div className="text-sm mt-1">Cliquez sur "Analyser" pour générer votre premier signal</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">Paire</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">Signal</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">TF</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">Confiance</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">RSI</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">Multi-TF</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">Heure</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((sig) => {
                    const mtf = sig.multiTimeframeConfirmation || {};
                    const tfs = Object.keys(mtf);
                    const confirms = tfs.filter((tf) => mtf[tf] === sig.direction).length;
                    return (
                      <tr key={sig.id} className="border-b border-slate-800/50 hover:bg-white/5 transition-colors">
                        <td className="px-4 py-3 text-sm font-semibold text-white">{sig.asset}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-bold ${
                              sig.direction === "CALL"
                                ? "badge-call"
                                : "badge-put"
                            }`}
                          >
                            {sig.direction === "CALL" ? "⬆️ CALL" : "⬇️ PUT"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-300 font-mono">{sig.timeframe}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 bg-slate-700 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-cyan-500 to-violet-600 rounded-full"
                                style={{ width: `${parseFloat(sig.confidence)}%` }}
                              />
                            </div>
                            <span className="text-xs text-cyan-400 font-bold">
                              {parseFloat(sig.confidence).toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                          {sig.rsi ? parseFloat(sig.rsi).toFixed(2) : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-0.5">
                            {TIMEFRAMES.map((tf) => (
                              <div
                                key={tf}
                                className={`w-2 h-2 rounded-sm ${
                                  mtf[tf] === sig.direction
                                    ? "bg-emerald-500"
                                    : mtf[tf] === "NEUTRAL"
                                    ? "bg-slate-600"
                                    : "bg-red-500"
                                }`}
                                title={`${tf}: ${mtf[tf] || "?"}`}
                              />
                            ))}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">{confirms}/{tfs.length}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {new Date(sig.createdAt).toLocaleTimeString("fr-FR")}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
