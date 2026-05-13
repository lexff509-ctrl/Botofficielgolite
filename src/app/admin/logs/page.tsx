"use client";

import { useEffect, useState, useCallback } from "react";
import AdminLayout from "@/components/AdminLayout";

interface SystemLog {
  id: number;
  level: string;
  source: string;
  message: string;
  details: string | null;
  createdAt: string;
}

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [filterLevel, setFilterLevel] = useState("ALL");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/logs");
      const data = await res.json();
      if (data.logs) {
        setLogs(data.logs);
      }
    } catch (e) {
      console.error("Failed to fetch logs", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs();
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const handleClearLogs = async () => {
    if (!confirm("Voulez-vous vraiment effacer tous les logs système ?")) return;
    setClearing(true);
    try {
      const res = await fetch("/api/admin/logs", { method: "DELETE" });
      if (res.ok) {
        setLogs([]);
      }
    } catch (e) {
      console.error("Failed to clear logs", e);
    }
    setClearing(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert("Log copié dans le presse-papier !");
  };

  const filteredLogs = logs.filter((log) => filterLevel === "ALL" || log.level === filterLevel);

  const getLevelColor = (level: string) => {
    switch (level) {
      case "ERROR": return "bg-red-500/20 text-red-400 border-red-500/30";
      case "WARN": return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "INFO": return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default: return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-black text-white">
              Logs <span className="gradient-text">Système</span>
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Trace complète des erreurs et événements du bot
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={fetchLogs}
              disabled={loading}
              className="bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold px-4 py-2 rounded-xl text-sm transition-all"
            >
              {loading ? "..." : "Actualiser"}
            </button>
            <button
              onClick={handleClearLogs}
              disabled={clearing || logs.length === 0}
              className="bg-red-500/10 border border-red-500/30 hover:bg-red-500/20 text-red-400 font-bold px-4 py-2 rounded-xl text-sm transition-all disabled:opacity-50"
            >
              Effacer tout
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          {["ALL", "ERROR", "WARN", "INFO"].map((f) => (
            <button
              key={f}
              onClick={() => setFilterLevel(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                filterLevel === f
                  ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Logs List */}
        <div className="glass-card rounded-xl overflow-hidden border border-slate-800">
          {loading && logs.length === 0 ? (
            <div className="p-12 text-center text-slate-500">Chargement...</div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center text-slate-500">
              <div className="text-4xl mb-3">✅</div>
              Aucun log trouvé
            </div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {filteredLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-white/5 transition-colors">
                  <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold border ${getLevelColor(log.level)}`}>
                          {log.level}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          {new Date(log.createdAt).toLocaleString("fr-FR")}
                        </span>
                        <span className="text-xs font-bold text-cyan-400 bg-cyan-400/10 px-2 py-0.5 rounded">
                          {log.source}
                        </span>
                      </div>
                      <div className="text-white text-sm font-medium">
                        {log.message}
                      </div>
                      {log.details && (
                        <pre className="bg-black/30 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                          {log.details}
                        </pre>
                      )}
                    </div>
                    <div className="shrink-0">
                      <button
                        onClick={() => copyToClipboard(`[${log.level}] [${log.source}] ${log.message}\n${log.details || ""}`)}
                        className="text-xs bg-white/5 hover:bg-white/10 border border-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-all flex items-center gap-2"
                      >
                        📋 Copier
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
