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
  useGlobalSsid: boolean;
}

interface RunnerStatus {
  userId: number;
  botType: "signal" | "auto";
  asset: string;
  timeframe: string;
  mode: "DEMO" | "LIVE";
  tradeAmount: number;
  confidenceMode: "standard" | "high";
  profitTarget: number;
  lossLimit: number;
  running: boolean;
  paused: boolean;
  pauseReason: string | null;
  signalsGenerated: number;
  tradesExecuted: number;
  dailyWins: number;
  dailyLosses: number;
  dailyProfit: number;
  consecutiveErrors: number;
  lastSignalAt: number | null;
  startedAt: string;
  martingaleEnabled: boolean;
  martingaleLevel: number;
  baseTradeAmount: number;
  compoundEnabled: boolean;
  compoundTradesTarget: number;
  compoundTradesTaken: number;
  compoundCurrentAmount: number;
  compoundInitialAmount: number;
  compoundPayoutRate: number;
}

interface SsidInfo {
  hasPersonalSsid: boolean;
  globalSsidAvailable: boolean;
  globalSsidStatus: string;
  onSharedClient: boolean;
}

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
  const [ssidInfo, setSsidInfo] = useState<SsidInfo | null>(null);
  const [realBalance, setRealBalance] = useState<{ demo: number; live: number } | null>(null);
  const [poAssets, setPoAssets] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState("DEMO");
  const [ssid, setSsid] = useState("");
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [botType, setBotType] = useState<"signal" | "auto">("signal");
  const [marketType, setMarketType] = useState<"REAL" | "OTC">("REAL");
  const [asset, setAsset] = useState("EUR/USD");
  const [timeframe, setTimeframe] = useState("1m");
  const [tradeAmount, setTradeAmount] = useState<number | "">(1);
  const [confidenceMode, setConfidenceMode] = useState<"standard" | "high">("standard");
  const [profitTarget, setProfitTarget] = useState<number | "">("");
  const [lossLimit, setLossLimit] = useState<number | "">("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Martingale
  const [martingaleEnabled, setMartingaleEnabled] = useState(false);
  // Compound interest
  const [compoundEnabled, setCompoundEnabled] = useState(false);
  const [compoundTradesTarget, setCompoundTradesTarget] = useState<number | "">("");
  const [compoundPayoutRate, setCompoundPayoutRate] = useState<number | "">(92);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (data.user) {
        const u = data.user as Record<string, unknown>;
        setUser(u);
        setMode(u.tradeMode as string || "DEMO");
        const currentMode = (u.tradeMode as string) || "DEMO";
        const defaultAmount = currentMode === "DEMO"
          ? parseFloat(String(u.demoTradeAmount || "1"))
          : parseFloat(String(u.liveTradeAmount || "1"));
        setTradeAmount(defaultAmount);
        if (u.profitTarget) setProfitTarget(parseFloat(String(u.profitTarget)));
        if (u.lossLimit) setLossLimit(parseFloat(String(u.lossLimit)));
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
        if (data.activeSession.botType) setBotType(data.activeSession.botType);
        if (data.activeSession.asset) setAsset(data.activeSession.asset);
        if (data.activeSession.timeframe) setTimeframe(data.activeSession.timeframe);
      } else {
        setActiveSession(null);
      }
      if (data.runnerStatus) {
        setRunnerStatus(data.runnerStatus);
        if (data.runnerStatus.confidenceMode) setConfidenceMode(data.runnerStatus.confidenceMode);
        if (data.runnerStatus.profitTarget) setProfitTarget(data.runnerStatus.profitTarget);
        if (data.runnerStatus.lossLimit) setLossLimit(data.runnerStatus.lossLimit);
        if (data.runnerStatus.compoundTradesTarget) setCompoundTradesTarget(data.runnerStatus.compoundTradesTarget);
      } else {
        setRunnerStatus(null);
      }
      if (data.ssidInfo) setSsidInfo(data.ssidInfo);
      if (data.realBalance) setRealBalance(data.realBalance);
      if (data.assets) setPoAssets(data.assets);
    } catch {}
  }, []);

  useEffect(() => {
    fetchUser();
    fetchSessions();
  }, [fetchUser, fetchSessions]);

  // Poll user every 30s to pick up extensionActive / balance changes from Bridge
  useEffect(() => {
    const interval = setInterval(() => {
      fetchUser();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchUser]);

  // Poll runner status while running
  useEffect(() => {
    if (!activeSession?.isRunning) return;
    const interval = setInterval(() => {
      fetchSessions();
    }, 10000);
    return () => clearInterval(interval);
  }, [activeSession, fetchSessions]);

  const handleBotAction = async (action: "START" | "STOP" | "RESET_COMPOUND" | "CLEAR_HISTORY") => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const pTarget = profitTarget === "" ? 50 : profitTarget;
      const lLimit = lossLimit === "" ? 25 : lossLimit;
      const cTarget = compoundTradesTarget === "" ? 3 : compoundTradesTarget;
      const cPayout = compoundPayoutRate === "" ? 0.92 : (compoundPayoutRate / 100);

      const body: Record<string, unknown> = {
        action,
        mode,
        botType,
        asset,
        timeframe,
        tradeAmount: tradeAmount || 1,
        confidenceMode,
        profitTarget: pTarget,
        lossLimit: lLimit,
        martingaleEnabled
      };

      if (action === "START") {
        body.ssid = ssid || undefined;
        body.compoundEnabled = compoundEnabled;
        body.compoundTradesTarget = compoundEnabled ? cTarget : undefined;
        body.compoundPayoutRate = compoundEnabled ? cPayout : undefined;
      }

      const res = await fetch("/api/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        let errorMsg = data.error || "Erreur";
        if (data.ssidExpired || errorMsg.includes("timeout") || errorMsg.includes("SSID")) {
          errorMsg = "SSID invalide ou expire. Allez dans Profil pour copier un nouveau SSID PocketOption.";
        }
        setError(errorMsg);
      } else {
        if (action === "START") {
          const ssidSource = data.useGlobalSsid ? " (SSID Global Admin)" : "";
          setSuccess(`Bot demarre avec succes!${ssidSource}`);
        } else if (action === "RESET_COMPOUND") {
          setSuccess("Interet compose reinitialise!");
        } else if (action === "CLEAR_HISTORY") {
          setSuccess("Historique supprimé.");
          setSessions([]);
        } else {
          setSuccess("Bot arrete.");
        }
        if (data.runnerStatus) setRunnerStatus(data.runnerStatus);
        fetchSessions();
      }
    } catch {
      setError("Erreur de connexion");
    }
    setLoading(false);
  };

  const isRunning = !!activeSession?.isRunning;
  const isCompoundPaused = runnerStatus?.paused && runnerStatus?.compoundEnabled &&
    (runnerStatus.pauseReason?.includes("Compound") || runnerStatus.pauseReason?.includes("compound"));

  // Determine SSID source display
  const getSsidSource = () => {
    if (ssid) return "Saisi manuellement";
    if (user?.pocketOptionSsid) return "SSID Personnel (Profil)";
    if (ssidInfo?.globalSsidAvailable) return "SSID Global (Admin)";
    return "Aucun SSID";
  };

  const getEffectiveAmount = () => {
    if (!runnerStatus) return tradeAmount || 1;
    if (runnerStatus.compoundEnabled) return runnerStatus.compoundCurrentAmount;
    if (runnerStatus.martingaleEnabled && runnerStatus.martingaleLevel === 1) return runnerStatus.baseTradeAmount * 2;
    return runnerStatus.tradeAmount || 1;
  };

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

        {/* Bridge Connection Panel */}
        <div className="glass-card rounded-xl p-5 border border-slate-700/50">
          <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${user?.extensionActive ? 'bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]' : 'bg-red-500'}`} />
              <h2 className="text-lg font-bold text-white">Bridge BotOfficiel</h2>
              {Boolean(user?.extensionActive) && (
                <span className="text-[10px] font-black bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 uppercase">
                  Connected
                </span>
              )}
            </div>
            <div className="text-xs text-slate-400 text-right">
              <div>Navigateur: <span className="text-white">{user?.extensionDeviceName as string || 'Inconnu'}</span></div>
              {Boolean(user?.extensionLastSync) && (
                <div>Dernière synchro: <span className="text-white">{new Date(user?.extensionLastSync as string).toLocaleTimeString()}</span></div>
              )}
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white/5 rounded-xl p-3 border border-slate-700/30">
              <div className="text-xs text-slate-400 mb-1">Compte PO</div>
              <div className="font-bold text-white text-sm truncate">{user?.pocketOptionUsername as string || user?.pocketOptionUid as string || 'Non synchronisé'}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-slate-700/30">
              <div className="text-xs text-slate-400 mb-1">Mode Actuel</div>
              <div className={`font-bold text-sm ${user?.tradeMode === 'LIVE' ? 'text-green-400' : 'text-blue-400'}`}>
                {(user?.tradeMode as string) || 'DEMO'}
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-slate-700/30">
              <div className="text-xs text-slate-400 mb-1">Solde Live</div>
              <div className="font-bold text-green-400 text-sm">
                ${realBalance?.live ? realBalance.live.toLocaleString() : (user?.liveBalance ? Number(user?.liveBalance).toLocaleString() : '0.00')}
              </div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 border border-slate-700/30">
              <div className="text-xs text-slate-400 mb-1">Solde Demo</div>
              <div className="font-bold text-blue-400 text-sm">
                ${realBalance?.demo ? realBalance.demo.toLocaleString() : (user?.demoBalance ? Number(user?.demoBalance).toLocaleString() : '0.00')}
              </div>
            </div>
          </div>
          
          {(() => {
            // Bridge is active if extensionActive=true OR if lastSync was within last 5 minutes
            const lastSync = user?.extensionLastSync ? new Date(user.extensionLastSync as string).getTime() : 0;
            const recentSync = lastSync > 0 && (Date.now() - lastSync) < 5 * 60 * 1000;
            const bridgeOk = Boolean(user?.extensionActive) || recentSync;
            return !bridgeOk ? (
              <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 text-yellow-400 text-sm flex items-start gap-3">
                <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <div>
                  <div className="font-bold mb-1">Extension non connectée</div>
                  <p className="text-xs text-yellow-400/80">
                    Installez l&apos;extension Chrome Bridge et ouvrez un onglet PocketOption. La connexion et la synchronisation seront 100% automatiques. Plus besoin de saisir le SSID.
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-400 text-sm flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
                <span className="font-bold">Bridge Connecté</span>
                <span className="text-emerald-400/60 text-xs ml-auto">Dernier sync: {lastSync ? new Date(lastSync).toLocaleTimeString('fr-FR') : '—'}</span>
              </div>
            );
          })()}
        </div>

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
              <div className="font-bold text-white">Signal</div>
              <div className="text-xs text-slate-400 mt-1">
                Genere des signaux CALL/PUT. Vous tradez manuellement.
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
              <div className="font-bold text-white">Automatique</div>
              <div className="text-xs text-slate-400 mt-1">
                Trade automatiquement selon la strategie. Requiert SSID.
              </div>
            </button>
          </div>
        </div>

        {/* Configuration */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">CONFIGURATION</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Market Type Selector */}
            <div className="col-span-1 md:col-span-2 mb-2">
              <label className="block text-slate-400 text-xs mb-1.5">Type de Marché</label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setMarketType("REAL");
                    setAsset("EUR/USD");
                    if (!["1m", "3m", "5m"].includes(timeframe)) setTimeframe("1m");
                  }}
                  disabled={isRunning}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${
                    marketType === "REAL"
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  } disabled:opacity-50`}
                >
                  🟢 Marché Réel (Binance/Forex)
                </button>
                <button
                  onClick={() => {
                    setMarketType("OTC");
                    setAsset("EUR/USD (OTC)");
                  }}
                  disabled={isRunning}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all border-2 ${
                    marketType === "OTC"
                      ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
                      : "border-slate-700 text-slate-400 hover:border-slate-600"
                  } disabled:opacity-50`}
                >
                  🔥 Marché OTC (PocketOption)
                </button>
              </div>
            </div>

            {/* Asset */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Actif</label>
              <div className="relative group">
                <select
                  value={asset}
                  onChange={(e) => setAsset(e.target.value)}
                  disabled={isRunning}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50 appearance-none pr-10"
                >
                  {marketType === "REAL" ? (
                    <optgroup label="Marché Réel" className="bg-slate-900">
                      {REGULAR_ASSETS.map((a) => {
                        const poSymbol = a.replace("/", "").replace(" (OTC)", "_otc");
                        const payout = poAssets[poSymbol]?.payout;
                        return (
                          <option key={a} value={a} className="bg-slate-900">
                            {a} {payout ? `(${Math.round(payout * 100)}%)` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  ) : (
                    <optgroup label="Marché OTC" className="bg-slate-900">
                      {OTC_ASSETS.map((a) => {
                        const poSymbol = a.replace("/", "").replace(" (OTC)", "_otc");
                        const payout = poAssets[poSymbol]?.payout;
                        return (
                          <option key={a} value={a} className="bg-slate-900">
                            {a} {payout ? `(${Math.round(payout * 100)}%)` : ""}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-2">
                   {runnerStatus?.running && (
                     <span className="text-[10px] font-black text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20">
                       {Math.round((runnerStatus as any).compoundPayoutRate * 100 || 92)}%
                     </span>
                   )}
                   <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                   </svg>
                </div>
              </div>
            </div>

            {/* Timeframe */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Timeframe</label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              >
                {TIMEFRAMES.filter(tf => marketType === "OTC" || ["1m", "3m", "5m"].includes(tf.value)).map((tf) => (
                  <option key={tf.value} value={tf.value} className="bg-slate-900">{tf.label}</option>
                ))}
              </select>
            </div>

            {/* Trade Amount */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Montant par Trade ($)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={tradeAmount}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "") {
                    setTradeAmount("");
                  } else {
                    setTradeAmount(parseFloat(val));
                  }
                }}
                placeholder="Montant (ex: 1)"
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              />
              <p className="text-xs text-slate-500 mt-1">
                Montant investi par trade automatique (défaut: 1)
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
                    {m === "DEMO" ? "DEMO" : "LIVE"}
                  </button>
                ))}
              </div>
            </div>

            {/* Removed SSID Input */}

            {/* Profit Target */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Objectif Profit ($)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={profitTarget}
                onChange={(e) => setProfitTarget(e.target.value === "" ? "" : parseFloat(e.target.value))}
                placeholder="Par défaut: 50"
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              />
            </div>

            {/* Loss Limit */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Limite de Perte ($)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={lossLimit}
                onChange={(e) => setLossLimit(e.target.value === "" ? "" : parseFloat(e.target.value))}
                placeholder="Par défaut: 25"
                disabled={isRunning}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
              />
            </div>
          </div>

          {/* Martingale Toggle */}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Martingale (1 niveau)</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Apres une perte, le prochain trade sera double. Retour au montant de base apres.
                </div>
              </div>
              <button
                onClick={() => setMartingaleEnabled(!martingaleEnabled)}
                disabled={isRunning}
                className={`relative w-12 h-6 rounded-full transition-all disabled:opacity-50 ${
                  martingaleEnabled ? "bg-amber-500" : "bg-slate-700"
                }`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                  martingaleEnabled ? "left-6" : "left-0.5"
                }`} />
              </button>
            </div>
          </div>

          {/* Compound Interest Toggle */}
          <div className="mt-4 pt-4 border-t border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-medium text-white">Interet Compose</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Reinvestit le montant total + profit sur chaque trade successif. Arret immediat si perte.
                </div>
              </div>
              <button
                onClick={() => setCompoundEnabled(!compoundEnabled)}
                disabled={isRunning}
                className={`relative w-12 h-6 rounded-full transition-all disabled:opacity-50 ${
                  compoundEnabled ? "bg-violet-500" : "bg-slate-700"
                }`}
              >
                <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${
                  compoundEnabled ? "left-6" : "left-0.5"
                }`} />
              </button>
            </div>
            {compoundEnabled && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Nombre de trades</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={compoundTradesTarget}
                    onChange={(e) => setCompoundTradesTarget(e.target.value === "" ? "" : parseInt(e.target.value))}
                    placeholder="Par défaut: 3"
                    disabled={isRunning}
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Taux de paiement (%)</label>
                  <input
                    type="number"
                    min="50"
                    max="100"
                    value={compoundPayoutRate}
                    onChange={(e) => setCompoundPayoutRate(e.target.value === "" ? "" : parseInt(e.target.value))}
                    placeholder="Par défaut: 92"
                    disabled={isRunning}
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm disabled:opacity-50"
                  />
                </div>
                <div className="col-span-2 bg-white/5 rounded-lg p-2.5 text-xs text-slate-400">
                  Ex: ${tradeAmount || 1} x {compoundPayoutRate || 92}% = ${(((tradeAmount || 1) * (Number(compoundPayoutRate || 92)) / 100) + (tradeAmount || 1)).toFixed(2)} puis ...
                </div>
              </div>
            )}
          </div>

          {mode === "LIVE" && (
            <div className="mt-4 bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-400 text-sm">
              Mode LIVE: Les trades seront executes avec votre capital reel PocketOption.
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
                    isRunning && !runnerStatus?.paused ? "bg-emerald-400 animate-pulse" : runnerStatus?.paused ? "bg-yellow-400" : "bg-slate-500"
                  }`}
                />
                <span className="font-bold text-white text-lg">
                  {runnerStatus?.paused ? "En pause" : isRunning ? "En cours d'execution" : "Arrete"}
                </span>
                {isRunning && activeSession && (
                  <span className="text-xs text-slate-400">
                    {activeSession.botType === "signal" ? "Signal" : "Auto"} · {activeSession.asset} · {activeSession.timeframe}
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              {isCompoundPaused && (
                <button
                  onClick={() => handleBotAction("RESET_COMPOUND")}
                  disabled={loading}
                  className="px-6 py-3 rounded-xl font-bold text-sm bg-violet-500/20 hover:bg-violet-500/30 border border-violet-500/50 text-violet-400 transition-all disabled:opacity-50"
                >
                  Recommencer
                </button>
              )}
              <button
                onClick={() => handleBotAction(isRunning ? "STOP" : "START")}
                disabled={loading}
                className={`px-8 py-3 rounded-xl font-bold text-sm transition-all disabled:opacity-50 ${
                  isRunning
                    ? "bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400"
                    : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white shadow-lg shadow-cyan-500/20"
                }`}
              >
                {loading ? "..." : isRunning ? "Arreter" : "Demarrer"}
              </button>
            </div>
          </div>

          {isRunning && (
            <div className="grid grid-cols-2 md:grid-cols-8 gap-4">
              {[
                { label: "Signaux", value: runnerStatus?.signalsGenerated ?? 0, color: "text-cyan-400" },
                { label: "Trades", value: runnerStatus?.tradesExecuted ?? 0, color: "text-white" },
                { label: "Montant", value: `$${getEffectiveAmount().toFixed(2)}`, color: "text-violet-400" },
                { label: "Victoires", value: runnerStatus?.dailyWins ?? 0, color: "text-emerald-400" },
                { label: "Defaites", value: runnerStatus?.dailyLosses ?? 0, color: "text-red-400" },
                {
                  label: "Profit/Jour",
                  value: `$${(runnerStatus?.dailyProfit ?? 0).toFixed(2)}`,
                  color: (runnerStatus?.dailyProfit ?? 0) >= 0 ? "text-emerald-400" : "text-red-400",
                },
                { label: "Objectif", value: `$${runnerStatus?.profitTarget ?? 50}`, color: "text-amber-400" },
                { label: "Limite Perte", value: `$${runnerStatus?.lossLimit ?? 25}`, color: "text-orange-400" },
              ].map((stat) => (
                <div key={stat.label} className="bg-white/5 rounded-xl p-3 text-center">
                  <div className={`text-xl font-black ${stat.color}`}>{stat.value}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Martingale/Compound Status */}
          {isRunning && runnerStatus && (runnerStatus.martingaleEnabled || runnerStatus.compoundEnabled) && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {runnerStatus.martingaleEnabled && (
                <div className={`rounded-xl p-3 border ${
                  runnerStatus.martingaleLevel === 1
                    ? "bg-amber-500/10 border-amber-500/30"
                    : "bg-white/5 border-slate-700"
                }`}>
                  <div className="text-xs text-slate-400">Martingale</div>
                  <div className={`font-bold ${runnerStatus.martingaleLevel === 1 ? "text-amber-400" : "text-white"}`}>
                    {runnerStatus.martingaleLevel === 1 ? `2x en cours ($${(runnerStatus.baseTradeAmount * 2).toFixed(2)})` : "Base (en attente)"}
                  </div>
                </div>
              )}
              {runnerStatus.compoundEnabled && (
                <div className={`rounded-xl p-3 border ${
                  isCompoundPaused
                    ? "bg-red-500/10 border-red-500/30"
                    : "bg-violet-500/10 border-violet-500/30"
                }`}>
                  <div className="text-xs text-slate-400">Interet Compose</div>
                  <div className={`font-bold ${isCompoundPaused ? "text-red-400" : "text-violet-400"}`}>
                    Trade {runnerStatus.compoundTradesTaken}/{runnerStatus.compoundTradesTarget} · ${runnerStatus.compoundCurrentAmount.toFixed(2)}
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2 w-full bg-slate-700 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${isCompoundPaused ? "bg-red-400" : "bg-violet-400"}`}
                      style={{ width: `${Math.min(100, (runnerStatus.compoundTradesTaken / runnerStatus.compoundTradesTarget) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isRunning && runnerStatus?.paused && (
            <div className={`mt-4 rounded-xl p-3 text-center border ${
              isCompoundPaused && runnerStatus.pauseReason?.includes("Objectif")
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : isCompoundPaused
                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                  : "bg-yellow-500/10 border-yellow-500/30 text-yellow-400"
            }`}>
              <div className="text-sm font-medium">
                {runnerStatus.pauseReason || `${runnerStatus.consecutiveErrors} erreurs consecutives`}
              </div>
            </div>
          )}

          {isRunning && !runnerStatus?.paused && (
            <div className="mt-4 bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 text-center">
              <div className="text-cyan-400 text-sm font-medium">
                {runnerStatus?.signalsGenerated ?? 0} signaux generes · {runnerStatus?.tradesExecuted ?? 0} trades executes · Analyse en temps reel...
              </div>
            </div>
          )}
        </div>

        {/* Session History */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 flex justify-between items-center">
            <div className="font-semibold text-white">Historique des Sessions</div>
            <button
              onClick={() => handleBotAction("CLEAR_HISTORY")}
              disabled={loading || sessions.length === 0}
              className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-400 px-3 py-1.5 rounded-lg border border-red-500/30 transition-all disabled:opacity-50"
            >
              Vider l'historique
            </button>
          </div>
          {sessions.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
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
                    <th className="text-left text-xs text-slate-400 px-4 py-3">Demarre</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} className="border-b border-slate-800/50 hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm">
                            {session.botType === "auto" ? "Auto" : "Signal"}
                          </span>
                          {session.useGlobalSsid && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-400">Global</span>
                          )}
                        </div>
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
                            {session.isRunning ? "Actif" : "Arrete"}
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
