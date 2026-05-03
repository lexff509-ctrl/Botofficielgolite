"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface Props {
  children: React.ReactNode;
}

const adminNavItems = [
  { href: "/admin", label: "Dashboard", icon: "📊" },
  { href: "/admin/users", label: "Utilisateurs", icon: "👥" },
  { href: "/admin/payments", label: "Paiements", icon: "💳" },
  { href: "/admin/settings", label: "Parametres", icon: "⚙️" },
  { href: "/admin/stats", label: "Statistiques", icon: "📈" },
];

export default function AdminLayout({ children }: Props) {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
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
          if (data.user.role !== "ADMIN") {
            router.push("/dashboard");
            return;
          }
          setUser(data.user);
        }
      })
      .catch(() => router.push("/"));
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#020617] flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#020617] flex">
      <aside className="w-64 bg-[#0a0f1e] border-r border-[#1e293b] flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-[#1e293b]">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-400 to-fuchsia-600 flex items-center justify-center font-bold text-sm mr-3">
            A
          </div>
          <span className="font-black text-white">Admin Panel</span>
        </div>

        <div className="p-4 border-b border-[#1e293b]">
          <div className="glass-card rounded-xl p-3">
            <div className="font-semibold text-white text-sm">{user.username as string}</div>
            <div className="text-xs text-violet-400 mt-0.5">Administrateur</div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {adminNavItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? "bg-gradient-to-r from-violet-500/20 to-fuchsia-600/20 text-violet-400 border border-violet-500/20"
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
          <a
            href="/dashboard"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-cyan-400 hover:bg-cyan-500/10 transition-all"
          >
            <span>📊</span>
            Mon Dashboard
          </a>
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
        <header className="h-16 bg-[#0a0f1e] border-b border-[#1e293b] flex items-center px-6">
          <h1 className="font-bold text-white">GoliteCommunity · Panel Admin</h1>
          <div className="ml-auto">
            <span className="text-xs text-violet-400 bg-violet-500/10 px-3 py-1 rounded-full border border-violet-500/20">
              ADMIN
            </span>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
