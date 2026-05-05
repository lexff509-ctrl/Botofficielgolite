export interface RiskConfig {
  dailyLossLimit: number;
  dailyProfitTarget: number;
  maxPositionSize: number;
  riskPerTradePercent: number;
}

export class RiskManager {
  private dailyProfit = 0;
  private tradesToday = 0;

  constructor(private config: RiskConfig) {}

  /**
   * Vérifie si un trade est autorisé selon les limites de risque
   */
  canTrade(currentDailyProfit: number): { allowed: boolean; reason?: string } {
    if (currentDailyProfit <= -this.config.dailyLossLimit) {
      return { allowed: false, reason: "Limite de perte journalière atteinte" };
    }
    if (currentDailyProfit >= this.config.dailyProfitTarget) {
      return { allowed: false, reason: "Objectif de profit journalier atteint" };
    }
    return { allowed: true };
  }

  /**
   * Calcule la taille de position idéale selon le capital et le risque
   */
  calculatePositionSize(balance: number, customAmount?: number): number {
    if (customAmount && customAmount > 0) {
      return Math.min(customAmount, this.config.maxPositionSize);
    }
    
    const calculated = (balance * this.config.riskPerTradePercent) / 100;
    return Math.min(calculated, this.config.maxPositionSize);
  }

  updateStats(profit: number) {
    this.dailyProfit += profit;
    this.tradesToday++;
  }

  getStats() {
    return {
      dailyProfit: this.dailyProfit,
      tradesToday: this.tradesToday
    };
  }
}
