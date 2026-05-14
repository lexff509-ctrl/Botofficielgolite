"use client";

import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";

const ssidStatusConfig: Record<string, { label: string; color: string }> = {
  VALID: { label: "Valide", color: "bg-emerald-500/20 text-emerald-400" },
  EXPIRED: { label: "Expiré", color: "bg-red-500/20 text-red-400" },
  UNKNOWN: { label: "Non vérifié", color: "bg-yellow-500/20 text-yellow-400" },
  NOT_SET: { label: "Non configuré", color: "bg-slate-500/20 text-slate-400" },
};

// No more manual SSID validation needed as it's handled by the Bridge extension

export default function ProfilePage() {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    username: "",
    pocketOptionUid: "",
    tradeMode: "DEMO",
    demoTradeAmount: "1",
    liveTradeAmount: "1",
    profitTarget: "",
    lossLimit: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  // Password change state
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordError, setPasswordError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user) {
          setUser(data.user);
          setForm({
            username: data.user.username || "",
            pocketOptionUid: data.user.pocketOptionUid || "",
            tradeMode: data.user.tradeMode || "DEMO",
            demoTradeAmount: data.user.demoTradeAmount || "1",
            liveTradeAmount: data.user.liveTradeAmount || "1",
            profitTarget: data.user.profitTarget || "",
            lossLimit: data.user.lossLimit || "",
          });
        }
      })
      .catch(() => {});
  }, []);

  // const ssidValidation = useMemo(() => validateSsid(form.pocketOptionSsid), [form.pocketOptionSsid]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const payload: Record<string, unknown> = {
        username: form.username,
        pocketOptionUid: form.pocketOptionUid,
        tradeMode: form.tradeMode,
        demoTradeAmount: form.demoTradeAmount,
        liveTradeAmount: form.liveTradeAmount,
      };
      // Manual SSID entry removed
      if (form.profitTarget) {
        payload.profitTarget = parseFloat(form.profitTarget);
      } else {
        payload.profitTarget = null;
      }
      if (form.lossLimit) {
        payload.lossLimit = parseFloat(form.lossLimit);
      } else {
        payload.lossLimit = null;
      }

      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    setPasswordSuccess("");

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Les mots de passe ne correspondent pas");
      return;
    }
    if (passwordForm.newPassword.length < 6) {
      setPasswordError("Le nouveau mot de passe doit contenir au moins 6 caractères");
      return;
    }

    setPasswordLoading(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordError(data.error || "Erreur");
      } else {
        setPasswordSuccess("Mot de passe modifié avec succès!");
        setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      }
    } catch {
      setPasswordError("Erreur de connexion");
    }
    setPasswordLoading(false);
  };

  const ssidStatus = (user?.ssidStatus as string) || "NOT_SET";
  const statusConfig = ssidStatusConfig[ssidStatus] || ssidStatusConfig.NOT_SET;

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
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm">Profil mis à jour avec succès!</div>
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
                <p className="text-xs text-slate-600 mt-1">L&apos;email ne peut pas être modifié</p>
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Nom d&apos;utilisateur</label>
                <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors" />
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">IDENTIFIANTS POCKETOPTION</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">UID PocketOption</label>
                <input
                  type="text"
                  value={form.pocketOptionUid}
                  onChange={(e) => setForm({ ...form, pocketOptionUid: e.target.value })}
                  placeholder="Ex: 12345678"
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <p className="text-xs text-slate-500 mt-1">Votre ID utilisateur Pocket Option</p>
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">MODE DE TRADING</div>
            <div className="grid grid-cols-2 gap-3">
              {["DEMO", "LIVE"].map((m) => (
                <button key={m} type="button" onClick={() => setForm({ ...form, tradeMode: m })} className={`p-4 rounded-xl border-2 text-left transition-all ${form.tradeMode === m ? m === "DEMO" ? "border-blue-500/50 bg-blue-500/10" : "border-green-500/50 bg-green-500/10" : "border-slate-700 hover:border-slate-600"}`}>
                  <div className={`font-bold ${m === "DEMO" ? "text-blue-400" : "text-green-400"}`}>Mode {m}</div>
                  <div className="text-xs text-slate-400 mt-1">{m === "DEMO" ? "Capital fictif $10,000" : "Capital reel PocketOption"}</div>
                </button>
              ))}
            </div>
          </div>

          {/* TRADE AMOUNTS */}
          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">MONTANTS DE TRADE</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Montant Demo ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.demoTradeAmount}
                  onChange={(e) => setForm({ ...form, demoTradeAmount: e.target.value })}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Montant Live ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.liveTradeAmount}
                  onChange={(e) => setForm({ ...form, liveTradeAmount: e.target.value })}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* PROFIT / LOSS LIMITS */}
          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">LIMITES QUOTIDIENNES</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Objectif Profit ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.profitTarget}
                  onChange={(e) => setForm({ ...form, profitTarget: e.target.value })}
                  placeholder="Ex: 50"
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <p className="text-xs text-slate-500 mt-1">Le bot s&apos;arrête quand le profit atteint ce montant</p>
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Limite de Perte ($)</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={form.lossLimit}
                  onChange={(e) => setForm({ ...form, lossLimit: e.target.value })}
                  placeholder="Ex: 25"
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <p className="text-xs text-slate-500 mt-1">Le bot s&apos;arrête quand la perte atteint ce montant</p>
              </div>
            </div>
          </div>

          {/* ===== POCKETOPTION CONFIG ===== */}
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-slate-400 text-xs font-medium">STATUT CONNEXION POCKETOPTION</div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusConfig.color}`}>
                {statusConfig.label}
              </span>
            </div>
          </div>

          {/* ===== EXTENSION BRIDGE SECTION ===== */}
          <div className="glass-card rounded-xl p-6 border-2 border-cyan-500/20 bg-cyan-500/5">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">BotOfficiel Bridge</h3>
                <p className="text-slate-400 text-xs mb-3">Connexion automatique via extension Chrome</p>
                <a 
                  href="/downloads/botofficiel-bridge.zip" 
                  download
                  className="inline-flex items-center gap-2 bg-cyan-500 hover:bg-cyan-600 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Télécharger Bridge Extension
                </a>
              </div>
            </div>

            <div className="space-y-6">
              {/* API KEY DISPLAY */}
              <div className="bg-slate-900/50 rounded-xl p-4 border border-slate-700">
                <label className="block text-slate-500 text-[10px] font-bold uppercase tracking-wider mb-2">Votre Clé API Extension</label>
                <div className="flex items-center gap-3">
                  <div className="flex-1 font-mono text-sm text-cyan-400 bg-black/30 rounded-lg px-4 py-3 border border-cyan-500/10">
                    {showApiKey ? (user?.extensionApiKey as string) : "••••••••••••••••••••••••••••••••"}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="p-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showApiKey ? "M15 12a3 3 0 11-6 0 3 3 0 016 0z" : "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.754-9.474-6.596a9.995 9.995 0 0112.457-12.457L13.875 1.175"} />
                      {!showApiKey && <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />}
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(user?.extensionApiKey as string);
                      setSuccess("Clé API copiée !");
                      setTimeout(() => setSuccess(""), 3000);
                    }}
                    className="p-3 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-400 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* SYNC STATUS */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/5 rounded-xl p-4 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Dernière Synchro</div>
                  <div className="text-sm text-white font-medium">
                    {user?.extensionLastSync 
                      ? new Date(user.extensionLastSync as string).toLocaleString()
                      : "Jamais synchronisé"}
                  </div>
                </div>
                <div className="bg-white/5 rounded-xl p-4 border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-bold uppercase mb-1">Appareil</div>
                  <div className="text-sm text-white font-medium truncate">
                    {(user?.extensionDeviceName as string) || "Aucun"}
                  </div>
                </div>
              </div>

              {/* VISUAL GUIDE */}
              <div className="rounded-xl border border-slate-700 overflow-hidden">
                <div className="bg-slate-800/60 px-5 py-3 border-b border-slate-700">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider">📋 Guide de connexion — 4 étapes</div>
                </div>

                {/* Step 1 */}
                <div className="flex gap-4 p-4 border-b border-slate-800/60 hover:bg-white/3 transition-colors">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center">
                    <span className="text-cyan-400 font-black text-sm">1</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white mb-1">Téléchargez l&apos;extension Chrome</div>
                    <p className="text-xs text-slate-400 leading-relaxed mb-2">
                      Cliquez sur le bouton ci-dessus pour télécharger le fichier <span className="font-mono text-cyan-400">botofficiel-bridge.zip</span>.
                      Décompressez-le dans un dossier sur votre ordinateur.
                    </p>
                    <a
                      href="/downloads/botofficiel-bridge.zip"
                      download
                      className="inline-flex items-center gap-1.5 text-xs text-cyan-400 border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 rounded-lg hover:bg-cyan-500/20 transition-colors font-bold"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Télécharger botofficiel-bridge.zip
                    </a>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-4 p-4 border-b border-slate-800/60 hover:bg-white/3 transition-colors">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
                    <span className="text-violet-400 font-black text-sm">2</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white mb-1">Installez l&apos;extension dans Chrome</div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Ouvrez Chrome et allez à l&apos;adresse{" "}
                      <span className="font-mono text-violet-400">chrome://extensions</span>.
                      Activez le{" "}
                      <span className="font-bold text-white">Mode développeur</span>{" "}
                      (bouton en haut à droite).
                      Cliquez sur{" "}
                      <span className="font-bold text-white">&quot;Charger l&apos;extension non empaquetée&quot;</span>{" "}
                      et sélectionnez le dossier décompressé.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-4 p-4 border-b border-slate-800/60 hover:bg-white/3 transition-colors">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                    <span className="text-amber-400 font-black text-sm">3</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white mb-1">Configurez votre Clé API</div>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Cliquez sur l&apos;icône de l&apos;extension dans la barre Chrome.
                      Copiez votre{" "}
                      <span className="font-bold text-amber-400">Clé API Extension</span>{" "}
                      affichée ci-dessus et collez-la dans l&apos;extension.
                      Appuyez sur <span className="font-bold text-white">Sauvegarder</span>.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex gap-4 p-4 hover:bg-white/3 transition-colors">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                    <span className="text-emerald-400 font-black text-sm">4</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white mb-1">Ouvrez PocketOption — tout est automatique !</div>
                    <p className="text-xs text-slate-400 leading-relaxed mb-2">
                      Accédez à{" "}
                      <a href="https://pocketoption.com" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline font-bold">
                        pocketoption.com
                      </a>{" "}
                      et connectez-vous à votre compte.
                      L&apos;extension détecte automatiquement votre session et synchronise votre compte avec BotOfficiel.
                      Le statut{" "}
                      <span className="text-emerald-400 font-bold">🟢 Bridge Connected</span>{" "}
                      apparaîtra dans votre dashboard dans les 10 secondes.
                    </p>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                      <p className="text-xs text-emerald-400">
                        ✅ Aucun SSID à copier-coller. Connexion 100% automatique et sécurisée.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">INFORMATIONS COMPTE</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Role", value: user?.role as string },
                { label: "Abonnement", value: user?.subscriptionStatus as string },
                { label: "Solde Demo", value: user?.demoBalance ? `$${parseFloat(user.demoBalance as string).toFixed(2)}` : "$10,000.00" },
                { label: "Verifié", value: (user as Record<string, unknown>)?.isVerified ? "Oui" : "Non" },
              ].map((info) => (
                <div key={info.label} className="bg-white/5 rounded-xl p-3">
                  <div className="text-xs text-slate-400">{info.label}</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{info.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* PASSWORD CHANGE */}
          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">CHANGER LE MOT DE PASSE</div>
            {passwordSuccess && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 text-emerald-400 text-sm mb-4">{passwordSuccess}</div>
            )}
            {passwordError && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-red-400 text-sm mb-4">{passwordError}</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Mot de passe actuel</label>
                <input
                  type="password"
                  value={passwordForm.currentPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Nouveau mot de passe</label>
                <input
                  type="password"
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={passwordForm.confirmPassword}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-cyan-500 transition-colors"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handlePasswordChange}
              disabled={passwordLoading || !passwordForm.currentPassword || !passwordForm.newPassword}
              className="mt-4 px-6 py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-400 font-bold text-sm transition-all disabled:opacity-50"
            >
              {passwordLoading ? "Modification..." : "Changer le mot de passe"}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 text-white font-bold transition-all text-sm"
          >
            {loading ? "Sauvegarde en cours..." : "Sauvegarder les modifications"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
