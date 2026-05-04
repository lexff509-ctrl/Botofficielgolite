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
  marketStructure?: string;
  signalScore?: string;
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [asset, setAsset] = useState("EUR/USD (OTC)");
  const [timeframe, setTimeframe] = useState("1m");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "elite">("all");
  const [lastSignal, setLastSignal] = useState<Signal | null>(null);
  const [signalError, setSignalError] = useState("");

  const fetchSignals = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/signals");
      const data = await res.json();
      if (data.signals) {
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
        setLastSignal(data.signal);
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
    const interval = setInterval(generateSignal, 15000); // Faster refresh for OTC
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
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-[#0a0f1e]/80 backdrop-blur-xl border border-white/5 p-6 rounded-3xl">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-black text-white tracking-tighter">
                SMC <span className="text-cyan-400">SIGNALS</span> PRO
              </h1>
              <span className="bg-cyan-500/10 text-cyan-400 text-[10px] font-black px-2 py-0.5 rounded-full border border-cyan-500/20 uppercase tracking-widest">Live v2.0</span>
            </div>
            <p className="text-slate-500 text-xs font-bold uppercase tracking-[0.2em]">
              Analyse Institutionnelle • Multi-Confirmation • Précision 98%
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
             <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-2xl p-1.5 px-4">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Auto-Analyse</span>
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`relative w-11 h-5 rounded-full transition-all duration-300 ${
                    autoRefresh ? "bg-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.4)]" : "bg-slate-700"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all duration-300 ${
                      autoRefresh ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              
              <div className="flex bg-white/5 p-1 rounded-2xl border border-white/5">
                {[
                  { id: "all", label: "TOUS", color: "text-slate-400" },
                  { id: "high", label: "80%+", color: "text-amber-400" },
                  { id: "elite", label: "ELITE 89%+", color: "text-cyan-400" },
                ].map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setConfidenceFilter(f.id as any)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-tighter transition-all ${
                      confidenceFilter === f.id
                        ? "bg-white/10 text-white shadow-xl"
                        : f.color + " hover:text-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
          </div>
        </div>

        {signalError && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-4 text-red-400 text-sm flex items-center gap-3 animate-shake">
            <span className="text-xl">⚠️</span>
            <div className="font-bold">{signalError}</div>
          </div>
        )}

        {/* Controls and Active Signal */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <div className="glass-card rounded-3xl p-6 border-white/5 space-y-4">
              <div>
                <label className="block text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Configuration de l'Actif</label>
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  className="w-full bg-[#0a0f1e] border border-white/10 rounded-2xl px-5 py-4 text-white text-sm focus:outline-none focus:border-cyan-500 transition-all font-black"
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
              
              <div>
                <label className="block text-slate-500 text-[10px] font-black uppercase tracking-widest mb-3 ml-1">Unité de Temps</label>
                <div className="grid grid-cols-4 gap-2">
                  {TIMEFRAMES.map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={`py-2.5 rounded-xl text-[10px] font-black border transition-all ${
                        timeframe === tf 
                        ? "bg-cyan-500/10 border-cyan-500/50 text-cyan-400 shadow-lg shadow-cyan-500/10" 
                        : "bg-white/5 border-white/5 text-slate-500 hover:border-white/20"
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={generateSignal}
                disabled={generating}
                className="w-full h-14 bg-gradient-to-br from-cyan-500 via-blue-600 to-violet-600 hover:brightness-110 disabled:opacity-50 text-white font-black rounded-2xl transition-all shadow-2xl shadow-cyan-500/20 active:scale-[0.98] flex items-center justify-center gap-3"
              >
                {generating ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span className="tracking-widest uppercase text-xs">Analyse en cours...</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl">⚡</span>
                    <span className="tracking-widest uppercase text-xs">Scanner le Marché</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2">
            {lastSignal ? (
              <div
                className={`h-full glass-card rounded-3xl p-8 border-2 flex flex-col justify-center items-center relative overflow-hidden group transition-all duration-700 ${
                  lastSignal.direction === "CALL"
                    ? "border-emerald-500/30 bg-emerald-500/5 shadow-[0_0_50px_rgba(16,185,129,0.1)]"
                    : "border-red-500/30 bg-red-500/5 shadow-[0_0_50px_rgba(239,68,68,0.1)]"
                }`}
              >
                {/* Background Decor */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[180px] font-black opacity-[0.02] pointer-events-none select-none transition-all duration-700 group-hover:scale-110 ${
                  lastSignal.direction === "CALL" ? "text-emerald-500" : "text-red-500"
                }`}>
                  {lastSignal.direction}
                </div>

                <div className="relative z-10 w-full text-center">
                  <div className={`text-sm font-black uppercase tracking-[0.4em] mb-4 ${
                    lastSignal.direction === "CALL" ? "text-emerald-400" : "text-red-400"
                  }`}>
                    Signal Détecté • {lastSignal.timeframe}
                  </div>
                  
                  <div className={`text-8xl font-black mb-6 tracking-tighter filter drop-shadow-2xl transition-transform duration-500 group-hover:scale-105 ${
                    lastSignal.direction === "CALL" ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {lastSignal.direction === "CALL" ? "BUY ↑" : "SELL ↓"}
                  </div>
                  
                  <div className="text-3xl font-black text-white mb-8 tracking-tight">{lastSignal.asset}</div>
                  
                  <div className="flex flex-wrap items-center justify-center gap-6">
                    <div className="bg-[#0a0f1e] px-6 py-4 rounded-2xl border border-white/5 shadow-xl">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Confiance Algorithmique</span>
                      <span className={`text-3xl font-black ${
                        parseFloat(lastSignal.confidence) >= 89 ? "text-cyan-400" : "text-amber-400"
                      }`}>{parseFloat(lastSignal.confidence).toFixed(1)}%</span>
                    </div>
                    
                    <div className="bg-[#0a0f1e] px-6 py-4 rounded-2xl border border-white/5 shadow-xl max-w-[300px]">
                      <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Analyse Technique</span>
                      <span className="text-sm font-black text-white/90 leading-relaxed italic">
                        "{lastSignal.diagnostic || "Configuration de marché optimale détectée."}"
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full glass-card rounded-3xl p-12 flex flex-col items-center justify-center text-center border-white/5 border-dashed border-2">
                <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 animate-pulse">
                  <span className="text-4xl opacity-40">📡</span>
                </div>
                <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tighter">En attente d'analyse</h3>
                <p className="text-slate-500 text-sm max-w-xs font-medium uppercase tracking-widest">Sélectionnez un actif et lancez le scanner pour obtenir un signal.</p>
              </div>
            )}
          </div>
        </div>

        {/* Signals Table */}
        <div className="glass-card rounded-3xl overflow-hidden border-white/5">
          <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-3">
              <div className="font-black text-white tracking-tight uppercase">Flux de Signaux Temps Réel</div>
              <div className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse shadow-[0_0_8px_rgba(6,182,212,0.8)]" />
            </div>
            <button
              onClick={fetchSignals}
              disabled={loading}
              className="text-[10px] font-black text-cyan-400 uppercase tracking-widest hover:text-cyan-300 transition-all bg-cyan-500/10 px-5 py-2.5 rounded-xl border border-cyan-500/20 active:scale-95"
            >
              {loading ? "Chargement..." : "Actualiser la liste"}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-[#0a0f1e]/50 border-b border-white/5">
                  <th className="text-left text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">Actif / Marché</th>
                  <th className="text-left text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">Action</th>
                  <th className="text-left text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">TF</th>
                  <th className="text-left text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">Score de Confiance</th>
                  <th className="text-left text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">Confluence Technique</th>
                  <th className="text-left text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">Multi-TF</th>
                  <th className="text-right text-[10px] text-slate-500 px-8 py-5 font-black uppercase tracking-widest">Heure</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredSignals.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-8 py-20 text-center text-slate-600">
                       <div className="text-xs font-black uppercase tracking-[0.3em]">Aucune donnée disponible</div>
                    </td>
                  </tr>
                ) : (
                  filteredSignals.map((sig) => {
                    const mtf = sig.multiTimeframeConfirmation || {};
                    const confValue = parseFloat(sig.confidence);
                    const isElite = confValue >= 89;
                    const isHigh = confValue >= 80;
                    return (
                      <tr key={sig.id} className="hover:bg-white/[0.02] transition-colors group">
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-3">
                             <div className={`w-1 h-8 rounded-full ${sig.direction === 'CALL' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                             <div>
                                <div className="font-black text-white text-sm">{sig.asset}</div>
                                {sig.asset.includes("(OTC)") && (
                                  <span className="text-[8px] font-black text-orange-400 uppercase tracking-tighter">Marché OTC</span>
                                )}
                             </div>
                          </div>
                        </td>
                        <td className="px-8 py-5">
                          <span
                            className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border ${
                              sig.direction === "CALL"
                                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                                : "bg-red-500/10 text-red-400 border-red-500/20"
                            }`}
                          >
                            {sig.direction === "CALL" ? "BUY ↑" : "SELL ↓"}
                          </span>
                        </td>
                        <td className="px-8 py-5">
                          <span className="bg-white/5 px-3 py-1 rounded-lg text-[10px] text-white font-black border border-white/5">{sig.timeframe}</span>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex items-center gap-3">
                            <div className="h-1.5 w-20 bg-white/5 rounded-full overflow-hidden border border-white/5">
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
                        <td className="px-8 py-5">
                           <div className="text-[10px] font-bold text-slate-400 max-w-[200px] leading-relaxed italic" title={sig.diagnostic}>
                             {sig.diagnostic || "Analyse Standard"}
                           </div>
                        </td>
                        <td className="px-8 py-5">
                          <div className="flex gap-1.5">
                            {TIMEFRAMES.map((tf) => (
                              <div
                                key={tf}
                                className={`w-2 h-2 rounded-full transition-all ${
                                  mtf[tf] === sig.direction
                                    ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"
                                    : mtf[tf] === "NEUTRAL"
                                    ? "bg-white/10"
                                    : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
                                }`}
                                title={`${tf}: ${mtf[tf] || "?"}`}
                              />
                            ))}
                          </div>
                        </td>
                        <td className="px-8 py-5 text-right text-[10px] text-slate-500 font-black uppercase">
                          {new Date(sig.createdAt).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
