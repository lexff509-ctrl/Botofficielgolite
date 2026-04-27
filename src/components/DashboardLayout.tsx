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
    <div className="min-h-screen bg-[#020617] flex">
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-30 w-64 bg-[#0a0f1e] border-r border-[#1e293b] flex flex-col transform transition-transform duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center px-6 border-b border-[#1e293b]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center font-bold text-sm mr-3">
            G
          </div>
          <span className="font-black text-white">GoliteCommunity</span>
        </div>

        <div className="p-4 border-b border-[#1e293b]">
          <div className="glass-card rounded-xl p-3">
            <div className="font-semibold text-white text-sm truncate">{user.username}</div>
            <div className="text-xs text-slate-400 truncate">{user.email}</div>
            <div className="flex items-center gap-2 mt-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  statusColors[user.subscriptionStatus] || "bg-slate-500/20 text-slate-400"
                }`}
              >
                {user.subscriptionStatus}
              </span>
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  user.tradeMode === "LIVE"
                    ? "bg-green-500/20 text-green-400"
                    : "bg-blue-500/20 text-blue-400"
                }`}
              >
                {user.tradeMode}
              </span>
            </div>
            {user.tradeMode === "DEMO" && user.demoBalance && (
              <div className="text-xs text-cyan-400 mt-1 font-mono">
                💰 ${parseFloat(user.demoBalance).toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-cyan-500/20 to-violet-600/20 text-cyan-400 border border-cyan-500/20"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#1e293b] space-y-2">
          {user.role === "ADMIN" && (
            <a
              href="/admin"
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-violet-400 hover:bg-violet-500/10 transition-all"
            >
              <span>👨‍💼</span>
              Panel Admin
            </a>
          )}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 transition-all"
          >
            <span>🚪</span>
            Déconnexion
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-[#0a0f1e] border-b border-[#1e293b] flex items-center px-4 lg:px-6 gap-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-slate-400 hover:text-white p-1"
          >
            ☰
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <div className="text-sm text-slate-400">
              <span className="font-mono text-cyan-400">{user.tradeMode}</span>
              {user.tradeMode === "DEMO" && (
                <span className="ml-2 text-slate-300">
                  ${parseFloat(user.demoBalance || "0").toFixed(2)}
                </span>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
