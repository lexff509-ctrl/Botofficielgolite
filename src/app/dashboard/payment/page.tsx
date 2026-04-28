"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

interface Plan {
  months: number;
  price: number;
  label: string;
  savings?: string;
}

interface PaymentInfo {
  plans: Plan[];
  currency: string;
}

interface Payment {
  id: number;
  amount: string;
  currency: string;
  txHash: string;
  proofFilePath: string | null;
  status: string;
  planMonths: number;
  createdAt: string;
}

interface UserProfile {
  subscriptionStatus: string;
  subscriptionExpiresAt?: string;
}

export default function PaymentPage() {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [txHash, setTxHash] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [profileRes, paymentsRes, walletRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/payment"),
        fetch("/api/payment/info"),
      ]);

      const profileData = await profileRes.json();
      const paymentsData = await paymentsRes.json();
      const walletData = await walletRes.json();

      if (profileData.user) {
        setUserProfile(profileData.user);
      }
      if (paymentsData.plans) {
        setPaymentInfo({ plans: plansToArray(paymentsData.plans), currency: paymentsData.currency });
      }
      if (walletData.wallet) {
        setWalletAddress(walletData.wallet);
      }
      if (paymentsData.payments) {
        setPayments(paymentsData.payments);
      }
    } catch {}
  }, []);

  function plansToArray(plans: Record<string, { months: number; price: number; label: string; savings?: string }>): Plan[] {
    return Object.values(plans);
  }

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const copyWallet = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlan) return;
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      // Upload proof image first if provided
      let proofFilePath: string | undefined;
      if (proofFile) {
        const formData = new FormData();
        formData.append("proof", proofFile);
        const uploadRes = await fetch("/api/payment/proof", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) {
          setError(uploadData.error || "Erreur lors de l'upload de l'image");
          setLoading(false);
          return;
        }
        proofFilePath = uploadData.proofFilePath;
      }

      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: selectedPlan.price,
          planMonths: selectedPlan.months,
          txHash,
          proofFilePath,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la soumission");
      } else {
        setSuccess("Votre demande de paiement a été soumise! L'admin va vérifier sous 24h.");
        setTxHash("");
        setProofFile(null);
        setProofPreview(null);
        setSelectedPlan(null);
        fetchData();
      }
    } catch {
      setError("Erreur de connexion");
    }
    setLoading(false);
  };

  const statusColors: Record<string, string> = {
    PENDING: "bg-yellow-500/20 text-yellow-400",
    APPROVED: "bg-emerald-500/20 text-emerald-400",
    REJECTED: "bg-red-500/20 text-red-400",
  };

  const subscriptionStatus = userProfile?.subscriptionStatus || "";

  return (
    <DashboardLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Gestion de l'<span className="gradient-text">Abonnement</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Paiement sécurisé via USDT TRC20
          </p>
        </div>

        {/* Current Status */}
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-400 text-xs mb-1">STATUT ACTUEL</div>
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1 rounded-full text-sm font-bold ${
                    subscriptionStatus === "ACTIVE"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : subscriptionStatus === "TRIAL"
                      ? "bg-blue-500/20 text-blue-400"
                      : subscriptionStatus === "PENDING_PAYMENT"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {subscriptionStatus === "ACTIVE" ? "✓ ACTIF" :
                   subscriptionStatus === "TRIAL" ? "⏳ ESSAI GRATUIT (3 jours)" :
                   subscriptionStatus === "PENDING_PAYMENT" ? "⏳ PAIEMENT EN ATTENTE" :
                   "✗ EXPIRÉ"}
                </span>
                {subscriptionStatus === "TRIAL" && (
                  <span className="text-sm text-slate-400">Essai gratuit de 3 jours</span>
                )}
              </div>
            </div>
            {subscriptionStatus === "ACTIVE" && (
              <div className="text-emerald-400 text-sm">🎉 Accès complet activé</div>
            )}
          </div>
        </div>

        {subscriptionStatus === "PENDING_PAYMENT" && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="font-semibold text-yellow-400 mb-1">
              ⏳ Paiement en cours de vérification
            </div>
            <p className="text-slate-400 text-sm">
              Votre paiement est en cours de vérification par l'administrateur. Vous recevrez votre accès sous 24 heures.
            </p>
          </div>
        )}

        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400">
            {success}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Plans */}
          <div className="space-y-4">
            <div className="font-semibold text-white">Choisissez votre plan</div>
            {paymentInfo?.plans.map((plan) => (
              <button
                key={plan.months}
                onClick={() => setSelectedPlan(plan)}
                className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                  selectedPlan?.months === plan.months
                    ? "border-cyan-500/70 bg-cyan-500/10"
                    : "border-slate-700 hover:border-slate-600"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold text-white">{plan.label}</div>
                    {plan.savings && (
                      <div className="text-xs text-emerald-400 mt-0.5">{plan.savings}</div>
                    )}
                    <div className="text-xs text-slate-400 mt-0.5">
                      Accès complet · Bot Signal + Auto · Backtesting
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black text-cyan-400">
                      ${plan.price}
                    </div>
                    <div className="text-xs text-slate-400">USDT TRC20</div>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Payment Form */}
          <div>
            <div className="font-semibold text-white mb-4">Effectuer le paiement</div>
            {walletAddress && (
              <div className="glass-card rounded-xl p-4 mb-4">
                <div className="text-xs text-slate-400 mb-1">WALLET USDT TRC20</div>
                <div className="font-mono text-xs text-cyan-400 break-all bg-white/5 rounded-lg p-3 border border-slate-700">
                  {walletAddress}
                </div>
                <button
                  onClick={copyWallet}
                  className="mt-2 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
                >
                  {copied ? "✓ Copié!" : "📋 Copier l'adresse"}
                </button>
                <p className="text-xs text-slate-500 mt-2 text-center">
                  ⚠️ Envoyez uniquement du USDT sur le réseau TRC20
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-slate-400 text-xs mb-1.5">
                  Hash de Transaction (TX Hash)
                </label>
                <input
                  type="text"
                  value={txHash}
                  onChange={(e) => setTxHash(e.target.value)}
                  placeholder="ex: 0x1a2b3c4d5e6f..."
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 text-sm font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-400 text-xs mb-1.5">
                  Preuve de paiement (image)
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setProofFile(file);
                      const reader = new FileReader();
                      reader.onloadend = () => setProofPreview(reader.result as string);
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-cyan-500/20 file:text-cyan-400"
                />
                {proofPreview && (
                  <div className="mt-2 relative">
                    <img src={proofPreview} alt="Preview" className="max-h-32 rounded-lg border border-slate-700" />
                    <button
                      type="button"
                      onClick={() => { setProofFile(null); setProofPreview(null); }}
                      className="absolute top-1 right-1 bg-red-500/80 hover:bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center"
                    >
                      ×
                    </button>
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">
                  JPG, PNG ou WebP · Max 5MB
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !selectedPlan}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-all text-sm"
              >
                {loading ? "Envoi en cours..." :
                 !selectedPlan ? "Sélectionnez un plan" :
                 `Soumettre le paiement · $${selectedPlan.price} USDT`}
              </button>

              <p className="text-xs text-slate-500 text-center">
                Activation sous 24h après vérification admin
              </p>
            </form>
          </div>
        </div>

        {/* Payment History */}
        {payments.length > 0 && (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 font-semibold text-white">
              Historique des Paiements
            </div>
            <div className="divide-y divide-slate-800">
              {payments.map((payment) => (
                <div key={payment.id} className="p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      ${parseFloat(payment.amount).toFixed(2)} USDT · {payment.planMonths} mois
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {new Date(payment.createdAt).toLocaleString("fr-FR")}
                    </div>
                    {payment.txHash && (
                      <div className="text-xs text-slate-500 font-mono mt-0.5 truncate max-w-xs">
                        TX: {payment.txHash}
                      </div>
                    )}
                    {payment.proofFilePath && (
                      <a
                        href={`/api/payment/proof/${payment.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 hover:text-cyan-300 mt-0.5 inline-block"
                      >
                        📷 Voir la preuve
                      </a>
                    )}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusColors[payment.status]}`}>
                    {payment.status === "PENDING" ? "⏳ EN ATTENTE" :
                     payment.status === "APPROVED" ? "✓ APPROUVÉ" :
                     "✗ REJETÉ"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
