"use client";

import { useEffect, useState, useCallback } from "react";
import DashboardLayout from "@/components/DashboardLayout";

interface Plan {
  months: number;
  price: number;
  label: string;
  savings?: string;
  priceHTG?: number;
}

interface PaymentInfo {
  plans: Plan[];
  currency: string;
  moncashPlans?: Record<string, { months: number; priceHTG: number; label: string; savings?: string }>;
  moncashInfo?: { phone: string; validationName: string; htgRate: number };
  zelleInfo?: { phone: string; name: string };
}

interface Payment {
  id: number;
  amount: string;
  currency: string;
  txHash: string;
  proofFilePath: string | null;
  status: string;
  planMonths: number;
  moncashSenderPhone?: string;
  moncashValidationName?: string;
  createdAt: string;
}

interface UserProfile {
  subscriptionStatus: string;
  subscriptionExpiresAt?: string;
}

const HTG_RATE = 137.5;

export default function PaymentPage() {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [payments, setPayments] = useState<Payment[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"USDT" | "MONCASH" | "ZELLE">("USDT");
  const [txHash, setTxHash] = useState("");
  const [moncashSenderPhone, setMoncashSenderPhone] = useState("");
  const [moncashValidationName, setMoncashValidationName] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [promoCode, setPromoCode] = useState("");
  const [discountPercent, setDiscountPercent] = useState<number>(0);
  const [promoMessage, setPromoMessage] = useState("");

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
        const plans = plansToArray(paymentsData.plans);
        // Enrich plans with HTG prices
        const enrichedPlans = plans.map((p) => ({
          ...p,
          priceHTG: Math.round(p.price * HTG_RATE),
        }));
        setPaymentInfo({
          plans: enrichedPlans,
          currency: paymentsData.currency,
          moncashPlans: paymentsData.moncashPlans,
          moncashInfo: paymentsData.moncashInfo,
          zelleInfo: paymentsData.zelleInfo,
        });
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

  const copyMoncashPhone = () => {
    navigator.clipboard.writeText("+50931959375");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleValidatePromo = async () => {
    if (!promoCode) return;
    setPromoMessage("");
    try {
      const res = await fetch("/api/payment/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: promoCode }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setDiscountPercent(data.discountPercent);
        setPromoMessage(`Code valide ! -${data.discountPercent}% appliqués.`);
      } else {
        setDiscountPercent(0);
        setPromoMessage(data.error || "Code invalide");
      }
    } catch {
      setPromoMessage("Erreur de connexion");
      setDiscountPercent(0);
    }
  };

  const getDiscountedPrice = (price: number) => {
    if (discountPercent >= 100) return 0;
    return price * (1 - discountPercent / 100);
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

      const body: Record<string, unknown> = {
        amount: getDiscountedPrice(selectedPlan.price),
        planMonths: selectedPlan.months,
        currency: paymentMethod,
      };

      if (promoCode && discountPercent > 0) {
        body.promoCode = promoCode;
      }

      if (discountPercent >= 100) {
        body.txHash = "PROMO_CODE_100%";
      } else if (paymentMethod === "USDT") {
        body.txHash = txHash;
        body.proofFilePath = proofFilePath;
      } else if (paymentMethod === "ZELLE") {
        body.txHash = "";
        body.proofFilePath = proofFilePath;
      } else {
        body.moncashSenderPhone = moncashSenderPhone;
        body.moncashValidationName = moncashValidationName || undefined;
        body.txHash = "";
        if (proofFilePath) body.proofFilePath = proofFilePath;
      }

      const res = await fetch("/api/payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la soumission");
      } else {
        setSuccess("Votre demande de paiement a ete soumise! L'admin va verifier sous 24h.");
        setTxHash("");
        setMoncashSenderPhone("");
        setMoncashValidationName("");
        setProofFile(null);
        setProofPreview(null);
        setSelectedPlan(null);
        setPromoCode("");
        setDiscountPercent(0);
        setPromoMessage("");
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
            Gestion de l&apos;<span className="gradient-text">Abonnement</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Paiement via USDT TRC20 ou MonCash
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
                  {subscriptionStatus === "ACTIVE" ? "ACTIF" :
                   subscriptionStatus === "TRIAL" ? "ESSAI GRATUIT (3 jours)" :
                   subscriptionStatus === "PENDING_PAYMENT" ? "PAIEMENT EN ATTENTE" :
                   "EXPIRE"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {subscriptionStatus === "PENDING_PAYMENT" && (
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
            <div className="font-semibold text-yellow-400 mb-1">
              Paiement en cours de verification
            </div>
            <p className="text-slate-400 text-sm">
              Votre paiement est en cours de verification par l&apos;administrateur. Vous recevrez votre acces sous 24 heures.
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

        {/* Payment Method Selection */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-4">METHODE DE PAIEMENT</div>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => { setPaymentMethod("USDT"); setSelectedPlan(null); }}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                paymentMethod === "USDT"
                  ? "border-cyan-500/70 bg-cyan-500/10"
                  : "border-slate-700 hover:border-slate-600"
              }`}
            >
              <div className="font-bold text-white">USDT TRC20</div>
              <div className="text-xs text-slate-400 mt-1">Crypto - USDT sur reseau TRC20</div>
            </button>
            <button
              onClick={() => { setPaymentMethod("MONCASH"); setSelectedPlan(null); }}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                paymentMethod === "MONCASH"
                  ? "border-amber-500/70 bg-amber-500/10"
                  : "border-slate-700 hover:border-slate-600"
              }`}
            >
              <div className="font-bold text-white">MonCash</div>
              <div className="text-xs text-slate-400 mt-1">Haiti - paiement en Gourdes (HTG)</div>
            </button>
            <button
              onClick={() => { setPaymentMethod("ZELLE"); setSelectedPlan(null); }}
              className={`p-4 rounded-xl border-2 text-left transition-all col-span-2 md:col-span-1 ${
                paymentMethod === "ZELLE"
                  ? "border-purple-500/70 bg-purple-500/10"
                  : "border-slate-700 hover:border-slate-600"
              }`}
            >
              <div className="font-bold text-white">Zelle</div>
              <div className="text-xs text-slate-400 mt-1">Paiement bancaire - USD</div>
            </button>
          </div>
        </div>

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
                    ? paymentMethod === "MONCASH"
                      ? "border-amber-500/70 bg-amber-500/10"
                      : paymentMethod === "ZELLE"
                      ? "border-purple-500/70 bg-purple-500/10"
                      : "border-cyan-500/70 bg-cyan-500/10"
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
                      Acces complet · Bot Signal + Auto
                    </div>
                  </div>
                  <div className="text-right">
                    {paymentMethod === "USDT" || paymentMethod === "ZELLE" ? (
                      <>
                        <div className={`text-xl font-black ${paymentMethod === "ZELLE" ? "text-purple-400" : "text-cyan-400"}`}>
                          {discountPercent > 0 ? (
                            <span className="line-through text-slate-500 text-sm mr-2">${plan.price}</span>
                          ) : null}
                          ${getDiscountedPrice(plan.price).toFixed(2)}
                        </div>
                        <div className="text-xs text-slate-400">{paymentMethod === "ZELLE" ? "Zelle USD" : "USDT TRC20"}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-xl font-black text-amber-400">
                          {discountPercent > 0 ? (
                            <span className="line-through text-slate-500 text-sm mr-2">{(plan.priceHTG || Math.round(plan.price * HTG_RATE)).toLocaleString()} G</span>
                          ) : null}
                          {getDiscountedPrice(plan.priceHTG || Math.round(plan.price * HTG_RATE)).toLocaleString()} G
                        </div>
                        <div className="text-xs text-slate-400">MonCash HTG</div>
                      </>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Payment Form */}
          <div>
            <div className="font-semibold text-white mb-4">Effectuer le paiement</div>

            {paymentMethod === "USDT" && walletAddress && (
              <div className="glass-card rounded-xl p-4 mb-4">
                <div className="text-xs text-slate-400 mb-1">WALLET USDT TRC20</div>
                <div className="font-mono text-xs text-cyan-400 break-all bg-white/5 rounded-lg p-3 border border-slate-700">
                  {walletAddress}
                </div>
                <button
                  onClick={copyWallet}
                  className="mt-2 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
                >
                  {copied ? "Copie!" : "Copier l&apos;adresse"}
                </button>
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Envoyez uniquement du USDT sur le reseau TRC20
                </p>
              </div>
            )}

            {paymentMethod === "MONCASH" && (
              <div className="glass-card rounded-xl p-4 mb-4">
                <div className="text-xs text-slate-400 mb-1">INFO MONCASH</div>
                <div className="space-y-2">
                  <div className="bg-white/5 rounded-lg p-3 border border-slate-700">
                    <div className="text-xs text-slate-400">Numero MonCash</div>
                    <div className="text-sm text-amber-400 font-bold font-mono">+509 31959375</div>
                    <button
                      onClick={copyMoncashPhone}
                      className="text-xs text-cyan-400 hover:text-cyan-300 mt-1"
                    >
                      Copier le numero
                    </button>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 border border-slate-700">
                    <div className="text-xs text-slate-400">Nom de validation</div>
                    <div className="text-sm text-white font-bold">renato joseph</div>
                  </div>
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
                    <div className="text-xs text-amber-400">
                      Envoyez le montant en Gourdes (HTG) au numero ci-dessus via MonCash, puis remplissez le formulaire.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {paymentMethod === "ZELLE" && paymentInfo?.zelleInfo && (
              <div className="glass-card rounded-xl p-4 mb-4">
                <div className="text-xs text-slate-400 mb-1">INFO ZELLE</div>
                <div className="space-y-2">
                  <div className="bg-white/5 rounded-lg p-3 border border-slate-700">
                    <div className="text-xs text-slate-400">Numero Zelle</div>
                    <div className="text-sm text-purple-400 font-bold font-mono">{paymentInfo.zelleInfo.phone}</div>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(paymentInfo.zelleInfo!.phone);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="text-xs text-cyan-400 hover:text-cyan-300 mt-1"
                    >
                      {copied ? "Copie!" : "Copier le numero"}
                    </button>
                  </div>
                  <div className="bg-white/5 rounded-lg p-3 border border-slate-700">
                    <div className="text-xs text-slate-400">Nom Zelle</div>
                    <div className="text-sm text-white font-bold">{paymentInfo.zelleInfo.name}</div>
                  </div>
                  <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3">
                    <div className="text-xs text-purple-400">
                      Envoyez le montant exact ($) au numero Zelle ci-dessus, puis uploadez obligatoirement la capture d'ecran comme preuve ci-dessous.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Promo Code Section */}
              <div className="bg-white/5 border border-slate-700 rounded-xl p-4">
                <label className="block text-slate-400 text-xs mb-1.5">
                  Code Promo (Optionnel)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    placeholder="ex: FREE100"
                    className="flex-1 bg-black/20 border border-slate-700 rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 text-sm uppercase"
                  />
                  <button
                    type="button"
                    onClick={handleValidatePromo}
                    disabled={!promoCode}
                    className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-4 py-2 rounded-lg text-sm font-bold transition-all disabled:opacity-50"
                  >
                    Valider
                  </button>
                </div>
                {promoMessage && (
                  <p className={`text-xs mt-2 font-medium ${discountPercent > 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {promoMessage}
                  </p>
                )}
              </div>

              {discountPercent < 100 && paymentMethod === "USDT" && (
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
              )}

              {discountPercent < 100 && paymentMethod === "MONCASH" && (
                <>
                  <div>
                    <label className="block text-slate-400 text-xs mb-1.5">
                      Votre numero de telephone MonCash
                    </label>
                    <input
                      type="tel"
                      value={moncashSenderPhone}
                      onChange={(e) => setMoncashSenderPhone(e.target.value)}
                      placeholder="+509 3XXX XXXX"
                      className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 text-sm font-mono"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Le numero depuis lequel vous avez envoye le MonCash
                    </p>
                  </div>
                  <div>
                    <label className="block text-slate-400 text-xs mb-1.5">
                      Nom sur le compte MonCash (optionnel)
                    </label>
                    <input
                      type="text"
                      value={moncashValidationName}
                      onChange={(e) => setMoncashValidationName(e.target.value)}
                      placeholder="Votre nom complet"
                      className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 text-sm"
                    />
                  </div>
                </>
              )}

              {discountPercent < 100 && (paymentMethod === "USDT" || paymentMethod === "ZELLE" || paymentMethod === "MONCASH") && (
                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">
                    {paymentMethod === "ZELLE" ? "Preuve de paiement Zelle (OBLIGATOIRE)" : "Preuve de paiement (image, optionnel)"}
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
                      x
                    </button>
                  </div>
                )}
                <p className="text-xs text-slate-500 mt-1">JPG, PNG ou WebP - Max 5MB</p>
              </div>
              )}

              <button
                type="submit"
                disabled={loading || !selectedPlan || (discountPercent < 100 && paymentMethod === "MONCASH" && !moncashSenderPhone) || (discountPercent < 100 && paymentMethod === "ZELLE" && !proofFile)}
                className={`w-full py-3 rounded-xl font-bold transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed text-white ${
                  paymentMethod === "MONCASH"
                    ? "bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500"
                    : paymentMethod === "ZELLE"
                    ? "bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-400 hover:to-pink-500"
                    : "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500"
                }`}
              >
                {loading ? "Envoi en cours..." :
                 !selectedPlan ? "Selectionnez un plan" :
                 (discountPercent < 100 && paymentMethod === "ZELLE" && !proofFile) ? "Uploadez une image" :
                 discountPercent >= 100 ? "Activer Gratuitement" :
                 paymentMethod === "USDT" || paymentMethod === "ZELLE"
                   ? `Soumettre · $${getDiscountedPrice(selectedPlan.price).toFixed(2)} USD${paymentMethod === "USDT" ? "T" : ""}`
                   : `Soumettre · ${getDiscountedPrice(selectedPlan.priceHTG || Math.round(selectedPlan.price * HTG_RATE)).toLocaleString()} G HTG`}
              </button>

              <p className="text-xs text-slate-500 text-center">
                Activation sous 24h apres verification admin
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
                      {payment.currency === "MONCASH"
                        ? `${parseFloat(payment.amount).toLocaleString()} G HTG`
                        : `$${parseFloat(payment.amount).toFixed(2)} USDT`}
                      {" "}&middot; {payment.planMonths} mois
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {payment.currency === "MONCASH" ? "MonCash" : payment.currency === "ZELLE" ? "Zelle" : "USDT TRC20"} &middot; {new Date(payment.createdAt).toLocaleString("fr-FR")}
                    </div>
                    {payment.txHash && payment.currency !== "MONCASH" && payment.currency !== "ZELLE" && (
                      <div className="text-xs text-slate-500 font-mono mt-0.5 truncate max-w-xs">
                        TX: {payment.txHash}
                      </div>
                    )}
                    {payment.moncashSenderPhone && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        MonCash: {payment.moncashSenderPhone}
                      </div>
                    )}
                    {payment.proofFilePath && (
                      <a
                        href={payment.proofFilePath.startsWith("http") ? payment.proofFilePath : `/api/payment/proof/${payment.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 hover:text-cyan-300 mt-0.5 inline-block"
                      >
                        Voir la preuve
                      </a>
                    )}
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${statusColors[payment.status]}`}>
                    {payment.status === "PENDING" ? "EN ATTENTE" :
                     payment.status === "APPROVED" ? "APPROUVE" :
                     "REJETE"}
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
