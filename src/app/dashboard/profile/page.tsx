"use client";

import { useEffect, useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";

const ssidStatusConfig: Record<string, { label: string; color: string }> = {
  VALID: { label: "Valide", color: "bg-emerald-500/20 text-emerald-400" },
  EXPIRED: { label: "Expiré", color: "bg-red-500/20 text-red-400" },
  UNKNOWN: { label: "Non vérifié", color: "bg-yellow-500/20 text-yellow-400" },
  NOT_SET: { label: "Non configuré", color: "bg-slate-500/20 text-slate-400" },
};

function validateSsid(value: string): { valid: boolean; type: "demo" | "real" | null; session: string | null; errors: string[] } {
  const errors: string[] = [];
  if (!value.trim()) return { valid: false, type: null, session: null, errors: [] };

  // Must start with 42["auth"
  if (!value.startsWith('42["auth"')) {
    errors.push('Le message doit commencer par 42["auth"');
  }

  // Try to parse the JSON part
  try {
    const jsonPart = value.substring(2); // Remove "42"
    const parsed = JSON.parse(jsonPart);
    if (!Array.isArray(parsed) || parsed.length < 2) {
      errors.push("Format invalide: doit être un tableau [auth, {...}]");
    } else {
      const authData = parsed[1];
      if (!authData.session) {
        errors.push('Pas de champ "session" trouvé dans le message');
      }
      if (authData.isDemo === undefined) {
        errors.push('Pas de champ "isDemo" trouvé - vérifiez que vous avez copié le bon message');
      }
    }
  } catch {
    errors.push("Le message n'est pas un JSON valide après 42");
  }

  // Extract info
  let type: "demo" | "real" | null = null;
  let session: string | null = null;
  try {
    const jsonPart = value.substring(2);
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed) && parsed[1]) {
      type = parsed[1].isDemo === 1 ? "demo" : "real";
      session = parsed[1].session || null;
    }
  } catch {}

  return { valid: errors.length === 0, type, session, errors };
}

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
  const [showGuide, setShowGuide] = useState(false);

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

  const ssidValidation = useMemo(() => validateSsid(form.pocketOptionSsid), [form.pocketOptionSsid]);

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

          {/* ===== POCKETOPTION CONFIG ===== */}
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-slate-400 text-xs font-medium">CONFIGURATION POCKETOPTION</div>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusConfig.color}`}>
                SSID: {statusConfig.label}
              </span>
            </div>

            {/* SSID Expired Warning */}
            {ssidStatus === "EXPIRED" && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-4">
                <div className="text-red-400 text-sm font-medium">Votre SSID est expire. Le bot ne peut pas fonctionner.</div>
                <div className="text-red-400/70 text-xs mt-1">Collez un nouveau SSID ci-dessous puis sauvegardez.</div>
              </div>
            )}

            {/* SSID Input */}
            <div>
              <label className="block text-slate-400 text-xs mb-1.5">
                Message Auth PocketOption
              </label>
              <div className="relative">
                <textarea
                  value={form.pocketOptionSsid}
                  onChange={(e) => setForm({ ...form, pocketOptionSsid: e.target.value })}
                  placeholder='42["auth",{"session":"votre_session_id","isDemo":1,"uid":12345,"platform":1}]'
                  rows={3}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500 text-sm font-mono resize-y"
                  style={form.pocketOptionSsid && !ssidValidation.valid ? { borderColor: "rgba(239,68,68,0.5)" } : form.pocketOptionSsid && ssidValidation.valid ? { borderColor: "rgba(34,197,94,0.5)" } : {}}
                />
                <button
                  type="button"
                  onClick={() => setShowSsid(!showSsid)}
                  className="absolute right-3 top-3 text-slate-400 hover:text-white transition-colors text-xs"
                >
                  {showSsid ? "Masquer" : "Afficher"}
                </button>
              </div>

              {/* Live Validation Feedback */}
              {form.pocketOptionSsid && (
                <div className="mt-2 space-y-1.5">
                  {ssidValidation.valid ? (
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span className="text-xs text-emerald-400 font-medium">Format valide</span>
                      {ssidValidation.type && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          ssidValidation.type === "demo"
                            ? "bg-blue-500/20 text-blue-400"
                            : "bg-green-500/20 text-green-400"
                        }`}>
                          {ssidValidation.type === "demo" ? "Compte DEMO" : "Compte REEL"}
                        </span>
                      )}
                    </div>
                  ) : (
                    ssidValidation.errors.map((err, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="w-2 h-2 rounded-full bg-red-500 mt-0.5 shrink-0" />
                        <span className="text-xs text-red-400">{err}</span>
                      </div>
                    ))
                  )}
                  {ssidValidation.valid && ssidValidation.session && (
                    <div className="text-xs text-slate-500 font-mono">
                      Session: {ssidValidation.session.substring(0, 12)}...
                    </div>
                  )}
                </div>
              )}

              <p className="text-xs text-slate-500 mt-2">Chiffre AES-256 en base de donnees</p>
            </div>

            {/* Quick Guide Toggle */}
            <button
              type="button"
              onClick={() => setShowGuide(!showGuide)}
              className="mt-4 w-full text-left bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3 hover:bg-cyan-500/15 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-cyan-400 text-sm font-medium">Comment trouver votre SSID ?</span>
                <span className="text-cyan-400 text-xs">{showGuide ? "Masquer" : "Voir le guide"}</span>
              </div>
            </button>

            {/* Full Guide */}
            {showGuide && (
              <div className="mt-3 space-y-4">
                {/* Step 1 */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold">1</span>
                    <span className="text-sm font-medium text-white">Ouvrez PocketOption</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-8">
                    Allez sur <span className="text-cyan-400 font-mono">pocketoption.com</span> et connectez-vous a votre compte.
                    Utilisez le navigateur <span className="text-white font-medium">Google Chrome</span> (obligatoire pour les outils de dev).
                  </p>
                </div>

                {/* Step 2 */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold">2</span>
                    <span className="text-sm font-medium text-white">Ouvrez les outils de developpeur</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-8">
                    Appuyez sur <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-200 font-mono text-[10px]">F12</kbd> ou
                    <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-200 font-mono text-[10px]">Ctrl+Maj+I</kbd>
                  </p>
                  <div className="ml-8 mt-2 bg-slate-800/50 rounded-lg p-2 text-[10px] font-mono text-slate-500 border border-slate-700">
                    Chrome DevTools s&apos;ouvre en bas ou a droite de la page
                  </div>
                </div>

                {/* Step 3 */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold">3</span>
                    <span className="text-sm font-medium text-white">Allez dans l&apos;onglet Network</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-8">
                    Cliquez sur l&apos;onglet <span className="text-white font-medium">Network</span> en haut des DevTools.
                    Puis cliquez sur le filtre <span className="text-cyan-400 font-medium">WS</span> (WebSocket) dans la barre de filtres.
                  </p>
                  <div className="ml-8 mt-2 bg-slate-800/50 rounded-lg p-2 border border-slate-700">
                    <div className="flex gap-1 text-[10px] font-mono">
                      <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-400">All</span>
                      <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-400">Fetch</span>
                      <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-400">JS</span>
                      <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-bold">WS</span>
                      <span className="px-2 py-0.5 rounded bg-slate-700 text-slate-400">Other</span>
                    </div>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold">4</span>
                    <span className="text-sm font-medium text-white">Rechargez la page</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-8">
                    Appuyez sur <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-slate-200 font-mono text-[10px]">F5</kbd> pour recharger la page.
                    Vous verrez apparaitre des connexions WebSocket dans la liste Network.
                  </p>
                </div>

                {/* Step 5 */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 text-xs font-bold">5</span>
                    <span className="text-sm font-medium text-white">Cliquez sur la connexion WebSocket</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-8">
                    Cliquez sur la connexion qui ressemble a <span className="text-cyan-400 font-mono">socket.io/?EIO=4...</span>
                    Puis cliquez sur l&apos;onglet <span className="text-white font-medium">Messages</span> dans le panneau de droite.
                  </p>
                </div>

                {/* Step 6 - CRITICAL */}
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-500/20 text-amber-400 text-xs font-bold">6</span>
                    <span className="text-sm font-medium text-amber-400">Copiez le bon message (ETAPE CRITIQUE)</span>
                  </div>
                  <p className="text-xs text-slate-400 ml-8 mb-2">
                    Dans la liste des messages, cherchez un message envoye par le client (fleche vers le haut) qui commence par :
                  </p>
                  <div className="ml-8 bg-slate-900/80 rounded-lg p-2 font-mono text-[10px] text-emerald-400 border border-emerald-500/30 break-all">
                    42[&quot;auth&quot;,&#123;&quot;session&quot;:&quot;abc123...&quot;,&quot;isDemo&quot;:1,&quot;uid&quot;:12345,&quot;platform&quot;:1&#125;]
                  </div>
                  <p className="text-xs text-slate-400 ml-8 mt-2">
                    <strong className="text-amber-400">Cliquez droit</strong> sur ce message &gt; <strong className="text-white">Copy message</strong> &gt; Collez-le dans le champ ci-dessus.
                  </p>
                </div>

                {/* What to look for vs avoid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* GOOD */}
                  <div className="bg-emerald-500/5 border border-emerald-500/30 rounded-xl p-3">
                    <div className="text-emerald-400 text-xs font-bold mb-2">BON FORMAT</div>
                    <div className="text-[10px] font-mono text-slate-400 space-y-1">
                      <div className="text-emerald-400">42[&quot;auth&quot;,&#123;...&#125;]</div>
                      <ul className="text-slate-400 space-y-0.5 list-disc list-inside text-[10px]">
                        <li>Commence par <span className="text-emerald-400">42[&quot;auth&quot;</span></li>
                        <li>Contient <span className="text-emerald-400">&quot;session&quot;</span></li>
                        <li>Contient <span className="text-emerald-400">&quot;isDemo&quot;</span></li>
                        <li>Est un message envoye (fleche haut)</li>
                      </ul>
                    </div>
                  </div>

                  {/* BAD */}
                  <div className="bg-red-500/5 border border-red-500/30 rounded-xl p-3">
                    <div className="text-red-400 text-xs font-bold mb-2">MAUVAIS FORMAT</div>
                    <div className="text-[10px] font-mono text-slate-400 space-y-1">
                      <div className="text-red-400/70">40&#123;...&#125;</div>
                      <div className="text-red-400/70">42[&quot;ps&quot;,...]</div>
                      <div className="text-red-400/70">42[&quot;successauth&quot;,...]</div>
                      <ul className="text-slate-400 space-y-0.5 list-disc list-inside text-[10px]">
                        <li>Ce ne sont PAS des messages auth</li>
                        <li>Ce sont des reponses du serveur</li>
                        <li>Ils ne contiennent pas de session</li>
                      </ul>
                    </div>
                  </div>
                </div>

                {/* Demo vs Real */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="text-xs font-medium text-white mb-2">Compte DEMO vs REEL</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-2">
                      <div className="text-blue-400 text-[10px] font-bold">DEMO</div>
                      <div className="text-[10px] text-slate-400 font-mono">&quot;isDemo&quot;: 1</div>
                      <div className="text-[10px] text-slate-500">Capital fictif $10,000</div>
                    </div>
                    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2">
                      <div className="text-green-400 text-[10px] font-bold">REEL</div>
                      <div className="text-[10px] text-slate-400 font-mono">&quot;isDemo&quot;: 0</div>
                      <div className="text-[10px] text-slate-500">Argent reel</div>
                    </div>
                  </div>
                  <p className="text-xs text-amber-400/80 mt-2">
                    Le SSID detecte automatiquement le type de compte. Assurez-vous de copier le SSID depuis le bon onglet PocketOption (demo ou reel).
                  </p>
                </div>

                {/* Troubleshooting */}
                <div className="bg-white/5 rounded-xl p-4">
                  <div className="text-xs font-medium text-white mb-2">Depannage</div>
                  <div className="space-y-2 text-xs text-slate-400">
                    <div className="flex items-start gap-2">
                      <span className="text-red-400 shrink-0">x</span>
                      <span><strong className="text-red-400">&quot;Connection timeout&quot;</strong> = SSID invalide ou expire. Retournez sur PocketOption, reconnectez-vous et copiez un nouveau SSID.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-red-400 shrink-0">x</span>
                      <span><strong className="text-red-400">&quot;NotAuthorized&quot;</strong> = SSID expire. Les sessions PocketOption expirent apres quelques heures d&apos;inactivite.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="text-emerald-400 shrink-0">+</span>
                      <span><strong className="text-white">Astuces:</strong> Gardez l&apos;onglet PocketOption ouvert. Le SSID dure plus longtemps si la page reste active. Copiez un nouveau SSID avant chaque session de trading.</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="glass-card rounded-xl p-5">
            <div className="text-slate-400 text-xs font-medium mb-4">INFORMATIONS COMPTE</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { label: "Role", value: user?.role as string },
                { label: "Abonnement", value: user?.subscriptionStatus as string },
                { label: "Solde Demo", value: user?.demoBalance ? `$${parseFloat(user.demoBalance as string).toFixed(2)}` : "$10,000.00" },
              ].map((info) => (
                <div key={info.label} className="bg-white/5 rounded-xl p-3">
                  <div className="text-xs text-slate-400">{info.label}</div>
                  <div className="text-sm font-semibold text-white mt-0.5">{info.value}</div>
                </div>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || (form.pocketOptionSsid.length > 0 && !ssidValidation.valid)}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 text-white font-bold transition-all text-sm"
          >
            {loading ? "Sauvegarde en cours..." : "Sauvegarder les modifications"}
          </button>
        </form>
      </div>
    </DashboardLayout>
  );
}
