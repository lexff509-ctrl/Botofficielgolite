// src/services/ai-sentiment.service.ts
import { Candle } from "@/lib/trading";

export interface AIValidationResult {
  approved: boolean;
  confidence: number;
  reason: string;
}

export class AISentimentService {
  private readonly DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";
  private readonly OPENAI_URL = "https://api.openai.com/v1/chat/completions";

  public async validatePriceAction(
    asset: string, 
    timeframe: string, 
    signal: "BUY" | "SELL", 
    candles: Candle[]
  ): Promise<AIValidationResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    
    // If no API key is provided, we auto-approve the signal to not block the bot
    if (!apiKey) {
      return { 
        approved: true, 
        confidence: 100, 
        reason: "Auto-approuvé (Aucune clé API IA configurée)" 
      };
    }

    const apiUrl = process.env.DEEPSEEK_API_KEY ? this.DEEPSEEK_URL : this.OPENAI_URL;
    const model = process.env.DEEPSEEK_API_KEY ? "deepseek-chat" : "gpt-3.5-turbo";

    // Format the last 20 candles for the prompt to save tokens
    const recentCandles = candles.slice(-20);
    const priceData = recentCandles.map(c => 
      `O:${c.open.toFixed(5)} H:${c.high.toFixed(5)} L:${c.low.toFixed(5)} C:${c.close.toFixed(5)}`
    ).join(" | ");

    const prompt = `Tu es un trader institutionnel expert en Price Action.
Je m'apprête à prendre un trade ${signal} sur ${asset} (Timeframe: ${timeframe}).
Voici les 20 dernières bougies (Open, High, Low, Close) :
${priceData}

Analyse la structure du marché (rejets, cassures, bougies institutionnelles, dojis).
Y a-t-il une manipulation évidente ou un risque majeur (fakeout) contre mon trade ${signal} ?
Réponds UNIQUEMENT avec un objet JSON strict :
{"approved": true/false, "confidence": 0-100, "reason": "1 phrase très courte de justification"}`;

    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2, // Low temp for deterministic logic
          max_tokens: 150
        })
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      
      // Parse JSON
      const jsonStart = content.indexOf('{');
      const jsonEnd = content.lastIndexOf('}') + 1;
      const parsed = JSON.parse(content.substring(jsonStart, jsonEnd));

      return {
        approved: !!parsed.approved,
        confidence: parsed.confidence || 50,
        reason: `[IA] ${parsed.reason}`
      };

    } catch (err) {
      console.error("[AISentiment] AI Validation failed:", err);
      // Fallback: auto-approve if AI is down
      return { 
        approved: true, 
        confidence: 80, 
        reason: "Auto-approuvé (Erreur de connexion IA)" 
      };
    }
  }
}

export const aiSentimentService = new AISentimentService();
