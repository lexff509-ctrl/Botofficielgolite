// src/services/news.service.ts
import { Timeframe } from "@/lib/trading";

export interface NewsEvent {
  title: string;
  country: string;
  date: string;
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast: string;
  previous: string;
}

export class NewsService {
  private cache: NewsEvent[] = [];
  private lastFetch: number = 0;
  private readonly CACHE_TTL = 1000 * 60 * 60 * 4; // 4 hours

  public async getHighImpactNews(): Promise<NewsEvent[]> {
    if (Date.now() - this.lastFetch < this.CACHE_TTL && this.cache.length > 0) {
      return this.cache;
    }

    try {
      console.log("[NewsService] Fetching ForexFactory JSON feed...");
      // Using a public proxy for ForexFactory JSON (often used by open source bots)
      const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      
      if (Array.isArray(data)) {
        this.cache = data.map((item: any) => ({
          title: item.title,
          country: item.country,
          date: item.date, // ISO string
          impact: item.impact,
          forecast: item.forecast,
          previous: item.previous
        }));
        this.lastFetch = Date.now();
        console.log(`[NewsService] Loaded ${this.cache.length} news events.`);
      }
      return this.cache;
    } catch (err) {
      console.error("[NewsService] Failed to fetch news:", err);
      return this.cache; // Fallback to stale cache
    }
  }

  public async isSafeToTrade(asset: string): Promise<{ safe: boolean; reason?: string }> {
    // OTC markets are technically not affected by real-world news in real-time
    if (asset.toUpperCase().includes("OTC")) {
      return { safe: true };
    }

    const news = await this.getHighImpactNews();
    if (!news || news.length === 0) return { safe: true };

    const currencies = asset.replace(/[^A-Z]/g, "").match(/.{1,3}/g) || []; // "EURUSD" -> ["EUR", "USD"]
    
    const now = new Date();
    const DANGER_WINDOW_MS = 15 * 60 * 1000; // 15 mins before and after

    for (const event of news) {
      if (event.impact !== "High") continue;
      
      // Check if event affects our currencies
      if (!currencies.includes(event.country)) continue;

      const eventDate = new Date(event.date);
      const diffMs = Math.abs(eventDate.getTime() - now.getTime());

      if (diffMs <= DANGER_WINDOW_MS) {
        return { 
          safe: false, 
          reason: `Évitement d'annonce majeure (${event.country}): ${event.title} (${Math.round(diffMs/60000)}m restantes)` 
        };
      }
    }

    return { safe: true };
  }
}

export const newsService = new NewsService();
