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
    // Fetch user profile and stats
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
  }, []);

  const subscriptionStatus = user?.subscriptionStatus as string;
  const demoBalance = user?.demoBalance as string;
  const tradeMode = user?.tradeMode as string;

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
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Dashboard <span className="gradient-text">Trading</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Vue d'ensemble de vos performances de trading
          </p>
        </div>

        {(subscriptionStatus === "EXPIRED" || subscriptionStatus === "FREE") && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-yellow-400">
                ⚠️ {status.desc}
              </div>
              <div className="text-sm text-slate-400 mt-0.5">
                Abonnez-vous pour accéder à toutes les fonctionnalités
              </div>
            </div>
            <a
              href="/dashboard/payment"
              className="bg-yellow-500 hover:bg-yellow-400 text-black font-bold px-4 py-2 rounded-lg text-sm transition-colors"
            >
              S'abonner
            </a>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Trades", value: loading ? "..." : stats?.totalTrades || 0, icon: "📊", color: "text-white" },
            { label: "Taux de Réussite", value: loading ? "..." : `${stats?.winRate || 0}%`, icon: "🎯", color: stats && stats.winRate >= 50 ? "text-emerald-400" : "text-red-400" },
            { label: "Profit Net", value: loading ? "..." : `$${stats?.totalProfit || 0}`, icon: "💰", color: stats && stats.totalProfit >= 0 ? "text-emerald-400" : "text-red-400" },
            { label: "Profit Factor", value: loading ? "..." : stats?.profitFactor || 0, icon: "⚡", color: stats && stats.profitFactor >= 1 ? "text-cyan-400" : "text-red-400" },
          ].map((card) => (
            <div key={card.label} className="glass-card rounded-xl p-5">
              <div className="text-2xl mb-2">{card.icon}</div>
              <div className={`text-2xl font-black ${card.color}`}>{card.value}</div>
              <div className="text-slate-400 text-xs mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-3">MODE TRADING</div>
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${tradeMode === "LIVE" ? "bg-green-500/10" : "bg-blue-500/10"}`}>
                {tradeMode === "LIVE" ? "🔴" : "🔵"}
              </div>
              <div>
                <div className="font-bold text-white text-lg">{tradeMode || "DEMO"}</div>
                <div className="text-xs text-slate-400">{tradeMode === "LIVE" ? "Trading avec capital réel" : "Simulation sans risque"}</div>
              </div>
            </div>
            {tradeMode === "DEMO" && demoBalance && (
              <div className="mt-4 bg-blue-500/10 rounded-lg p-3">
                <div className="text-xs text-slate-400">Solde démo</div>
                <div className="text-xl font-black text-blue-400 font-mono">${parseFloat(demoBalance).toFixed(2)}</div>
              </div>
            )}
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-3">ABONNEMENT</div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center text-2xl">💳</div>
              <div>
                <div className={`font-bold text-lg ${status.color}`}>{status.label}</div>
                <div className="text-xs text-slate-400">{status.desc}</div>
              </div>
            </div>
            <a href="/dashboard/payment" className="mt-4 block text-center bg-gradient-to-r from-cyan-500/20 to-violet-600/20 hover:from-cyan-500/30 hover:to-violet-600/30 border border-cyan-500/20 text-cyan-400 text-xs font-medium py-2 rounded-lg transition-all">
              Gérer l'abonnement
            </a>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-3">RÉSULTATS</div>
            <div className="flex gap-4">
              <div className="flex-1 text-center">
                <div className="text-2xl font-black text-emerald-400">{stats?.wins || 0}</div>
                <div className="text-xs text-slate-400 mt-1">Victoires</div>
              </div>
              <div className="w-px bg-slate-700" />
              <div className="flex-1 text-center">
                <div className="text-2xl font-black text-red-400">{stats?.losses || 0}</div>
                <div className="text-xs text-slate-400 mt-1">Défaites</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>Winrate</span>
                <span>{stats?.winRate || 0}%</span>
              </div>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 rounded-full transition-all" style={{ width: `${stats?.winRate || 0}%` }} />
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="font-semibold text-white mb-4">📈 Courbe d'Équité</div>
          {equityCurve.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-slate-500 text-sm">
              Aucun trade pour le moment. Commencez à trader pour voir votre performance.
            </div>
          ) : (
            <div className="h-48 flex items-end gap-1">
              {equityCurve.slice(-50).map((point, i) => {
                const maxEq = Math.max(...equityCurve.map((p) => p.equity));
                const minEq = Math.min(...equityCurve.map((p) => p.equity));
                const range = maxEq - minEq || 1;
                const height = ((point.equity - minEq) / range) * 100;
                return (
                  <div key={i} className="flex-1 min-w-[2px] rounded-t transition-all"
                    style={{ height: `${Math.max(2, height)}%`, backgroundColor: point.result === "WIN" ? "#10b981" : "#ef4444" }}
                    title={`$${point.equity}`}
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { href: "/dashboard/signals", icon: "📡", label: "Voir les Signaux", color: "from-cyan-500/20 to-blue-600/20 border-cyan-500/20 text-cyan-400" },
            { href: "/dashboard/bot", icon: "🤖", label: "Démarrer le Bot", color: "from-violet-500/20 to-purple-600/20 border-violet-500/20 text-violet-400" },
            { href: "/dashboard/backtest", icon: "🔬", label: "Backtesting", color: "from-emerald-500/20 to-teal-600/20 border-emerald-500/20 text-emerald-400" },
            { href: "/dashboard/trades", icon: "📋", label: "Historique", color: "from-orange-500/20 to-red-600/20 border-orange-500/20 text-orange-400" },
          ].map((action) => (
            <a key={action.href} href={action.href} className={`glass-card rounded-xl p-5 text-center bg-gradient-to-br border hover:scale-105 transition-all duration-200 ${action.color}`}>
              <div className="text-3xl mb-2">{action.icon}</div>
              <div className="text-sm font-semibold">{action.label}</div>
            </a>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
