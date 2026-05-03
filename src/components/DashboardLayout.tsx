"use client";

import { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  subscriptionStatus: string;
  tradeMode: string;
  demoBalance?: string;
  backtestingDaysGranted?: number;
  ssidStatus?: string;
}

interface Props {
  children: React.ReactNode;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/dashboard/signals", label: "Signaux", icon: "📡" },
  { href: "/dashboard/bot", label: "Bot Auto", icon: "🤖" },
  { href: "/dashboard/trades", label: "Historique", icon: "📋" },
  { href: "/dashboard/backtest", label: "Backtesting", icon: "🔬" },
  { href: "/dashboard/payment", label: "Abonnement", icon: "💳" },
  { href: "/dashboard/profile", label: "Profil", icon: "👤" },
];

const statusColors: Record<string, string> = {
  FREE: "bg-slate-500/20 text-slate-400",
  TRIAL: "bg-blue-500/20 text-blue-400",
  ACTIVE: "bg-emerald-500/20 text-emerald-400",
  EXPIRED: "bg-red-500/20 text-red-400",
  PENDING_PAYMENT: "bg-yellow-500/20 text-yellow-400",
};

export default function DashboardLayout({ children }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    // Fetch user from cookie-based endpoint
    fetch("/api/auth/me")
      .then((r) => {
        if (r.status === 401) {
          router.push("/");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
        }
      })
      .catch(() => {
        router.push("/");
      });
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] flex relative">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-72 bg-[#050b1a]/95 backdrop-blur-2xl border-r border-white/5 flex flex-col transform transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-20 flex items-center px-8 border-b border-white/5">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center font-black text-lg mr-3 shadow-lg shadow-cyan-500/20">
            G
          </div>
          <span className="font-black text-xl tracking-tighter text-white">Golite<span className="gradient-text">Elite</span></span>
        </div>

        <div className="p-6 border-b border-white/5">
          <div className="glass-morphism rounded-2xl p-4 border-white/5">
            <div className="font-bold text-white text-base truncate">{user.username}</div>
            <div className="text-xs text-slate-500 truncate font-medium">{user.email}</div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span
                className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                  statusColors[user.subscriptionStatus] || "bg-slate-500/20 text-slate-400"
                }`}
              >
                {user.subscriptionStatus}
              </span>
              <span
                className={`text-[10px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider ${
                  user.tradeMode === "LIVE"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {user.tradeMode}
              </span>
            </div>
            {user.tradeMode === "DEMO" && user.demoBalance && (
              <div className="text-xs text-cyan-400 mt-2 font-black">
                SOLDE: ${parseFloat(user.demoBalance).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold transition-all duration-300 ${
                  isActive
                    ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-lg shadow-cyan-500/20"
                    : "text-slate-500 hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="text-lg">{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="p-6 border-t border-white/5 space-y-3">
          {user.role === "ADMIN" && (
            <a
              href="/admin"
              className="flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-violet-400 hover:bg-violet-500/10 transition-all border border-violet-500/20"
            >
              <span>👨‍💼</span>
              Panel Admin
            </a>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-red-400 hover:bg-red-500/10 transition-all border border-red-500/20"
          >
            <span>🚪</span>
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-20 bg-[#020617]/50 backdrop-blur-xl border-b border-white/5 flex items-center px-6 lg:px-10 gap-4 sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-400 hover:text-white p-2 bg-white/5 rounded-xl transition-all"
          >
            ☰
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-6">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Compte Actuel</span>
              <div className="text-sm font-black text-white flex items-center gap-2">
                <span className={user.tradeMode === "LIVE" ? "text-green-400" : "text-blue-400"}>{user.tradeMode}</span>
                {user.tradeMode === "DEMO" && (
                  <span className="text-slate-300 border-l border-white/10 pl-2">
                    ${parseFloat(user.demoBalance || "0").toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl shadow-inner">
              👤
            </div>
          </div>
        </header>

        {/* SSID Expired Alert */}
        {user.ssidStatus === "EXPIRED" && (
          <div className="bg-red-500/10 border-b border-red-500/30 px-4 lg:px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-red-400 text-lg">&#9888;</span>
              <span className="text-red-400 text-sm font-medium">
                Votre SSID PocketOption a expiré. Le bot a été mis en pause.
              </span>
            </div>
            <a
              href="/dashboard/profile"
              className="bg-red-500/20 hover:bg-red-500/30 text-red-400 text-xs font-bold px-4 py-1.5 rounded-lg transition-colors"
            >
              Mettre à jour le SSID
            </a>
          </div>
        )}

        {/* SSID Unknown Warning */}
        {user.ssidStatus === "UNKNOWN" && (
          <div className="bg-yellow-500/10 border-b border-yellow-500/30 px-4 lg:px-6 py-3 flex items-center gap-3">
            <span className="text-yellow-400 text-lg">&#9888;</span>
            <span className="text-yellow-400 text-sm">
              Statut SSID non vérifié. Lancez le bot pour valider votre connexion.
            </span>
          </div>
        )}

        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
