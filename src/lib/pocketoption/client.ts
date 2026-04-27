// PocketOption WebSocket client
// Connects to PocketOption API for real-time trading

import WebSocket from "ws";

interface TradeRequest {
  asset: string;
  direction: "CALL" | "PUT";
  amount: number;
  duration: number; // in seconds
}

interface TradeResult {
  win: boolean;
  profit: number;
  openPrice: number;
  closePrice: number;
  tradeId: string;
}

interface CandleData {
  asset: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

const POCKET_OPTION_WS_URL = "wss://ws.pocketoption.com";

export class PocketOptionClient {
  private ssid: string;
  private ws: WebSocket | null = null;
  private connected = false;
  private messageHandlers = new Map<string, (data: unknown) => void>();
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private requestId = 0;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private candleListeners = new Map<
    string,
    ((candle: CandleData) => void)[]
  >();

  constructor(ssid: string) {
    this.ssid = ssid;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(`${POCKET_OPTION_WS_URL}?session=${this.ssid}`);

        const timeout = setTimeout(() => {
          reject(new Error("Connection timeout"));
          this.ws?.close();
        }, 15000);

        this.ws.on("open", () => {
          clearTimeout(timeout);
          this.connected = true;

          // Subscribe to candles for all assets
          this.sendMessage({
            name: "subscribe",
            msg: {
              name: "candle-generated",
              params: { asset: "*", size: 60 },
            },
          });

          // Start heartbeat
          this.heartbeatInterval = setInterval(() => {
            this.sendMessage({ name: "ping" });
          }, 30000);

          resolve();
        });

        this.ws.on("message", (raw: WebSocket.Data) => {
          try {
            const data = JSON.parse(raw.toString());
            this.handleMessage(data);
          } catch {
            // Ignore parse errors for binary frames
          }
        });

        this.ws.on("close", () => {
          this.connected = false;
          this.cleanup();
          // Auto-reconnect after 5 seconds
          setTimeout(() => {
            if (!this.connected) {
              this.connect().catch(() => {});
            }
          }, 5000);
        });

        this.ws.on("error", (err: Error) => {
          clearTimeout(timeout);
          this.connected = false;
          this.cleanup();
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // Reject all pending requests
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Connection closed"));
    }
    this.pendingRequests.clear();
  }

  private handleMessage(data: Record<string, unknown>): void {
    const name = data.name as string;
    const msg = data.msg as Record<string, unknown> | undefined;
    const requestId = data.requestId as string | undefined;

    // Handle candle data
    if (name === "candle-generated" && msg) {
      const candle: CandleData = {
        asset: msg.asset as string,
        open: Number(msg.open),
        high: Number(msg.high),
        low: Number(msg.low),
        close: Number(msg.close),
        volume: Number(msg.volume || 0),
        timestamp: Number(msg.time || Date.now()),
      };

      const listeners = this.candleListeners.get(candle.asset) || [];
      for (const listener of listeners) {
        try { listener(candle); } catch {}
      }
    }

    // Handle pending request responses
    if (requestId && this.pendingRequests.has(requestId)) {
      const pending = this.pendingRequests.get(requestId)!;
      this.pendingRequests.delete(requestId);

      if (data.error) {
        pending.reject(new Error(data.error as string));
      } else {
        pending.resolve(data);
      }
    }

    // Handle heartbeat
    if (name === "pong") {
      // Connection alive
    }
  }

  private sendMessage(data: Record<string, unknown>): void {
    if (!this.ws || !this.connected) {
      throw new Error("Not connected");
    }
    const message = { ...data, requestId: String(++this.requestId) };
    this.ws.send(JSON.stringify(message));
  }

  private async sendRequest(data: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const requestId = String(++this.requestId);
      const message = { ...data, requestId };
      this.pendingRequests.set(requestId, { resolve, reject });

      if (!this.ws || !this.connected) {
        this.pendingRequests.delete(requestId);
        reject(new Error("Not connected"));
        return;
      }

      this.ws.send(JSON.stringify(message));

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error("Request timeout"));
        }
      }, 30000);
    });
  }

  // Place a real trade on PocketOption
  async placeTrade(request: TradeRequest): Promise<TradeResult> {
    try {
      const response = (await this.sendRequest({
        name: "open-deal",
        msg: {
          asset: request.asset,
          direction: request.direction === "CALL" ? "call" : "put",
          amount: request.amount,
          duration: request.duration,
          expirationType: "by_duration",
        },
      })) as Record<string, unknown>;

      const deal = response.msg as Record<string, unknown>;
      const win = deal?.profit ? Number(deal.profit) > 0 : false;

      return {
        win,
        profit: Number(deal?.profit || -request.amount),
        openPrice: Number(deal?.open_price || 0),
        closePrice: Number(deal?.close_price || 0),
        tradeId: String(deal?.deal_id || ""),
      };
    } catch (err) {
      throw new Error(
        err instanceof Error ? err.message : "Trade execution failed"
      );
    }
  }

  // Subscribe to real-time candles for an asset
  onCandle(asset: string, callback: (candle: CandleData) => void): () => void {
    if (!this.candleListeners.has(asset)) {
      this.candleListeners.set(asset, []);
    }
    this.candleListeners.get(asset)!.push(callback);

    // Send subscription for this specific asset
    this.sendMessage({
      name: "subscribe",
      msg: {
        name: "candle-generated",
        params: { asset, size: 60 },
      },
    });

    // Return unsubscribe function
    return () => {
      const listeners = this.candleListeners.get(asset);
      if (listeners) {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    };
  }

  // Get account balance
  async getBalance(): Promise<{ demo: number; live: number }> {
    try {
      const response = (await this.sendRequest({
        name: "get-balance",
      })) as Record<string, unknown>;

      const balance = response.msg as Record<string, unknown>;
      return {
        demo: Number(balance?.demoBalance || 0),
        live: Number(balance?.liveBalance || 0),
      };
    } catch {
      return { demo: 0, live: 0 };
    }
  }
}
