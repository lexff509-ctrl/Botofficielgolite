"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  defaultTab: "login" | "register";
  onClose: () => void;
}

export default function AuthModal({ defaultTab, onClose }: Props) {
  const [tab, setTab] = useState(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const [form, setForm] = useState({
    email: "",
    password: "",
    username: "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const url = tab === "login" ? "/api/auth/login" : "/api/auth/register";
      const body =
        tab === "login"
          ? { email: form.email, password: form.password }
          : form;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Une erreur est survenue");
        return;
      }

      // Token is now in httpOnly cookie, no localStorage needed
      // Redirect based on role
      if (data.user?.role === "ADMIN") {
        router.push("/admin");
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Erreur de connexion au serveur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative glass-card rounded-2xl p-8 w-full max-w-md border border-slate-700/50 animate-slide-up">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10 transition-colors"
        >
          ×
        </button>

        <div className="text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center font-black text-xl mx-auto mb-3">
            G
          </div>
          <h2 className="text-xl font-black text-white">GoliteCommunity</h2>
          <p className="text-slate-400 text-sm">Bot Trading PocketOption</p>
        </div>

        <div className="flex bg-white/5 rounded-xl p-1 mb-6">
          <button
            onClick={() => setTab("login")}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === "login"
                ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Connexion
          </button>
          <button
            onClick={() => setTab("register")}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === "register"
                ? "bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-lg"
                : "text-slate-400 hover:text-white"
            }`}
          >
            Inscription
          </button>
        </div>

        {tab === "register" && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-4 text-emerald-400 text-sm text-center">
            3 jours d'essai gratuit inclus — Paiement requis ensuite
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-red-400 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === "register" && (
            <div>
              <label className="block text-slate-400 text-xs mb-1.5 font-medium">
                Nom d'utilisateur
              </label>
              <input
                type="text"
                required
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
                placeholder="Votre pseudo"
              />
            </div>
          )}

          <div>
            <label className="block text-slate-400 text-xs mb-1.5 font-medium">
              Email
            </label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
              placeholder="votre@email.com"
            />
          </div>

          <div>
            <label className="block text-slate-400 text-xs mb-1.5 font-medium">
              Mot de passe
            </label>
            <input
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors text-sm"
              placeholder={tab === "register" ? "Min. 6 caractères" : "••••••••"}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-all duration-200 shadow-lg mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Chargement...
              </span>
            ) : tab === "login" ? (
              "Se Connecter →"
            ) : (
              "Créer mon compte →"
            )}
          </button>
        </form>

        {tab === "login" && (
          <p className="text-center text-slate-500 text-xs mt-4">
            Pas encore de compte ?{" "}
            <button
              onClick={() => setTab("register")}
              className="text-cyan-400 hover:underline"
            >
              Inscrivez-vous gratuitement
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
