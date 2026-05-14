"use client";

import { useEffect, useState } from "react";
import AdminLayout from "@/components/AdminLayout";

interface SettingsData {
  globalSsidSet: boolean;
  globalSsidStatus: string;
  sharedClientConnected: boolean;
  sharedClientUserCount: number;
  payoutRate: number;
}

interface PromoCode {
  id: number;
  code: string;
  discountPercent: number;
  maxUses: number | null;
  currentUses: number;
  isActive: boolean;
  createdAt: string;
}

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [ssidInput, setSsidInput] = useState("");
  const [payoutRate, setPayoutRate] = useState(92);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Promo Code State
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [newPromoCode, setNewPromoCode] = useState("");
  const [newPromoDiscount, setNewPromoDiscount] = useState(100);
  const [newPromoMaxUses, setNewPromoMaxUses] = useState<number | "">("");

  const fetchPromos = async () => {
    try {
      const res = await fetch("/api/admin/promos");
      const data = await res.json();
      if (res.ok && data.promos) {
        setPromos(data.promos);
      }
    } catch {}
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings");
      const data = await res.json();
      if (res.ok) {
        setSettings(data);
        setPayoutRate(Math.round((data.payoutRate || 0.92) * 100));
      }
    } catch {}
  };

  useEffect(() => {
    fetchSettings();
    fetchPromos();
  }, []);

  const handleSetSsid = async () => {
    if (!ssidInput.trim()) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET", globalSsid: ssidInput.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message });
        setSsidInput("");
        fetchSettings();
      } else {
        setMessage({ type: "error", text: data.error || "Erreur" });
      }
    } catch {
      setMessage({ type: "error", text: "Erreur de connexion" });
    }
    setLoading(false);
  };

  const handleClearSsid = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CLEAR" }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message });
        fetchSettings();
      } else {
        setMessage({ type: "error", text: data.error || "Erreur" });
      }
    } catch {
      setMessage({ type: "error", text: "Erreur de connexion" });
    }
    setLoading(false);
  };

  const handleSetPayoutRate = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SET_PAYOUT_RATE", payoutRate: payoutRate / 100 }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message });
      } else {
        setMessage({ type: "error", text: data.error || "Erreur" });
      }
    } catch {
      setMessage({ type: "error", text: "Erreur de connexion" });
    }
    setLoading(false);
  };

  const handleCreatePromo = async () => {
    if (!newPromoCode) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/promos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newPromoCode,
          discountPercent: newPromoDiscount,
          maxUses: newPromoMaxUses === "" ? null : newPromoMaxUses
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Code promo créé" });
        setNewPromoCode("");
        setNewPromoDiscount(100);
        setNewPromoMaxUses("");
        fetchPromos();
      } else {
        setMessage({ type: "error", text: data.error || "Erreur" });
      }
    } catch {
      setMessage({ type: "error", text: "Erreur de connexion" });
    }
    setLoading(false);
  };

  const handleDeletePromo = async (id: number) => {
    if (!confirm("Voulez-vous vraiment désactiver ce code promo ?")) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/promos?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: "Code promo désactivé" });
        fetchPromos();
      }
    } catch {
      setMessage({ type: "error", text: "Erreur" });
    }
    setLoading(false);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "VALID": return "text-emerald-400";
      case "EXPIRED": return "text-red-400";
      case "UNKNOWN": return "text-yellow-400";
      default: return "text-slate-400";
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case "VALID": return "Valide";
      case "EXPIRED": return "Expire";
      case "UNKNOWN": return "Inconnu";
      default: return "Non configure";
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Parametres <span className="gradient-text">Plateforme</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Configurez le SSID global et les parametres de trading
          </p>
        </div>

        {message && (
          <div className={`rounded-xl p-4 text-sm border ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}>
            {message.text}
          </div>
        )}

        {/* Admin Note about Bridge Model */}
        <div className="glass-card rounded-xl p-5 border-2 border-violet-500/20 bg-violet-500/5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-full bg-violet-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Modèle Connection Bridge</h3>
              <p className="text-slate-400 text-xs">La plateforme utilise désormais l&apos;extension Chrome pour les connexions clients.</p>
            </div>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed mb-4">
            Le système de SSID Global a été retiré au profit du <strong>BotOfficiel Bridge</strong>. 
            Chaque utilisateur se connecte désormais via son propre navigateur, ce qui garantit une stabilité 24/7 et évite les blocages d'IP par PocketOption. 
            Assurez-vous que vos clients téléchargent bien l'extension depuis leur profil.
          </p>
          <a 
            href="/downloads/botofficiel-bridge.zip" 
            download
            className="inline-flex items-center gap-2 bg-violet-500 hover:bg-violet-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Télécharger Bridge Extension (ZIP)
          </a>
        </div>

        {/* Payout Rate */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">TAUX DE PAIEMENT PAR DEFAUT</div>
          <p className="text-sm text-slate-400 mb-3">
            Utilise pour le calcul de l&apos;interet compose. Les utilisateurs peuvent le personnaliser.
          </p>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <input
                type="number"
                min="50"
                max="100"
                value={payoutRate}
                onChange={(e) => setPayoutRate(parseInt(e.target.value) || 92)}
                className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-cyan-500 transition-colors text-sm"
              />
            </div>
            <span className="text-slate-400 text-sm">%</span>
            <button
              onClick={handleSetPayoutRate}
              disabled={loading}
              className="px-6 py-3 rounded-xl font-bold text-sm bg-white/10 hover:bg-white/20 border border-slate-600 text-white transition-all disabled:opacity-50"
            >
              Sauvegarder
            </button>
          </div>
        </div>

        {/* Promo Codes Management */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">CODES PROMO</div>
          
          <div className="bg-white/5 rounded-xl p-4 mb-4 grid grid-cols-4 gap-3 items-end">
            <div className="col-span-1">
              <label className="block text-slate-400 text-xs mb-1.5">Code</label>
              <input
                type="text"
                value={newPromoCode}
                onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
                placeholder="FREE100"
                className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm uppercase"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-slate-400 text-xs mb-1.5">Réduction %</label>
              <input
                type="number"
                min="1"
                max="100"
                value={newPromoDiscount}
                onChange={(e) => setNewPromoDiscount(parseInt(e.target.value) || 100)}
                className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div className="col-span-1">
              <label className="block text-slate-400 text-xs mb-1.5">Max Utilisations</label>
              <input
                type="number"
                min="1"
                value={newPromoMaxUses}
                onChange={(e) => setNewPromoMaxUses(e.target.value === "" ? "" : parseInt(e.target.value))}
                placeholder="Illimité"
                className="w-full bg-black/20 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm"
              />
            </div>
            <div className="col-span-1">
              <button
                onClick={handleCreatePromo}
                disabled={loading || !newPromoCode}
                className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
              >
                Créer
              </button>
            </div>
          </div>

          {promos.length > 0 && (
            <div className="border border-slate-700 rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-800/50 text-xs uppercase text-slate-400">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Réduction</th>
                    <th className="px-4 py-3">Utilisations</th>
                    <th className="px-4 py-3">Statut</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {promos.map((promo) => (
                    <tr key={promo.id} className="bg-white/5">
                      <td className="px-4 py-3 font-mono font-bold text-cyan-400">{promo.code}</td>
                      <td className="px-4 py-3 text-emerald-400">-{promo.discountPercent}%</td>
                      <td className="px-4 py-3">
                        {promo.currentUses} / {promo.maxUses === null ? "∞" : promo.maxUses}
                      </td>
                      <td className="px-4 py-3">
                        {promo.isActive ? (
                          <span className="bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded text-xs">Actif</span>
                        ) : (
                          <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded text-xs">Désactivé</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {promo.isActive && (
                          <button
                            onClick={() => handleDeletePromo(promo.id)}
                            className="text-red-400 hover:text-red-300 text-xs font-bold"
                          >
                            Désactiver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info Box */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-3">INFORMATIONS</div>
          <div className="space-y-2 text-sm text-slate-300">
            <p><span className="text-cyan-400 font-medium">SSID Global:</span> Quand vous configurez un SSID global, tous les utilisateurs qui n&apos;ont pas de SSID personnel peuvent trader via votre connexion PocketOption.</p>
            <p><span className="text-yellow-400 font-medium">Attention:</span> Les trades passes via le SSID global utilisent le compte PocketOption de l&apos;admin. Le plateforme suit les profits/pertes de chaque utilisateur individuellement.</p>
            <p><span className="text-violet-400 font-medium">Interet Compose:</span> Le taux de paiement par defaut est utilise pour calculer les gains composes. Les utilisateurs peuvent le modifier au demarrage du bot.</p>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
