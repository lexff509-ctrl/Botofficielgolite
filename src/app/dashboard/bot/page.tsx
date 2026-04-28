"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

interface BotSession {
  id: number;
  mode: string;
  botType: string;
  asset: string;
  timeframe: string;
  tradeAmount: string;
  isRunning: boolean;
  totalTrades: number;
  wins: number;
  losses: number;
  totalProfit: string;
  startedAt: string;
  stoppedAt: string | null;
}

interface RunnerStatus {
  userId: number;
  botType: "signal" | "auto";
  asset: string;
  timeframe: string;
  mode: "DEMO" | "LIVE";
  tradeAmount: number;
  confidenceMode: "standard" | "high";
  running: boolean;
  paused: boolean;
  signalsGenerated: number;
  tradesExecuted: number;
  consecutiveErrors: number;
  lastSignalAt: number | null;
  startedAt: string;
}

const REGULAR_ASSETS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD",
  "USD/CAD", "EUR/GBP", "BTC/USD", "ETH/USD",
];

const OTC_ASSETS = [
  "EUR/USD (OTC)", "GBP/USD (OTC)", "USD/JPY (OTC)",
  "AUD/USD (OTC)", "BTC/USD (OTC)", "ETH/USD (OTC)",
];

const TIMEFRAMES = [
  { value: "5s", label: "5 secondes" },
  { value: "10s", label: "10 secondes" },
  { value: "15s", label: "15 secondes" },
  { value: "30s", label: "30 secondes" },
  { value: "1m", label: "1 minute" },
  { value: "3m", label: "3 minutes" },
  { value: "5m", label: "5 minutes" },
];

export default function BotPage() {
  const [sessions, setSessions] = useState<BotSession[]>([]);
  const [activeSession, setActiveSession] = useState<BotSession | null>(null);
  const [runnerStatus, setRunnerStatus] = useState<RunnerStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("DEMO");
  const [ssid, setSsid] = useState("");
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [botType, setBotType] = useState<"signal" | "auto">("signal");
  const [asset, setAsset] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("1m");
  const [tradeAmount, setTradeAmount] = useState(1);
  const [confidenceMode, setConfidenceMode] = useState<"standard" | "high">("standard");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.user) {
        const u = data.user as Record<string, unknown>;
        setUser(u);
        setMode(u.tradeMode as string || "DEMO");
        // Pre-fill trade amount from profile defaults
        const currentMode = (u.tradeMode as string) || "DEMO";
        const defaultAmount = currentMode === "DEMO"
          ? parseFloat(String(u.demoTradeAmount || "1"))
          : parseFloat(String(u.liveTradeAmount || "1"));
        setTradeAmount(defaultAmount);
      }
    } catch {}
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/bot");
      const data = await res.json();
      if (data.sessions) setSessions(data.sessions);
      if (data.activeSession) {
        setActiveSession(data.activeSession);
        // Sync UI state from active session
        if (data.activeSession.botType) setBotType(data.activeSession.botType);
        if (data.activeSession.asset) setAsset(data.activeSession.asset);
        if (data.activeSession.timeframe) setTimeframe(data.activeSession.timeframe);
      } else {
        setActiveSession(null);
      }
      if (data.runnerStatus) {
        setRunnerStatus(data.runnerStatus);
        if (data.runnerStatus.confidenceMode) setConfidenceMode(data.runnerStatus.confidenceMode);
      }
      else setRunnerStatus(null);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUser();
    fetchSessions();
  }, [fetchUser, fetchSessions]);

  // Poll runner status while running
  useEffect(() => {
    if (!activeSession?.isRunning) return;
    const interval = setInterval(() => {
      fetchSessions();
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSession, fetchSessions]);

  const handleBotAction = async (action: "START" | "STOP") => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          mode,
          botType,
          asset,
          timeframe,
          tradeAmount,
          confidenceMode,
          ssid: ssid || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        let errorMsg = data.error || "Erreur";
        if (data.ssidExpired || errorMsg.includes("timeout") || errorMsg.includes("SSID")) {
          errorMsg = "SSID invalide ou expire. Allez dans Profil pour copier un nouveau SSID PocketOption.";
        }
        setError(errorMsg);
      } else {
        setSuccess(
          action === "START" ? "Bot démarré avec succès!" : "Bot arrêté."
        );
        if (data.runnerStatus) setRunnerStatus(data.runnerStatus);
        fetchSessions();
      }
    } catch {
      setError("Erreur de connexion");
    }
    setLoading(false);
  };

  const isRunning = !!activeSession?.isRunning;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Bot <span className="gradient-text">Automatique</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Configurez et lancez votre bot de trading PocketOption
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm">
            {success}
          </div>
        )}

        {/* Bot Type Selection */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">TYPE DE BOT</div>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setBotType("signal")}
              disabled={isRunning}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                botType === "signal"
                  ? "border-cyan-500/50 bg-cyan-500/10"
                  : "border-slate-700 hover:border-slate-600"
              } disabled:opacity-50`}
            >
              <div className="text-2xl mb-2">📊</div>
              <div className="font-bold text-white">Bot Signal</div>
              <div className="text-xs text-slate-400 mt-1">
                Génère des signaux CALL/PUT basés sur les données réelles. Vous tradez manuellement.
              </div>
            </button>
            <button
              onClick={() => setBotType("auto")}
              disabled={isRunning}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                botType === "auto"
                  ? "border-violet-500/50 bg-violet-500/10"
                  : "border-slate-700 hover:border-slate-600"
              } disabled:opacity-50`}
            >
              <div className="text-2xl mb-2">🤖</div>
              <div className="font-bold text-white">Bot Automatique</div>
              <div className="text-xs text-slate-400 mt-1">
                Trade automatiquement selon la strategie de confiance. Requiert SSID PocketOption.
              </div>
            </button>
          </div>
        </div>

        {/* Configuration */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">CONFIGURATION</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Asset Selector */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Actif</label>
              <select
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              >
                <optgroup label="Marché Régulier" className="bg-slate-900">
                  {REGULAR_ASSETS.map((a) => (
                    <option key={a} value={a} className="bg-slate-900">{a}</option>
                  ))}
                </optgroup>
                <optgroup label="Marché OTC" className="bg-slate-900">
                  {OTC_ASSETS.map((a) => (
                    <option key={a} value={a} className="bg-slate-900">{a}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            {/* Timeframe Selector */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf.value} value={tf.value} className="bg-slate-900">{tf.label}</option>
                ))}
              </select>
            </div>

            {/* Trade Amount */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">
                Montant par Trade ($)
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={tradeAmount}
                onChange={(e) => setTradeAmount(parseFloat(e.target.value) || 1)}
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              />
              <p className="text-xs text-slate-500 mt-1">
                Montant investi par trade automatique
              </p>
            </div>

            {/* Confidence Mode */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Strategie de Confiance</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfidenceMode("standard")}
                  disabled={isRunning}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${
                    confidenceMode === "standard"
                      ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  } disabled:opacity-50`}
                >
                  Standard 70%+
                </button>
                <button
                  onClick={() => setConfidenceMode("high")}
                  disabled={isRunning}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${
                    confidenceMode === "high"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  } disabled:opacity-50`}
                >
                  Haute 80%+
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {confidenceMode === "standard"
                  ? "Trade des 70%+ de confiance - plus de signaux"
                  : "Trade des 80%+ de confiance - signaux plus fiables"}
              </p>
            </div>

            {/* Mode Selector */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Mode de Trading</label>
              <div className="flex gap-2">
                {["DEMO", "LIVE"].map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    disabled={isRunning}
                    className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${
                      mode === m
                        ? m === "DEMO"
                          ? "border-blue-500/50 bg-blue-500/10 text-blue-400"
                          : "border-green-500/50 bg-green-500/10 text-green-400"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"
                    } disabled:opacity-50`}
                  >
                    {m === "DEMO" ? "🔵 DEMO" : "🔴 LIVE"}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {mode === "DEMO"
                  ? "Trading simulé avec capital fictif ($10,000)"
                  : "Trading réel avec votre compte PocketOption"}
              </p>
            </div>

            {/* SSID Input */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">
                SSID PocketOption{" "}
                <span className="text-slate-600">(requis pour les données réelles)</span>
              </label>
              <input
                type="password"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                disabled={isRunning}
                placeholder="Votre SSID PocketOption..."
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm font-mono disabled:opacity-50"
              />
              <p className="text-xs text-slate-500 mt-1">
                🔒 Chiffré AES-256 et isolé par session utilisateur
              </p>
            </div>
          </div>

          {mode === "LIVE" && (
            <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400 text-sm">
              ⚠️ Mode LIVE: Les trades seront exécutés avec votre capital réel PocketOption. Tradez responsablement.
            </div>
          )}
        </div>

        {/* Bot Status */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-slate-400 text-xs font-medium mb-1">STATUT DU BOT</div>
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isRunning ? "bg-emerald-400 animate-pulse" : runnerStatus?.paused ? "bg-yellow-400" : "bg-slate-500"
                  }`}
                />
                <span className="font-bold text-white text-lg">
                  {runnerStatus?.paused ? "En pause" : isRunning ? "En cours d'exécution" : "Arrêté"}
                </span>
                {isRunning && activeSession && (
                  <span className="text-xs text-slate-400">
                    {activeSession.botType === "signal" ? "Signal" : "Auto"} · {activeSession.asset} · {activeSession.timeframe} · {runnerStatus?.confidenceMode === "high" ? "80%+" : "70%+"}
                  </span>
                )}
              </div>
            </div>

            <button
              onClick={() => handleBotAction(isRunning ? "STOP" : "START")}
              disabled={loading}
              className={`px-8 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                isRunning
                  ? "bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400"
                  : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white shadow-lg shadow-cyan-500/20"
              }`}
            >
              {loading ? "..." : isRunning ? "⏹ Arrêter" : "▶ Démarrer"}
            </button>
          </div>

          {isRunning && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              {[
                { label: "Signaux", value: runnerStatus?.signalsGenerated ?? activeSession?.totalTrades ?? 0, color: "text-cyan-400" },
                { label: "Trades", value: runnerStatus?.tradesExecuted ?? activeSession?.totalTrades ?? 0, color: "text-white" },
                { label: "Montant", value: `$${runnerStatus?.tradeAmount ?? parseFloat(activeSession?.tradeAmount as string || "1")}`, color: "text-violet-400" },
                { label: "Victoires", value: activeSession?.wins || 0, color: "text-emerald-400" },
                { label: "Défaites", value: activeSession?.losses || 0, color: "text-red-400" },
                {
                  label: "Profit",
                  value: `$${parseFloat(activeSession?.totalProfit || "0").toFixed(2)}`,
                  color: parseFloat(activeSession?.totalProfit || "0") >= 0 ? "text-emerald-400" : "text-red-400",
                },
              ].map((stat) => (
                <div key={stat.label} className="bg-white/5 rounded-xl p-3 text-center">
                  <div className={`text-xl font-black ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
          )}

          {isRunning && runnerStatus?.paused && (
            <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-center">
              <div className="text-yellow-400 text-sm font-medium">
                ⚠️ Bot en pause - {runnerStatus.consecutiveErrors} erreurs consécutives
              </div>
            </div>
          )}

          {isRunning && !runnerStatus?.paused && (
            <div className="mt-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 text-center">
              <div className="text-cyan-400 text-sm font-medium">
                📡 {runnerStatus?.signalsGenerated ?? 0} signaux générés · {runnerStatus?.tradesExecuted ?? 0} trades exécutés · Analyse en temps réel...
              </div>
            </div>
          )}
        </div>

        {/* Session History */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800">
            <div className="font-semibold text-white">Historique des Sessions</div>
          </div>
          {sessions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div className="text-4xl mb-3">🤖</div>
              Aucune session de bot pour le moment
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Type</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Actif</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">TF</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Mode</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Statut</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Trades</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Profit</th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Démarré</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b border-slate-800/50 hover:bg-white/5">
                      <td className="px-4 py-3">
                        <span className="text-sm">
                          {session.botType === "auto" ? "🤖" : "📊"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-white">{session.asset || "-"}</td>
                      <td className="px-4 py-3 text-sm text-slate-300">{session.timeframe || "-"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-bold ${
                            session.mode === "LIVE"
                              ? "bg-green-500/20 text-green-400"
                              : "bg-blue-500/20 text-blue-400"
                          }`}
                        >
                          {session.mode}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              session.isRunning ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
                            }`}
                          />
                          <span className="text-xs text-slate-300">
                            {session.isRunning ? "Actif" : "Arrêté"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-white">{session.totalTrades}</td>
                      <td className="px-4 py-3 text-sm font-mono">
                        <span className={parseFloat(session.totalProfit) >= 0 ? "text-emerald-400" : "text-red-400"}>
                          ${parseFloat(session.totalProfit).toFixed(2)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400">
                        {new Date(session.startedAt).toLocaleString("fr-FR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
