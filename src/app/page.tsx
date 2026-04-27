"use client";

import { useState } from "react";
import AuthModal from "@/components/AuthModal";

export default function HomePage() {
  const [showAuth, setShowAuth] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");

  const openLogin = () => {
    setAuthTab("login");
    setShowAuth(true);
  };

  const openRegister = () => {
    setAuthTab("register");
    setShowAuth(true);
  };

  return (
    <div className="min-h-screen bg-[#020617] text-white overflow-x-hidden">
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#020617]/90 backdrop-blur-md border-b border-[#1e293b]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center font-bold text-sm">
                G
              </div>
              <span className="text-xl font-bold gradient-text">
                GoliteCommunity
              </span>
            </div>
            <div className="hidden md:flex items-center gap-8">
              <a href="#features" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm">
                Fonctionnalités
              </a>
              <a href="#pricing" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm">
                Tarifs
              </a>
              <a href="#how-it-works" className="text-slate-400 hover:text-cyan-400 transition-colors text-sm">
                Comment ça marche
              </a>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={openLogin}
                className="text-slate-300 hover:text-white transition-colors text-sm font-medium px-4 py-2"
              >
                Connexion
              </button>
              <button
                onClick={openRegister}
                className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-all duration-200 shadow-lg shadow-cyan-500/20"
              >
                Essai Gratuit 3j
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center justify-center pt-16 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-gradient-radial from-cyan-500/5 to-transparent rounded-full" />
          {/* Grid */}
          <div
            className="absolute inset-0 opacity-10"
            style={{
              backgroundImage: `linear-gradient(rgba(0,212,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.1) 1px, transparent 1px)`,
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-full px-4 py-2 text-cyan-400 text-sm font-medium mb-8">
            <span className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
            Bot Trading PocketOption • Version 2.0
          </div>

          <h1 className="text-5xl md:text-7xl font-black mb-6 leading-tight">
            <span className="text-white">Trading</span>{" "}
            <span className="gradient-text">Algorithmique</span>
            <br />
            <span className="text-white">Pour Options Binaires</span>
          </h1>

          <p className="text-xl text-slate-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            Plateforme SaaS professionnelle avec bot signal + bot automatique pour PocketOption.
            Analyse multi-timeframe, backtesting avancé, mode démo et live.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <button
              onClick={openRegister}
              className="w-full sm:w-auto bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all duration-200 shadow-2xl shadow-cyan-500/30 animate-pulse-glow"
            >
              🚀 Démarrer l'Essai Gratuit 3 Jours
            </button>
            <button
              onClick={openLogin}
              className="w-full sm:w-auto bg-white/5 hover:bg-white/10 border border-white/10 hover:border-cyan-500/50 text-white font-bold px-8 py-4 rounded-xl text-lg transition-all duration-200"
            >
              Se Connecter →
            </button>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto">
            {[
              { value: "62-68%", label: "Taux de Réussite" },
              { value: "7", label: "Timeframes Analysés" },
              { value: "2", label: "Modes Bot" },
              { value: "24/7", label: "Trading Automatique" },
            ].map((stat) => (
              <div
                key={stat.label}
                className="glass-card rounded-xl p-4 text-center"
              >
                <div className="text-2xl font-black text-cyan-400">
                  {stat.value}
                </div>
                <div className="text-xs text-slate-400 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bot Types Section */}
      <section id="features" className="py-24 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">
              <span className="gradient-text">2 Modes de Bot</span> Puissants
            </h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">
              Choisissez entre le bot signal pour trader manuellement ou le bot automatique pour laisser l'IA trader pour vous.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Bot Signal */}
            <div className="glass-card rounded-2xl p-8 border border-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300 group">
              <div className="w-14 h-14 bg-cyan-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-cyan-500/20 transition-colors">
                <span className="text-3xl">📊</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">
                Bot Signal
              </h3>
              <p className="text-slate-400 mb-6">
                Recevez des signaux CALL/PUT en temps réel générés par l'analyse technique avancée. Vous gardez le contrôle total de vos trades.
              </p>
              <ul className="space-y-3">
                {[
                  "Analyse RSI, MACD, EMA, Bollinger Bands",
                  "Confirmation multi-timeframe (5s à 5min)",
                  "Score de confiance par signal",
                  "Alertes en temps réel",
                  "Historique des signaux",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="text-cyan-400 font-bold">✓</span> {f}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex items-center gap-2">
                <span className="badge-call px-3 py-1 rounded-full text-xs font-bold">CALL ▲</span>
                <span className="badge-put px-3 py-1 rounded-full text-xs font-bold">PUT ▼</span>
                <span className="text-slate-500 text-xs ml-auto">Signaux temps réel</span>
              </div>
            </div>

            {/* Bot Automatique */}
            <div className="glass-card rounded-2xl p-8 border border-violet-500/20 hover:border-violet-500/50 transition-all duration-300 group">
              <div className="w-14 h-14 bg-violet-500/10 rounded-xl flex items-center justify-center mb-6 group-hover:bg-violet-500/20 transition-colors">
                <span className="text-3xl">🤖</span>
              </div>
              <h3 className="text-2xl font-bold text-white mb-3">
                Bot Automatique
              </h3>
              <p className="text-slate-400 mb-6">
                Connectez votre SSID PocketOption et laissez le bot trader automatiquement selon la stratégie éprouvée 24h/24.
              </p>
              <ul className="space-y-3">
                {[
                  "Connexion SSID PocketOption personnelle",
                  "Trading automatique 24/7",
                  "Gestion automatique du risque",
                  "Mode Démo pour tester sans risque",
                  "Mode Live pour trading réel",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm text-slate-300">
                    <span className="text-violet-400 font-bold">✓</span> {f}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex items-center gap-3">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
                  Votre SSID PocketOption
                </div>
                <span className="text-slate-600 text-xs ml-auto">Isolation complète</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-24 bg-[#0a0f1e]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">
              Comment ça <span className="gradient-text">Fonctionne</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {[
              {
                step: "01",
                icon: "📝",
                title: "Créez votre compte",
                desc: "Inscription gratuite avec 3 jours d'essai. Paiement USDT TRC20 requis ensuite.",
              },
              {
                step: "02",
                icon: "🔌",
                title: "Connectez votre SSID",
                desc: "Entrez votre SSID PocketOption dans votre profil pour le bot automatique.",
              },
              {
                step: "03",
                icon: "⚙️",
                title: "Choisissez votre mode",
                desc: "Mode Démo pour tester, Mode Live pour trader avec votre capital réel.",
              },
              {
                step: "04",
                icon: "📈",
                title: "Profitez des résultats",
                desc: "Suivez vos performances en temps réel avec le dashboard analytique.",
              },
            ].map((item) => (
              <div key={item.step} className="relative text-center group">
                <div className="glass-card rounded-2xl p-6 hover:border-cyan-500/30 transition-all">
                  <div className="text-xs font-bold text-cyan-400 mb-3">{item.step}</div>
                  <div className="text-4xl mb-4">{item.icon}</div>
                  <h3 className="font-bold text-white mb-2">{item.title}</h3>
                  <p className="text-slate-400 text-sm">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Timeframes */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">
              Analyse <span className="gradient-text">Multi-Timeframe</span>
            </h2>
            <p className="text-slate-400">
              Confirmation sur 7 timeframes pour des signaux ultra-précis
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-4">
            {[
              { tf: "5s", label: "5 Secondes", color: "cyan" },
              { tf: "10s", label: "10 Secondes", color: "blue" },
              { tf: "15s", label: "15 Secondes", color: "indigo" },
              { tf: "30s", label: "30 Secondes", color: "violet" },
              { tf: "1m", label: "1 Minute", color: "purple" },
              { tf: "3m", label: "3 Minutes", color: "fuchsia" },
              { tf: "5m", label: "5 Minutes", color: "pink" },
            ].map((item) => (
              <div
                key={item.tf}
                className="glass-card rounded-xl px-6 py-4 text-center min-w-[120px] hover:border-cyan-500/50 transition-all group cursor-default"
              >
                <div className="text-2xl font-black text-cyan-400 group-hover:scale-110 transition-transform">
                  {item.tf}
                </div>
                <div className="text-xs text-slate-400 mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 bg-[#0a0f1e]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">
              Tarifs <span className="gradient-text">Transparents</span>
            </h2>
            <p className="text-slate-400">Paiement en USDT TRC20. Pas de frais cachés.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 max-w-5xl mx-auto">
            {[
              {
                title: "Essai Gratuit",
                price: "0",
                period: "3 jours",
                features: ["Bot Signal", "Mode Démo", "5 Signaux/jour", "Dashboard basique"],
                cta: "Commencer",
                featured: false,
                badge: "TRIAL",
              },
              {
                title: "1 Mois",
                price: "50",
                period: "USDT/mois",
                features: ["Bot Signal + Auto", "Mode Live", "Signaux illimités", "Dashboard complet", "Backtesting"],
                cta: "Choisir",
                featured: false,
                badge: null,
              },
              {
                title: "3 Mois",
                price: "280",
                period: "USDT (Économisez 20$)",
                features: ["Tout du plan 1 mois", "Priorité support", "Analyses avancées"],
                cta: "Meilleur rapport",
                featured: true,
                badge: "POPULAIRE",
              },
              {
                title: "1 An",
                price: "1250",
                period: "USDT (Économisez 350$)",
                features: ["Tout inclus", "Backtesting illimité", "Support prioritaire"],
                cta: "Économisez max",
                featured: false,
                badge: null,
              },
            ].map((plan) => (
              <div
                key={plan.title}
                className={`glass-card rounded-2xl p-6 relative ${
                  plan.featured
                    ? "border-cyan-500/50 shadow-2xl shadow-cyan-500/20"
                    : "border-slate-700/50"
                }`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-cyan-500 to-violet-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    {plan.badge}
                  </div>
                )}
                <h3 className="font-bold text-white text-lg mb-2">{plan.title}</h3>
                <div className="mb-1">
                  <span className="text-3xl font-black text-cyan-400">
                    ${plan.price}
                  </span>
                </div>
                <p className="text-slate-500 text-xs mb-6">{plan.period}</p>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-xs text-slate-300">
                      <span className="text-emerald-400">✓</span> {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={openRegister}
                  className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all ${
                    plan.featured
                      ? "bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white"
                      : "bg-white/5 hover:bg-white/10 border border-white/10 text-white"
                  }`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
          <div className="text-center mt-8 text-slate-500 text-sm">
            💳 Paiement manuel via wallet USDT TRC20 · Activation après vérification admin
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-black mb-4">
              Tout ce dont vous avez <span className="gradient-text">besoin</span>
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: "🔐",
                title: "Sécurité Maximale",
                desc: "JWT + bcrypt + isolation complète des sessions. Votre SSID n'est jamais exposé.",
              },
              {
                icon: "📊",
                title: "Backtesting Avancé",
                desc: "Testez votre stratégie sur des données historiques avec capital fictif.",
              },
              {
                icon: "🎯",
                title: "Dashboard Analytique",
                desc: "Winrate, equity curve, ratio profit/perte et toutes vos stats en temps réel.",
              },
              {
                icon: "⚡",
                title: "Multi-Timeframe",
                desc: "Confirmation de signal sur 7 timeframes de 5 secondes à 5 minutes.",
              },
              {
                icon: "👨‍💼",
                title: "Panel Admin Complet",
                desc: "Gestion des abonnements, validation des paiements, stats globales.",
              },
              {
                icon: "🔄",
                title: "Mode Démo / Live",
                desc: "Basculez entre capital fictif et trading réel en un seul clic.",
              },
            ].map((feat) => (
              <div
                key={feat.title}
                className="glass-card rounded-xl p-6 hover:border-cyan-500/30 transition-all group"
              >
                <div className="text-3xl mb-4">{feat.icon}</div>
                <h3 className="font-bold text-white mb-2">{feat.title}</h3>
                <p className="text-slate-400 text-sm">{feat.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-[#0a0f1e]">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="glass-card rounded-3xl p-12 border border-cyan-500/20">
            <h2 className="text-4xl font-black mb-4">
              Prêt à <span className="gradient-text">commencer</span> ?
            </h2>
            <p className="text-slate-400 mb-8 text-lg">
              Rejoignez la communauté GoliteCommunity et commencez à trader intelligemment dès aujourd'hui.
            </p>
            <button
              onClick={openRegister}
              className="bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500 text-white font-bold px-10 py-4 rounded-xl text-lg transition-all duration-200 shadow-2xl shadow-cyan-500/30"
            >
              🚀 Essai Gratuit 3 Jours — Paiement USDT ensuite
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#1e293b] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-gradient-to-br from-cyan-400 to-violet-600 flex items-center justify-center text-xs font-bold">
                G
              </div>
              <span className="font-bold text-slate-300">GoliteCommunity</span>
            </div>
            <p className="text-slate-500 text-sm">
              ⚠️ Le trading d'options binaires comporte des risques. Ne tradez qu'avec ce que vous pouvez vous permettre de perdre.
            </p>
          </div>
        </div>
      </footer>

      {/* Auth Modal */}
      {showAuth && (
        <AuthModal
          defaultTab={authTab}
          onClose={() => setShowAuth(false)}
        />
      )}
    </div>
  );
}
