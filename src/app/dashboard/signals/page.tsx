"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

const REGULAR_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD",
  "USD/CAD", "EUR/GBP", "BTC/USD", "ETH/USD",
  "USD/CHF", "EUR/JPY", "GBP/JPY", "NZD/USD",
  "EUR/CHF", "AUD/JPY", "CAD/JPY", "EUR/CAD",
];

const OTC_ASSETS = [
  "EUR/USD (OTC)", "GBP/USD (OTC)", "USD/JPY (OTC)",
  "AUD/USD (OTC)", "BTC/USD (OTC)", "ETH/USD (OTC)",
  "USD/CHF (OTC)", "EUR/JPY (OTC)", "GBP/JPY (OTC)",
  "NZD/USD (OTC)", "EUR/CHF (OTC)", "AUD/JPY (OTC)",
  "CAD/JPY (OTC)", "EUR/CAD (OTC)", "USD/CAD (OTC)",
  "EUR/GBP (OTC)", "AUD/CAD (OTC)", "GBP/CHF (OTC)",
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
  diagnostic: string;
  createdAt: string;
  isActive?: boolean;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [asset, setAsset] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("1m");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "elite">("all");
  const [lastSignal, setLastSignal] = useState<{direction: string; asset: string; confidence: string; diagnostic: string} | null>(null);
  const [signalError, setSignalError] = useState("");

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/signals");
      const data = await res.json();
      if (data.signals) {
        // Newest are already first from API
        setSignals(data.signals);
      }
    } catch {}
    setLoading(false);
  }, []);

  const generateSignal = async () => {
    setGenerating(true);
    setSignalError("");
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
          diagnostic: data.signal.diagnostic,
        });
        fetchSignals();
      } else if (data.error) {
        setSignalError(data.error);
      }
    } catch {
      setSignalError("Erreur de connexion au serveur");
    }
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

  const filteredSignals =
    confidenceFilter === "elite"
      ? signals.filter((s) => parseFloat(s.confidence) >= 89)
      : confidenceFilter === "high"
      ? signals.filter((s) => parseFloat(s.confidence) >= 80)
      : signals;

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        {signalError && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-amber-400 text-sm flex items-center gap-3">
            <span className="text-xl">⚠️</span>
            <div>
              <div className="font-bold">{signalError}</div>
              {signalError.includes("connect") && (
                <div className="text-amber-400/70 text-xs mt-0.5">Lancez le bot d'abord pour établir la connexion PocketOption, ou attendez que les données s'accumulent.</div>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tighter">
              Système de <span className="gradient-text">Signaux Élite</span>
            </h1>
            <p className="text-slate-500 text-sm mt-1 font-medium uppercase tracking-wider">
              Analyse Multi-Timeframe • Confiance 89-200%
            </p>
          </div>
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-2xl p-2 px-4">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Auto-Refresh</span>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative w-12 h-6 rounded-full transition-all duration-300 ${
                autoRefresh ? "bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.5)]" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${
                  autoRefresh ? "translate-x-7" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6 border-white/5">
          <div className="flex flex-wrap items-end gap-6">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Actif Financier</label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                className="w-full bg-[#0a0f1e] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-all font-bold"
              >
                <optgroup label="Marché Régulier" className="bg-slate-900">
                  {REGULAR_ASSETS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </optgroup>
                <optgroup label="Marché OTC" className="bg-slate-900">
                  {OTC_ASSETS.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <div className="w-32">
              <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full bg-[#0a0f1e] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-all font-bold"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>{tf}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-2">Filtre Confiance</label>
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/5">
                {[
                  { id: "all", label: "Tous", color: "text-slate-400" },
                  { id: "high", label: "80%+", color: "text-amber-400" },
                  { id: "elite", label: "Élite", color: "text-cyan-400" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setConfidenceFilter(f.id as any)}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-tighter transition-all ${
                      confidenceFilter === f.id
                        ? "bg-white/10 text-white shadow-lg"
                        : f.color + " hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={generateSignal}
              disabled={generating}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 text-white font-black px-8 py-3 rounded-xl transition-all shadow-lg shadow-cyan-500/20 active:scale-95"
            >
              {generating ? "ANALYSE..." : "GÉNÉRER SIGNAL"}
            </button>
          </div>
        </div>

        {lastSignal && (
          <div
            className={`glass-card rounded-2xl p-8 border-2 text-center relative overflow-hidden group transition-all duration-500 ${
              lastSignal.direction === "CALL"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-red-500/30 bg-red-500/5"
            }`}
          >
            <div className="relative z-10">
              <div className={`text-6xl font-black mb-4 tracking-tighter ${
                lastSignal.direction === "CALL" ? "text-emerald-400" : "text-red-400"
              }`}>
                {lastSignal.direction === "CALL" ? "ACHAT ↑" : "VENTE ↓"}
              </div>
              <div className="text-2xl font-black text-white mb-2">{lastSignal.asset}</div>
              <div className="flex items-center justify-center gap-4">
                <div className="bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Confiance</span>
                  <span className="text-xl font-black text-cyan-400">{parseFloat(lastSignal.confidence).toFixed(1)}%</span>
                </div>
                <div className="bg-white/5 px-4 py-2 rounded-xl border border-white/10">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Diagnostic</span>
                  <span className="text-sm font-black text-white">{lastSignal.diagnostic || "Analyse Standard"}</span>
                </div>
              </div>
            </div>
            <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[120px] font-black opacity-[0.03] pointer-events-none select-none ${
               lastSignal.direction === "CALL" ? "text-emerald-500" : "text-red-500"
            }`}>
              {lastSignal.direction}
            </div>
          </div>
        )}

        <div className="glass-card rounded-2xl overflow-hidden border-white/5">
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-3">
              <div className="font-black text-white tracking-tight">HISTORIQUE DES SIGNAUX</div>
              <div className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-pulse" />
            </div>
            <button
              onClick={fetchSignals}
              disabled={loading}
              className="text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-cyan-300 transition-colors bg-cyan-500/10 px-4 py-2 rounded-lg border border-cyan-500/20"
            >
              {loading ? "CHARGEMENT..." : "ACTUALISER"}
            </button>
          </div>

          {filteredSignals.length === 0 ? (
            <div className="p-20 text-center text-slate-600">
              <div className="text-6xl mb-4 opacity-20">📡</div>
              <div className="text-sm font-black uppercase tracking-widest">Aucun signal détecté</div>
              <p className="text-xs text-slate-500 mt-2">Affinez vos filtres ou lancez une nouvelle analyse.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-white/5 border-b border-white/5">
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">Actif</th>
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">Direction</th>
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">TF</th>
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">Confiance</th>
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">Diagnostic</th>
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">Multi-TF</th>
                    <th className="text-left text-[10px] text-slate-500 px-6 py-4 font-black uppercase tracking-widest">Temps</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredSignals.map((sig) => {
                    const mtf = sig.multiTimeframeConfirmation || {};
                    const tfs = Object.keys(mtf);
                    const confValue = parseFloat(sig.confidence);
                    const isElite = confValue >= 89;
                    const isHigh = confValue >= 80;
                    return (
                      <tr key={sig.id} className="hover:bg-white/5 transition-colors group">
                        <td className="px-6 py-4">
                          <div className="font-black text-white text-sm flex items-center gap-2">
                            {sig.asset}
                            {sig.asset.includes("(OTC)") && (
                              <span className="text-[9px] font-black bg-orange-500/10 text-orange-400 border border-orange-500/20 px-1.5 py-0.5 rounded uppercase">OTC</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${
                              sig.direction === "CALL"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-red-500/10 text-red-400 border-red-500/20"
                            }`}
                          >
                            {sig.direction === "CALL" ? "ACHAT ↑" : "VENTE ↓"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-400 font-black">{sig.timeframe}</td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 w-16 bg-white/5 rounded-full overflow-hidden border border-white/5">
                              <div
                                className={`h-full rounded-full transition-all duration-1000 ${
                                  isElite ? "bg-gradient-to-r from-cyan-400 to-blue-600 shadow-[0_0_10px_rgba(6,182,212,0.5)]" :
                                  isHigh ? "bg-gradient-to-r from-amber-400 to-orange-600" :
                                  "bg-slate-500"
                                }`}
                                style={{ width: `${Math.min(100, confValue)}%` }}
                              />
                            </div>
                            <span className={`text-xs font-black ${
                              isElite ? "text-cyan-400" : isHigh ? "text-amber-400" : "text-slate-400"
                            }`}>
                              {confValue.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                           <div className="text-[10px] font-bold text-slate-300 max-w-[150px] truncate" title={sig.diagnostic}>
                             {sig.diagnostic || "Analyse Standard"}
                           </div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex gap-1">
                            {TIMEFRAMES.map((tf) => (
                              <div
                                key={tf}
                                className={`w-1.5 h-3 rounded-full transition-all ${
                                  mtf[tf] === sig.direction
                                    ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]"
                                    : mtf[tf] === "NEUTRAL"
                                    ? "bg-white/10"
                                    : "bg-red-500"
                                }`}
                                title={`${tf}: ${mtf[tf] || "?"}`}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-[10px] text-slate-500 font-bold uppercase">
                          {new Date(sig.createdAt).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' })}
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
