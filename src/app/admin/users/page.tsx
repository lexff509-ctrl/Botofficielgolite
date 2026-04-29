"use client";

import { useEffect, useState, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";

interface User {
  id: number;
  email: string;
  username: string;
  role: string;
  subscriptionStatus: string;
  subscriptionExpiresAt: string | null;
  isActive: boolean;
  isVerified: boolean;
  tradeMode: string;
  demoBalance: string | null;
  ssidStatus?: string;
  createdAt: string;
}

interface EditForm {
  isActive: boolean;
  isVerified: boolean;
  subscriptionStatus: string;
  subscriptionExpiresAt: string;
  tradeMode: string;
  demoBalance: string;
  resetPassword: string;
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    isActive: true,
    isVerified: false,
    subscriptionStatus: "FREE",
    subscriptionExpiresAt: "",
    tradeMode: "DEMO",
    demoBalance: "10000.00",
    resetPassword: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users");
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setEditForm({
      isActive: user.isActive,
      isVerified: user.isVerified,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionExpiresAt: user.subscriptionExpiresAt
        ? new Date(user.subscriptionExpiresAt).toISOString().split("T")[0]
        : "",
      tradeMode: user.tradeMode,
      demoBalance: user.demoBalance || "10000.00",
      resetPassword: "",
    });
    setError("");
    setSuccess("");
  };

  const handleSave = async () => {
    if (!editingUser) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const body: Record<string, unknown> = {
        isActive: editForm.isActive,
        isVerified: editForm.isVerified,
        subscriptionStatus: editForm.subscriptionStatus,
        tradeMode: editForm.tradeMode,
        demoBalance: editForm.demoBalance,
      };
      if (editForm.subscriptionExpiresAt) {
        body.subscriptionExpiresAt = new Date(editForm.subscriptionExpiresAt).toISOString();
      }
      if (editForm.resetPassword) {
        body.resetPassword = editForm.resetPassword;
      }

      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Erreur de mise à jour");
      } else {
        setSuccess("Utilisateur mis à jour avec succès!");
        setEditingUser(null);
        fetchUsers();
      }
    } catch {
      setError("Erreur de connexion");
    }
    setSaving(false);
  };

  const handleQuickAction = async (userId: number, action: string) => {
    setError("");
    setSuccess("");
    try {
      let body: Record<string, unknown> = {};
      let method = "PUT";

      switch (action) {
        case "verify":
          body = { isVerified: true };
          break;
        case "block":
          if (!confirm("Bloquer ce compte?")) return;
          body = { isActive: false };
          break;
        case "unblock":
          body = { isActive: true };
          break;
        case "disable":
          if (!confirm("Désactiver ce compte?")) return;
          method = "DELETE";
          break;
        default:
          return;
      }

      const res = await fetch(`/api/admin/users/${userId}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const msg = action === "verify" ? "Utilisateur vérifié" :
                    action === "block" ? "Compte bloqué" :
                    action === "unblock" ? "Compte débloqué" : "Compte désactivé";
        setSuccess(msg);
        fetchUsers();
      } else {
        const data = await res.json();
        setError(data.error || "Erreur");
      }
    } catch {
      setError("Erreur de connexion");
    }
  };

  const statusColors: Record<string, string> = {
    FREE: "bg-slate-500/20 text-slate-400",
    TRIAL: "bg-blue-500/20 text-blue-400",
    ACTIVE: "bg-emerald-500/20 text-emerald-400",
    EXPIRED: "bg-red-500/20 text-red-400",
    PENDING_PAYMENT: "bg-yellow-500/20 text-yellow-400",
  };

  const ssidStatusConfig: Record<string, { label: string; color: string }> = {
    VALID: { label: "Valide", color: "bg-emerald-500/20 text-emerald-400" },
    EXPIRED: { label: "Expiré", color: "bg-red-500/20 text-red-400" },
    UNKNOWN: { label: "Inconnu", color: "bg-yellow-500/20 text-yellow-400" },
    NOT_SET: { label: "Non configuré", color: "bg-slate-500/20 text-slate-400" },
  };

  const [searchId, setSearchId] = useState("");
  const [foundUser, setFoundUser] = useState<User | null>(null);
  const [searching, setSearching] = useState(false);

  const searchUser = async () => {
    if (!searchId) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users/${searchId}`);
      const data = await res.json();
      if (res.ok && data.user) {
        setFoundUser(data.user);
        setError("");
      } else {
        setError("Utilisateur introuvable");
        setFoundUser(null);
      }
    } catch {
      setError("Erreur de recherche");
      setFoundUser(null);
    }
    setSearching(false);
  };

  const displayUsers = foundUser ? [foundUser] : users;

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white">
            Gestion des <span className="gradient-text">Utilisateurs</span>
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Vérifier, bloquer, débloquer et gérer les comptes utilisateurs
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-red-400 text-sm">{error}</div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm">{success}</div>
        )}

        {/* Search by ID */}
        <div className="glass-card rounded-xl p-5">
          <div className="text-slate-400 text-xs font-medium mb-3">RECHERCHER PAR ID</div>
          <div className="flex gap-3">
            <input
              type="number"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              placeholder="ID utilisateur..."
              className="flex-1 bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={searchUser}
              disabled={searching}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold px-6 py-2.5 rounded-xl text-sm disabled:opacity-50"
            >
              {searching ? "..." : "Rechercher"}
            </button>
            {foundUser && (
              <button
                onClick={() => { setFoundUser(null); setSearchId(""); }}
                className="bg-white/5 border border-slate-700 text-slate-400 px-4 py-2.5 rounded-xl text-sm hover:text-white"
              >
                Effacer
              </button>
            )}
          </div>
        </div>

        {/* User List / Search Result */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-slate-800 font-semibold text-white flex items-center justify-between">
            <span>{foundUser ? "Résultat de recherche" : `Utilisateurs (${users.length})`}</span>
          </div>
          {loading ? (
            <div className="p-12 text-center text-slate-500">Chargement...</div>
          ) : displayUsers.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div className="text-4xl mb-3">👥</div>
              Recherchez un utilisateur par son ID pour le modifier
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-800">
                    {["ID", "Email", "Pseudo", "Rôle", "Abonnement", "Vérifié", "Actif", "Actions"].map((h) => (
                      <th key={h} className="text-left text-xs text-slate-400 px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayUsers.map((user) => (
                    <tr key={user.id} className="border-b border-slate-800/50 hover:bg-white/5">
                      <td className="px-4 py-3 text-sm text-slate-400">{user.id}</td>
                      <td className="px-4 py-3 text-sm text-white">{user.email}</td>
                      <td className="px-4 py-3 text-sm text-white">{user.username}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                          user.role === "ADMIN" ? "bg-violet-500/20 text-violet-400" : "bg-slate-500/20 text-slate-400"
                        }`}>
                          {user.role}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${statusColors[user.subscriptionStatus] || "bg-slate-500/20 text-slate-400"}`}>
                          {user.subscriptionStatus}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${user.isVerified ? "bg-emerald-500/20 text-emerald-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                          {user.isVerified ? "Vérifié" : "Non vérifié"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`w-2 h-2 rounded-full inline-block ${user.isActive ? "bg-emerald-400" : "bg-red-400"}`} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          <button
                            onClick={() => handleEdit(user)}
                            className="text-xs bg-cyan-500/10 text-cyan-400 px-2.5 py-1.5 rounded-lg hover:bg-cyan-500/20"
                          >
                            Modifier
                          </button>
                          {!user.isVerified && (
                            <button
                              onClick={() => handleQuickAction(user.id, "verify")}
                              className="text-xs bg-emerald-500/10 text-emerald-400 px-2.5 py-1.5 rounded-lg hover:bg-emerald-500/20"
                            >
                              Vérifier
                            </button>
                          )}
                          {user.isActive && user.role !== "ADMIN" && (
                            <button
                              onClick={() => handleQuickAction(user.id, "block")}
                              className="text-xs bg-red-500/10 text-red-400 px-2.5 py-1.5 rounded-lg hover:bg-red-500/20"
                            >
                              Bloquer
                            </button>
                          )}
                          {!user.isActive && user.role !== "ADMIN" && (
                            <button
                              onClick={() => handleQuickAction(user.id, "unblock")}
                              className="text-xs bg-blue-500/10 text-blue-400 px-2.5 py-1.5 rounded-lg hover:bg-blue-500/20"
                            >
                              Débloquer
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Edit Modal */}
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/80" onClick={() => setEditingUser(null)} />
            <div className="relative glass-card rounded-2xl p-6 w-full max-w-md border border-slate-700 max-h-[90vh] overflow-y-auto">
              <h3 className="font-black text-white text-lg mb-1">
                Modifier l&apos;utilisateur #{editingUser.id}
              </h3>
              <p className="text-slate-400 text-sm mb-5">{editingUser.email}</p>

              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="editIsActive"
                    checked={editForm.isActive}
                    onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })}
                    className="rounded border-slate-700"
                  />
                  <label htmlFor="editIsActive" className="text-sm text-white">Compte actif</label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="editIsVerified"
                    checked={editForm.isVerified}
                    onChange={(e) => setEditForm({ ...editForm, isVerified: e.target.checked })}
                    className="rounded border-slate-700"
                  />
                  <label htmlFor="editIsVerified" className="text-sm text-white">Utilisateur vérifié</label>
                </div>

                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Statut de l&apos;abonnement</label>
                  <select
                    value={editForm.subscriptionStatus}
                    onChange={(e) => setEditForm({ ...editForm, subscriptionStatus: e.target.value })}
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  >
                    {["FREE", "TRIAL", "ACTIVE", "EXPIRED", "PENDING_PAYMENT"].map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Date d&apos;expiration</label>
                  <input
                    type="date"
                    value={editForm.subscriptionExpiresAt}
                    onChange={(e) => setEditForm({ ...editForm, subscriptionExpiresAt: e.target.value })}
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Mode de Trading</label>
                  <select
                    value={editForm.tradeMode}
                    onChange={(e) => setEditForm({ ...editForm, tradeMode: e.target.value })}
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                  >
                    <option value="DEMO">DEMO</option>
                    <option value="LIVE">LIVE</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Solde Démo</label>
                  <input
                    type="text"
                    value={editForm.demoBalance}
                    onChange={(e) => setEditForm({ ...editForm, demoBalance: e.target.value })}
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 text-xs mb-1.5">Réinitialiser le mot de passe</label>
                  <input
                    type="password"
                    value={editForm.resetPassword}
                    onChange={(e) => setEditForm({ ...editForm, resetPassword: e.target.value })}
                    placeholder="Nouveau mot de passe (min 6 car.)"
                    className="w-full bg-white/5 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 text-sm"
                  />
                  <p className="text-xs text-slate-500 mt-1">Laissez vide pour ne pas changer</p>
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm"
                >
                  Annuler
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white font-bold text-sm disabled:opacity-50"
                >
                  {saving ? "Sauvegarde..." : "Sauvegarder"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
