"use client";

import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";

export default function ProfilePage() {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    username: "",
    pocketOptionSsid: "",
    tradeMode: "DEMO",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [showSsid, setShowSsid] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          setForm({
            username: data.user.username || "",
            pocketOptionSsid: "",
            tradeMode: data.user.tradeMode || "DEMO",
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur de mise à jour");
      } else {
        setSuccess("Profil mis à jour avec succès!");
        setUser(data.user);
      }
    } catch {
      setError("Erreur de connexion");
    }
    setLoading(false);
  };

  const ssidInstructions = [
    "1. Connectez-vous à votre compte PocketOption",
    "2. Ouvrez les outils de développement (F12)",
    "3. Allez dans l'onglet 'Application' ou 'Storage'",
    "4. Trouvez les cookies ou le localStorage",
    "5. Copiez la valeur 'ssid'",
  ];

  return (
    <DashboardLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Mon <span className="gradient-text">Profil</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Gérez vos paramètres et configurez votre connexion PocketOption
          </p>
        </div>

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm">✓ {success}</div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">INFORMATIONS DU COMPTE</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Email</label>
                <input type="email" value={user?.email as string || ""} disabled className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-slate-400 text-sm cursor-not-allowed opacity-60" />
                <p className="text-xs text-slate-600 mt-1">L'email ne peut pas être modifié</p>
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Nom d'utilisateur</label>
                <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors" />
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">MODE DE TRADING</div>
            <div className="grid grid-cols-2 gap-3">
              {["DEMO", "LIVE"].map((m) => (
                <button key={m} type="button" onClick={() => setForm({ ...form, tradeMode: m })} className={`p-4 rounded-xl border-2 text-left transition-all ${form.tradeMode === m ? m === "DEMO" ? "border-blue-500/50 bg-blue-500/10" : "border-green-500/50 bg-green-500/10" : "border-slate-700 hover:border-slate-600"}`}>
                  <div className="text-2xl mb-2">{m === "DEMO" ? "🔵" : "🔴"}</div>
                  <div className={`font-bold ${m === "DEMO" ? "text-blue-400" : "text-green-400"}`}>Mode {m}</div>
                  <div className="text-xs text-slate-400 mt-1">{m === "DEMO" ? "Trading simulé avec $10,000 de capital fictif" : "Trading réel avec votre compte PocketOption"}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">CONFIGURATION POCKETOPTION</div>
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">Votre SSID PocketOption</label>
              <div className="relative">
                <input type={showSsid ? "text" : "password"} value={form.pocketOptionSsid} onChange={(e) => setForm({ ...form, pocketOptionSsid: e.target.value })} placeholder="Entrez votre SSID PocketOption..." className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 pr-12 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 text-sm font-mono" />
                <button type="button" onClick={() => setShowSsid(!showSsid)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors text-sm">{showSsid ? "🙈" : "👁️"}</button>
              </div>
              <p className="text-xs text-slate-500 mt-1">🔒 Chiffré AES-256 en base de données · Jamais exposé côté client</p>
            </div>
            <div className="mt-4 bg-white/5 rounded-xl p-4">
              <div className="text-xs font-medium text-slate-300 mb-2">Comment obtenir votre SSID :</div>
              <ol className="space-y-1">
                {ssidInstructions.map((step, i) => (<li key={i} className="text-xs text-slate-400">{step}</li>))}
              </ol>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">INFORMATIONS COMPTE</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: "Rôle", value: user?.role as string },
                { label: "Abonnement", value: user?.subscriptionStatus as string },
                { label: "Solde Démo", value: user?.demoBalance ? `$${parseFloat(user.demoBalance as string).toFixed(2)}` : "$10,000.00" },
              ].map((info) => (
                <div key={info.label} className="bg-white/5 rounded-xl p-3">
                  <div className="text-xs text-slate-400">{info.label}</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{info.value}</div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" disabled={loading} className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 text-white font-bold transition-all text-sm">
            {loading ? "Sauvegarde en cours..." : "💾 Sauvegarder les modifications"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
