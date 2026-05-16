import { newsService, NewsEvent } from "@/services/news.service";

export interface NewsBias {
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  strength: number; // 0 to 100
  reason: string;
}

export class NewsAgent {
  /**
   * Analyse les événements économiques actuels et tente de prédire
   * la direction du marché en fonction du Forecast (Prévision) et du Previous (Précédent).
   */
  public static async analyze(asset: string): Promise<NewsBias> {
    const DEFAULT_NEUTRAL_RESULT: NewsBias = { sentiment: "NEUTRAL", strength: 0, reason: "News circuit breaker" };
    try {
      return await Promise.race([
        this._doAnalysis(asset),
        new Promise<NewsBias>((resolve) => setTimeout(() => resolve(DEFAULT_NEUTRAL_RESULT), 2000))
      ]);
    } catch (err) {
      return DEFAULT_NEUTRAL_RESULT;
    }
  }

  private static async _doAnalysis(asset: string): Promise<NewsBias> {
    if (asset.toUpperCase().includes("OTC")) {
      return { sentiment: "NEUTRAL", strength: 0, reason: "Marché OTC : Aucune influence macroéconomique." };
    }

    try {
      const news = await newsService.getHighImpactNews();
      if (!news || news.length === 0) {
        return { sentiment: "NEUTRAL", strength: 0, reason: "Aucune annonce économique majeure à venir." };
      }

      const currencies: string[] = asset.replace(/[^A-Z]/g, "").match(/.{1,3}/g) || [];
      if (currencies.length !== 2) return { sentiment: "NEUTRAL", strength: 0, reason: "Paire de devises invalide." };

      const baseCurrency = currencies[0]; // ex: EUR
      const quoteCurrency = currencies[1]; // ex: USD

      const now = new Date();
      const IMPACT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes avant et après l'annonce

      for (const event of news) {
        if (event.impact !== "High") continue;

        const isBase = event.country === baseCurrency;
        const isQuote = event.country === quoteCurrency;

        if (!isBase && !isQuote) continue;

        const eventDate = new Date(event.date);
        const diffMs = Math.abs(eventDate.getTime() - now.getTime());

        // Si on est dans la fenêtre de volatilité de l'annonce
        if (diffMs <= IMPACT_WINDOW_MS) {
          // Tentative d'analyse de la direction (Basique)
          let eventSentiment: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

          // Si on a les chiffres prévus vs précédents
          if (event.forecast && event.previous) {
            const forecastVal = parseFloat(event.forecast.replace(/[^\d.-]/g, ''));
            const previousVal = parseFloat(event.previous.replace(/[^\d.-]/g, ''));

            if (!isNaN(forecastVal) && !isNaN(previousVal)) {
              const isPositiveForCurrency = forecastVal > previousVal;

              if (isBase) {
                eventSentiment = isPositiveForCurrency ? "BULLISH" : "BEARISH";
              } else if (isQuote) {
                eventSentiment = isPositiveForCurrency ? "BEARISH" : "BULLISH";
              }
            }
          }

          const actionStr = eventSentiment === "BULLISH" ? "Favorise les ACHATS" : eventSentiment === "BEARISH" ? "Favorise les VENTES" : "Volatilité Extrême";

          return {
            sentiment: eventSentiment,
            strength: 80, // Impact lourd
            reason: `[News Agent] Événement: ${event.title} (${event.country}). ${actionStr} (Forecast: ${event.forecast} vs Prev: ${event.previous})`
          };
        }
      }

      return { sentiment: "NEUTRAL", strength: 0, reason: "Aucun événement dans la fenêtre d'impact." };
    } catch (err: any) {
      if (err?.name === "TimeoutError" || err?.code === "ABORT_ERR") {
        console.warn("[NewsAgent] Timeout (5s) — fallback to NEUTRAL");
        return { sentiment: "NEUTRAL", strength: 0, reason: "News timeout" };
      }
      console.error("[NewsAgent] Error:", err?.message);
      return { sentiment: "NEUTRAL", strength: 0, reason: "News unavailable" };
    }
  }
}
