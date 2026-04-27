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

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  subscriptionStatus: string;
  isActive: boolean;
  tradeMode: string;
  demoBalance: string | null;
  createdAt: string;
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/stats").then((r) => r.json()),
      fetch("/api/admin/payments").then((r) => r.json()),
    ])
      .then(([statsData, paymentsData]) => {
        if (statsData.stats) setStats(statsData.stats);
        if (paymentsData.payments) {
          // Get unique users from payments
          const uniqueUsers = Array.from(
            new Map(
              paymentsData.payments.map((p: Record<string, unknown>) => [
                p.userId,
                { id: p.userId, email: p.userEmail, username: p.username },
              ])
            ).values()
          );
          setUsers(uniqueUsers as User[]);
        }
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
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Admin <span className="gradient-text">Dashboard</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Vue d&apos;ensemble de la plateforme
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Utilisateurs", value: stats?.totalUsers || 0, icon: "👥", color: "text-white" },
            { label: "Abonnés Actifs", value: stats?.activeUsers || 0, icon: "✅", color: "text-emerald-400" },
            { label: "En Essai", value: stats?.trialUsers || 0, icon: "⏳", color: "text-blue-400" },
            { label: "Revenus Approuvés", value: `$${stats?.approvedRevenue || 0}`, icon: "💰", color: "text-cyan-400" },
          ].map((card) => (
            <div key={card.label} className="glass-card rounded-xl p-5">
              <div className="text-2xl mb-2">{card.icon}</div>
              <div className={`text-2xl font-black ${card.color}`}>{card.value}</div>
              <div className="text-slate-400 text-xs mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "Paiements en Attente", value: stats?.pendingPayments || 0, color: "text-yellow-400" },
            { label: "Utilisateurs Expirés", value: stats?.expiredUsers || 0, color: "text-red-400" },
            { label: "Comptes Gratuits", value: stats?.freeUsers || 0, color: "text-slate-400" },
            { label: "Taux de Réussite Global", value: `${stats?.winRate || 0}%`, color: "text-cyan-400" },
          ].map((card) => (
            <div key={card.label} className="glass-card rounded-xl p-4">
              <div className={`text-xl font-black ${card.color}`}>{card.value}</div>
              <div className="text-slate-400 text-xs mt-1">{card.label}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card rounded-xl p-5">
            <div className="font-semibold text-white mb-4">Répartition des Abonnements</div>
            <div className="space-y-3">
              {[
                { label: "Actif", count: stats?.activeUsers || 0, color: "bg-emerald-500", textColor: "text-emerald-400" },
                { label: "Essai", count: stats?.trialUsers || 0, color: "bg-blue-500", textColor: "text-blue-400" },
                { label: "Expiré", count: stats?.expiredUsers || 0, color: "bg-red-500", textColor: "text-red-400" },
                { label: "Gratuit", count: stats?.freeUsers || 0, color: "bg-slate-500", textColor: "text-slate-400" },
                { label: "En attente", count: stats?.pendingPaymentUsers || 0, color: "bg-yellow-500", textColor: "text-yellow-400" },
              ].map((item) => {
                const total = stats?.totalUsers || 1;
                const pct = (item.count / total) * 100;
                return (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className={item.textColor}>{item.label}</span>
                      <span className="text-white font-bold">{item.count}</span>
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
            <div className="font-semibold text-white mb-4">Actions Rapides</div>
            <div className="space-y-3">
              <a
                href="/admin/payments"
                className="block bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 hover:bg-yellow-500/20 transition-colors"
              >
                <div className="font-bold text-yellow-400">
                  Paiements en attente ({stats?.pendingPayments || 0})
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Vérifier et approuver les demandes de paiement
                </div>
              </a>
              <a
                href="/admin/users"
                className="block bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 hover:bg-cyan-500/20 transition-colors"
              >
                <div className="font-bold text-cyan-400">
                  Gestion des Utilisateurs ({stats?.totalUsers || 0})
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Modifier les abonnements, activer/désactiver des comptes
                </div>
              </a>
              <a
                href="/admin/stats"
                className="block bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 hover:bg-violet-500/20 transition-colors"
              >
                <div className="font-bold text-violet-400">
                  Statistiques Détaillées
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Voir les métriques avancées de la plateforme
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
