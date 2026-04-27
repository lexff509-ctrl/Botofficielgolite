"use client";

import { useEffect, useState, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";

interface Payment {
  id: number;
  userId: number;
  amount: string;
  currency: string;
  txHash: string;
  status: string;
  planMonths: number;
  adminNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  userEmail: string;
  username: string;
}

export default function AdminPaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/payments");
      const data = await res.json();
      if (data.payments) setPayments(data.payments);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const handleReview = async (paymentId: number, status: "APPROVED" | "REJECTED") => {
    setReviewing(paymentId);
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/payments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId, status, note: reviewNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur lors de la verification");
      } else {
        setSuccess(status === "APPROVED" ? "Paiement approuve! Abonnement active." : "Paiement rejete.");
        setReviewNote("");
        fetchPayments();
      }
    } catch {
      setError("Erreur de connexion");
    }
    setReviewing(null);
  };

  const pendingPayments = payments.filter((p) => p.status === "PENDING");
  const reviewedPayments = payments.filter((p) => p.status !== "PENDING");

  const statusColors: Record<string, string> = {
    PENDING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    APPROVED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Gestion des <span className="gradient-text">Paiements</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">Verifier et approuver les paiements USDT TRC20</p>
        </div>

        {error && <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>}
        {success && <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm">{success}</div>}

        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 font-semibold text-white">
            Paiements en Attente ({pendingPayments.length})
          </div>
          {loading ? (
            <div className="p-12 text-center"><div className="animate-spin w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full mx-auto" /></div>
          ) : pendingPayments.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div className="text-4xl mb-3">✅</div>Aucun paiement en attente
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {pendingPayments.map((payment) => (
                <div key={payment.id} className="p-5">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-white">${parseFloat(payment.amount).toFixed(2)} USDT</span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">EN ATTENTE</span>
                      </div>
                      <div className="text-sm text-slate-400"><span className="text-white font-medium">{payment.username}</span> ({payment.userEmail})</div>
                      <div className="text-xs text-slate-500 font-mono">TX: {payment.txHash}</div>
                      <div className="text-xs text-slate-500">Plan: {payment.planMonths} mois · {new Date(payment.createdAt).toLocaleString("fr-FR")}</div>
                    </div>
                    <div className="flex flex-col gap-2 md:items-end">
                      <input type="text" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Note admin (optionnel)..." className="bg-white/5 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs w-full md:w-64 placeholder-slate-500 focus:outline-none focus:border-cyan-500" />
                      <div className="flex gap-2">
                        <button onClick={() => handleReview(payment.id, "APPROVED")} disabled={reviewing === payment.id} className="bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-400 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">Approuver</button>
                        <button onClick={() => handleReview(payment.id, "REJECTED")} disabled={reviewing === payment.id} className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50">Rejeter</button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {reviewedPayments.length > 0 && (
          <div className="glass-card rounded-xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 font-semibold text-white">Historique des Paiements</div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    {["Utilisateur", "Montant", "Plan", "Statut", "Note", "Date"].map((h) => (
                      <th key={h} className="text-left text-xs text-slate-400 px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reviewedPayments.map((payment) => (
                    <tr key={payment.id} className="border-b border-slate-800/50 hover:bg-white/5">
                      <td className="px-4 py-3"><div className="text-sm text-white font-medium">{payment.username}</div><div className="text-xs text-slate-500">{payment.userEmail}</div></td>
                      <td className="px-4 py-3 text-sm text-white font-mono">${parseFloat(payment.amount).toFixed(2)}</td>
                      <td className="px-4 py-3 text-xs text-slate-300">{payment.planMonths} mois</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-bold border ${statusColors[payment.status]}`}>{payment.status === "APPROVED" ? "APPROUVE" : "REJETE"}</span></td>
                      <td className="px-4 py-3 text-xs text-slate-400">{payment.adminNote || "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-400">{payment.reviewedAt ? new Date(payment.reviewedAt).toLocaleDateString("fr-FR") : new Date(payment.createdAt).toLocaleDateString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
