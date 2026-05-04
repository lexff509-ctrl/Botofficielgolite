
import fs from 'fs';
import path from 'path';

export interface SignalLog {
  id: string;
  timestamp: number;
  asset: string;
  direction: 'CALL' | 'PUT';
  timeframe: string;
  entryPrice: number;
  confidence: number;
  result?: 'WIN' | 'LOSS' | 'PENDING';
  exitPrice?: number;
  profit?: number;
}

class SignalTracker {
  private logPath: string;

  constructor() {
    this.logPath = path.join(process.cwd(), 'logs', 'signals.json');
    this.ensureLogDir();
  }

  private ensureLogDir() {
    const dir = path.dirname(this.logPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.logPath)) {
      fs.writeFileSync(this.logPath, JSON.stringify([], null, 2));
    }
  }

  async logSignal(signal: Omit<SignalLog, 'id'>): Promise<string> {
    const id = `sig_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const entry: SignalLog = { ...signal, id, result: 'PENDING' };

    try {
      const logs = await this.readLogs();
      logs.push(entry);
      await this.writeLogs(logs);
      console.log(`[SignalTracker] Signal logged: ${id} - ${entry.asset} ${entry.direction}`);
      return id;
    } catch (err) {
      console.error('[SignalTracker] Failed to log signal:', err);
      return id;
    }
  }

  async updateResult(id: string, result: 'WIN' | 'LOSS', exitPrice: number, profit: number) {
    try {
      const logs = await this.readLogs();
      const index = logs.findIndex(l => l.id === id);
      if (index !== -1) {
        logs[index] = { ...logs[index], result, exitPrice, profit };
        await this.writeLogs(logs);
        console.log(`[SignalTracker] Result updated for ${id}: ${result} (${profit.toFixed(2)}$)`);
      }
    } catch (err) {
      console.error('[SignalTracker] Failed to update signal result:', err);
    }
  }

  private async readLogs(): Promise<SignalLog[]> {
    const data = fs.readFileSync(this.logPath, 'utf8');
    return JSON.parse(data);
  }

  private async writeLogs(logs: SignalLog[]) {
    // Keep only last 1000 logs to prevent file bloat
    const trimmed = logs.slice(-1000);
    fs.writeFileSync(this.logPath, JSON.stringify(trimmed, null, 2));
  }
}

export const signalTracker = new SignalTracker();
