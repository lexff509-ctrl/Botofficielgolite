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

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      Promise.all([
        fetch("/api/auth/me").then((r) => r.json()),
        fetch("/api/trades/stats").then((r) => r.json()),
      ]).then(([userData, statsData]) => {
        if (userData.user) setUser(userData.user);
        if (statsData.stats) {
          setStats(statsData.stats);
          setEquityCurve(statsData.equityCurve || []);
        }
        setLoading(false);
      }).catch(() => setLoading(false));
    };

    load(); // Initial load
    // Poll every 30s to keep balances in sync with Bridge data
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, []);

  const subscriptionStatus = user?.subscriptionStatus as string;
  const demoBalance = user?.demoBalance as string | null;
  const liveBalance = user?.liveBalance as string | null;
  const tradeMode   = user?.tradeMode as string;
  const currentBalance = tradeMode === "LIVE" ? liveBalance : demoBalance;

  const statusInfo: Record<string, { label: string; color: string; desc: string }> = {
    FREE: { label: "Gratuit", color: "text-slate-400", desc: "Accès limité" },
    TRIAL: { label: "Essai 3j", color: "text-blue-400", desc: "Essai en cours" },
    ACTIVE: { label: "Actif", color: "text-emerald-400", desc: "Accès complet" },
    EXPIRED: { label: "Expiré", color: "text-red-400", desc: "Renouvelez votre abonnement" },
    PENDING_PAYMENT: { label: "En attente", color: "text-yellow-400", desc: "Paiement en cours de vérification" },
  };

  const status = statusInfo[subscriptionStatus] || statusInfo.FREE;

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-white tracking-tighter">
              Trading <span className="gradient-text">Elite Dashboard</span>
            </h1>
            <p className="text-slate-500 text-sm mt-1 font-medium uppercase tracking-wider">
              Performance Intelligence • Précision Algorithmique
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-2 flex items-center gap-2">
              <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-slate-300 uppercase tracking-widest">Marché Ouvert</span>
            </div>
          </div>
        </div>

        {(subscriptionStatus === "EXPIRED" || subscriptionStatus === "FREE") && (
          <div className="glass-morphism rounded-2xl p-5 border-yellow-500/20 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-yellow-500/10 flex items-center justify-center text-2xl">⚠️</div>
              <div>
                <div className="font-bold text-yellow-400">
                  {status.desc}
                </div>
                <div className="text-sm text-slate-400 mt-0.5">
                  Débloquez la stratégie Elite 89%-200% et le trading automatique illimité.
                </div>
              </div>
            </div>
            <a
              href="/dashboard/payment"
              className="w-full md:w-auto bg-gradient-to-r from-yellow-500 to-amber-600 hover:from-yellow-400 hover:to-amber-500 text-black font-black px-8 py-3 rounded-xl text-sm transition-all duration-300 shadow-lg shadow-yellow-500/20"
            >
              PASSER À L'ÉLITE
            </a>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: "Total Trades", value: loading ? "..." : stats?.totalTrades || 0, icon: "📊", color: "text-white", bg: "from-blue-500/10 to-transparent" },
            { label: "Win Rate Elite", value: loading ? "..." : `${stats?.winRate || 0}%`, icon: "🎯", color: stats && stats.winRate >= 50 ? "text-emerald-400" : "text-red-400", bg: "from-emerald-500/10 to-transparent" },
            { label: "Profit Net", value: loading ? "..." : `$${Number(stats?.totalProfit || 0).toLocaleString()}`, icon: "💰", color: stats && Number(stats.totalProfit || 0) >= 0 ? "text-emerald-400" : "text-red-400", bg: "from-violet-500/10 to-transparent" },
            { label: "Profit Factor", value: loading ? "..." : stats?.profitFactor || 0, icon: "⚡", color: stats && stats.profitFactor >= 1 ? "text-cyan-400" : "text-red-400", bg: "from-cyan-500/10 to-transparent" },
          ].map((card) => (
            <div key={card.label} className={`glass-card rounded-2xl p-6 border-white/5 bg-gradient-to-br ${card.bg} relative overflow-hidden group hover:-translate-y-1 transition-all duration-500`}>
              <div className="text-3xl mb-4 group-hover:scale-110 transition-transform duration-500">{card.icon}</div>
              <div className={`text-3xl font-black tracking-tighter ${card.color}`}>{card.value}</div>
              <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mt-2">{card.label}</div>
              <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <div className="text-4xl font-black">{card.icon}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="glass-card rounded-2xl p-6 border-white/5 hover:border-white/10 transition-all duration-500">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-4">MODE TRADING</div>
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl shadow-inner ${tradeMode === "LIVE" ? "bg-green-500/10 text-green-400" : "bg-blue-500/10 text-blue-400"}`}>
                {tradeMode === "LIVE" ? "⚡" : "🧪"}
              </div>
              <div>
                <div className="font-black text-white text-xl tracking-tight">{tradeMode || "DEMO"}</div>
                <div className="text-xs text-slate-500 font-medium">{tradeMode === "LIVE" ? "Exécution réelle sur le marché" : "Environnement de test sécurisé"}</div>
              </div>
            </div>
            {currentBalance && (
              <div className="mt-6 glass-morphism rounded-2xl p-4 border-blue-500/10 relative overflow-hidden">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  {tradeMode === "LIVE" ? "Solde Réel" : "Solde Virtuel"}
                </div>
                <div className={`text-2xl font-black tracking-tighter mt-1 ${tradeMode === "LIVE" ? "text-emerald-400" : "text-blue-400"}`}>
                  ${parseFloat(currentBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                {/* Show the other balance as secondary */}
                {tradeMode === "LIVE" && demoBalance && (
                  <div className="text-[10px] text-slate-500 mt-1">Demo: ${parseFloat(demoBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                )}
                {tradeMode !== "LIVE" && liveBalance && parseFloat(liveBalance) > 0 && (
                  <div className="text-[10px] text-slate-500 mt-1">Live: ${parseFloat(liveBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                )}
                <div className="absolute top-1/2 -right-4 -translate-y-1/2 text-4xl opacity-5 font-black tracking-tighter">CASH</div>
              </div>
            )}
          </div>

          <div className="glass-card rounded-2xl p-6 border-white/5 hover:border-white/10 transition-all duration-500">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-4">ABONNEMENT ÉLITE</div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center text-2xl shadow-inner">💎</div>
              <div>
                <div className={`font-black text-xl tracking-tight ${status.color}`}>{status.label}</div>
                <div className="text-xs text-slate-500 font-medium">{status.desc}</div>
              </div>
            </div>
            <a href="/dashboard/payment" className="mt-6 block text-center bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-black uppercase tracking-widest py-3 rounded-xl transition-all duration-300">
              Gérer l'abonnement
            </a>
          </div>

          <div className="glass-card rounded-2xl p-6 border-white/5 hover:border-white/10 transition-all duration-500">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest mb-4">MÉTRIQUES DE VICTOIRE</div>
            <div className="flex gap-6">
              <div className="flex-1">
                <div className="text-3xl font-black text-emerald-400 tracking-tighter">{stats?.wins || 0}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Wins</div>
              </div>
              <div className="w-px bg-white/5" />
              <div className="flex-1">
                <div className="text-3xl font-black text-red-400 tracking-tighter">{stats?.losses || 0}</div>
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Losses</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="flex justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">
                <span>Winrate Actuel</span>
                <span className="text-white">{stats?.winRate || 0}%</span>
              </div>
              <div className="h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/5">
                <div className="h-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-600 rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(16,185,129,0.5)]" style={{ width: `${stats?.winRate || 0}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6 border-white/5 relative overflow-hidden group">
          <div className="flex items-center justify-between mb-6">
            <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">COURBE D'ÉQUITÉ ANALYTIQUE</div>
            <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest bg-cyan-500/10 px-3 py-1 rounded-full">Temps Réel</div>
          </div>
          {equityCurve.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-600">
              <div className="text-4xl mb-2 opacity-20">📈</div>
              <div className="text-xs font-bold uppercase tracking-widest">En attente de données...</div>
            </div>
          ) : (
            <div className="h-64 flex items-end gap-1 px-2">
              {equityCurve.slice(-60).map((point, i) => {
                const equities = equityCurve.map((p) => p.equity);
                const maxEq = Math.max(...equities);
                const minEq = Math.min(...equities);
                const range = maxEq - minEq || 1;
                const height = ((point.equity - minEq) / range) * 100;
                return (
                  <div key={i} className="flex-1 min-w-[3px] rounded-t-sm transition-all duration-500 hover:scale-y-110 relative group/bar"
                    style={{ height: `${Math.max(5, height)}%`, backgroundColor: point.result === "WIN" ? "rgba(16, 185, 129, 0.6)" : "rgba(239, 68, 68, 0.6)" }}
                  >
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-white text-black text-[10px] font-black rounded opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
                      ${point.equity.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {/* Decorative grid */}
          <div className="absolute inset-0 pointer-events-none opacity-[0.02]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { href: "/dashboard/signals", icon: "📡", label: "Signaux Élite", desc: "89-200% Confidence", color: "from-cyan-500/10 to-transparent border-cyan-500/20 text-cyan-400" },
            { href: "/dashboard/bot", icon: "🤖", label: "Auto-Trader", desc: "Système Automatisé", color: "from-violet-500/10 to-transparent border-violet-500/20 text-violet-400" },
            { href: "/dashboard/backtest", icon: "🔬", label: "Backtesting", desc: "Simulation Historique", color: "from-emerald-500/10 to-transparent border-emerald-500/20 text-emerald-400" },
            { href: "/dashboard/trades", icon: "📋", label: "Historique", desc: "Logs de Trading", color: "from-orange-500/10 to-transparent border-orange-500/20 text-orange-400" },
          ].map((action) => (
            <a key={action.href} href={action.href} className={`glass-card rounded-2xl p-6 text-center bg-gradient-to-br border hover:shadow-2xl transition-all duration-500 transform hover:-translate-y-2 group ${action.color}`}>
              <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-500">{action.icon}</div>
              <div className="text-sm font-black uppercase tracking-tight text-white">{action.label}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mt-1">{action.desc}</div>
            </a>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
