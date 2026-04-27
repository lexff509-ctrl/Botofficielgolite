"use client";

import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout";

interface Stats {
  totalUsers: number;
  activeUsers: number;
  trialUsers: number;
  expiredUsers: number;
  freeUsers: number;
  pendingPaymentUsers: number;
  pendingPayments: number;
  approvedRevenue: number;
  totalTrades: number;
  winRate: number;
}

export default function AdminStatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((data) => {
        if (data.stats) setStats(data.stats);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AdminLayout>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full" />
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            <span className="gradient-text">Statistiques</span> Plateforme
          </h1>
          <p className="text-slate-400 text-sm mt-1">Metriques detaillees de la plateforme</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Total Utilisateurs", value: stats?.totalUsers || 0, icon: "👥", color: "text-white" },
            { label: "Abonnes Actifs", value: stats?.activeUsers || 0, icon: "✅", color: "text-emerald-400" },
            { label: "En Essai", value: stats?.trialUsers || 0, icon: "⏳", color: "text-blue-400" },
            { label: "Revenus USDT", value: `$${stats?.approvedRevenue || 0}`, icon: "💰", color: "text-cyan-400" },
          ].map((card) => (
            <div key={card.label} className="glass-card rounded-xl p-5">
              <div className="text-2xl mb-2">{card.icon}</div>
              <div className={`text-2xl font-black ${card.color}`}>{card.value}</div>
              <div className="text-slate-400 text-xs mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-5">
            <div className="font-semibold text-white mb-4">Repartition Utilisateurs</div>
            <div className="space-y-4">
              {[
                { label: "Actifs", count: stats?.activeUsers || 0, color: "bg-emerald-500", text: "text-emerald-400" },
                { label: "En Essai", count: stats?.trialUsers || 0, color: "bg-blue-500", text: "text-blue-400" },
                { label: "Expires", count: stats?.expiredUsers || 0, color: "bg-red-500", text: "text-red-400" },
                { label: "Gratuits", count: stats?.freeUsers || 0, color: "bg-slate-500", text: "text-slate-400" },
                { label: "En attente paiement", count: stats?.pendingPaymentUsers || 0, color: "bg-yellow-500", text: "text-yellow-400" },
              ].map((item) => {
                const total = stats?.totalUsers || 1;
                const pct = (item.count / total) * 100;
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className={item.text}>{item.label}</span>
                      <span className="text-white font-bold">{item.count} ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="font-semibold text-white mb-4">Metriques Trading</div>
            <div className="space-y-4">
              <div className="flex justify-between items-center bg-white/5 rounded-xl p-4">
                <span className="text-slate-400">Total Trades</span>
                <span className="text-xl font-black text-white">{stats?.totalTrades || 0}</span>
              </div>
              <div className="flex justify-between items-center bg-white/5 rounded-xl p-4">
                <span className="text-slate-400">Taux de Reussite Global</span>
                <span className="text-xl font-black text-cyan-400">{stats?.winRate || 0}%</span>
              </div>
              <div className="flex justify-between items-center bg-white/5 rounded-xl p-4">
                <span className="text-slate-400">Paiements en Attente</span>
                <span className="text-xl font-black text-yellow-400">{stats?.pendingPayments || 0}</span>
              </div>
              <div className="flex justify-between items-center bg-white/5 rounded-xl p-4">
                <span className="text-slate-400">Revenus Approuves</span>
                <span className="text-xl font-black text-emerald-400">${stats?.approvedRevenue || 0} USDT</span>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="font-semibold text-white mb-4">Resume Global</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "Utilisateurs", value: stats?.totalUsers || 0, color: "text-white" },
              { label: "Actifs", value: stats?.activeUsers || 0, color: "text-emerald-400" },
              { label: "Trades", value: stats?.totalTrades || 0, color: "text-cyan-400" },
              { label: "Win Rate", value: `${stats?.winRate || 0}%`, color: "text-violet-400" },
              { label: "Revenus", value: `$${stats?.approvedRevenue || 0}`, color: "text-emerald-400" },
            ].map((item) => (
              <div key={item.label} className="bg-white/5 rounded-xl p-4 text-center">
                <div className={`text-2xl font-black ${item.color}`}>{item.value}</div>
                <div className="text-xs text-slate-400 mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
