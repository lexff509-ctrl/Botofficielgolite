/**
 * WebSocket Handshake Diagnostic
 * Logs EVERY step du handshake pour debugging
 *
 * USAGE:
 * npm run build
 * DIAGNOSTIC=true npm run dev
 */

import https from "https";
import WebSocket from "ws";

export interface HandshakeDiagnostics {
  timestamp: number;
  phase: string;
  success: boolean;
  details: Record<string, any>;
  rawResponse?: string;
  error?: string;
}

const diagnostics: HandshakeDiagnostics[] = [];

export function logDiagnostic(
  phase: string,
  success: boolean,
  details: Record<string, any>,
  rawResponse?: string,
  error?: string
): void {
  const entry: HandshakeDiagnostics = {
    timestamp: Date.now(),
    phase,
    success,
    details,
    rawResponse,
    error,
  };
  diagnostics.push(entry);

  const prefix = success ? "✅" : "❌";
  console.log(`[WS-Diagnostic] ${prefix} ${phase}`, JSON.stringify(details, null, 2));
  if (error) console.error(`[WS-Diagnostic] ERROR: ${error}`);
  if (rawResponse) console.log(`[WS-Diagnostic] Raw Response (first 300 chars): ${rawResponse.substring(0, 300)}`);
}

export function getDiagnostics(): HandshakeDiagnostics[] {
  return diagnostics;
}

export function clearDiagnostics(): void {
  diagnostics.length = 0;
}

/**
 * Test PHASE 1: HTTP Polling GET
 * Vérifie que le serveur accepte la requête et répond avec un sid valide
 */
export async function testHttpPollingOpen(
  host: string,
  cookies: string[]
): Promise<{ sid: string; rawBody: string } | null> {
  return new Promise((resolve) => {
    try {
      const url = `/socket.io/?EIO=4&transport=polling&t=${Date.now()}`;
      logDiagnostic("HTTP-Polling-URL", true, { host, path: url, cookieCount: cookies.length });

      const req = https.get(
        { hostname: host, path: url, method: "GET", headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
            "Host": host,
            ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
          },
        },
        (res) => {
          const statusOk = res.statusCode === 200;
          logDiagnostic("HTTP-Polling-Response", statusOk, {
            statusCode: res.statusCode,
            headers: res.headers,
          });

          let body = "";
          res.on("data", (chunk) => (body += chunk.toString()));
          res.on("end", () => {
            if (res.statusCode !== 200) {
              logDiagnostic("HTTP-Polling-Failed", false, {
                statusCode: res.statusCode,
                bodyPreview: body.substring(0, 200),
              }, body);
              resolve(null);
              return;
            }

            try {
              const sid = body.startsWith("0") ? JSON.parse(body.substring(1)).sid : "";
              if (!sid) throw new Error("No sid in response");

              logDiagnostic("HTTP-Polling-Sid", true, { sid, bodyPreview: body.substring(0, 100) }, body);
              resolve({ sid, rawBody: body });
            } catch (err) {
              logDiagnostic("HTTP-Polling-Parse-Error", false, {
                error: String(err),
                bodyPreview: body.substring(0, 200),
              }, body);
              resolve(null);
            }
          });
        }
      );

      req.on("error", (err) => {
        logDiagnostic("HTTP-Polling-Error", false, { error: String(err) });
        resolve(null);
      });

      req.setTimeout(15000, () => {
        req.destroy();
        logDiagnostic("HTTP-Polling-Timeout", false, { timeoutMs: 15000 });
        resolve(null);
      });
    } catch (err) {
      logDiagnostic("HTTP-Polling-Exception", false, { error: String(err) });
      resolve(null);
    }
  });
}

/**
 * Test PHASE 2: WebSocket Upgrade avec sid
 * Vérifie le handshake WebSocket + Engine.IO probe
 */
export async function testWebSocketUpgrade(
  host: string,
  sid: string,
  cookies: string[]
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      // CRITICAL: Properly encode sid for URL
      const encodedSid = encodeURIComponent(sid);
      const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodedSid}`;

      logDiagnostic("WebSocket-URL", true, {
        url: wsUrl,
        sidOriginal: sid.substring(0, 20) + "...",
        sidEncoded: encodedSid.substring(0, 20) + "...",
        cookieCount: cookies.length,
      });

      const wsOptions: WebSocket.ClientOptions = {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
          "Origin": "https://pocketoption.com",
          "Cache-Control": "no-cache",
          "Accept-Language": "en-US,en;q=0.9",
          ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
        },
        handshakeTimeout: 30000,
        perMessageDeflate: false,
      };

      logDiagnostic("WebSocket-Headers", true, {
        headerKeys: Object.keys(wsOptions.headers || {}),
        handshakeTimeout: wsOptions.handshakeTimeout,
        perMessageDeflate: false,
      });

      const ws = new WebSocket(wsUrl, wsOptions);
      let messageCount = 0;

      ws.on("open", () => {
        logDiagnostic("WebSocket-Open", true, {
          readyState: ws.readyState,
        });
      });

      ws.on("message", (msg) => {
        messageCount++;
        const text = msg.toString();
        logDiagnostic(`WebSocket-Message-${messageCount}`, true, {
          firstChar: text.charAt(0),
          preview: text.substring(0, 50),
          fullMessage: text,
        });

        // Engine.IO probe detection
        if (text === "3probe") {
          logDiagnostic("Engine.IO-Probe-Received", true, {
            message: text,
          });
          ws.send("5");
          logDiagnostic("Engine.IO-Probe-Response", true, { sent: "5" });
        }

        // Engine.IO OPEN with sid
        if (text.startsWith("0")) {
          logDiagnostic("Engine.IO-Open", true, {
            message: text.substring(0, 100),
          });
        }
      });

      ws.on("error", (err) => {
        logDiagnostic("WebSocket-Error", false, {
          error: err.message,
          code: (err as any).code,
        });
        resolve(false);
      });

      ws.on("close", () => {
        logDiagnostic("WebSocket-Close", true, {
          messageCount,
        });
        resolve(messageCount >= 2);
      });

      setTimeout(() => {
        ws.close();
      }, 10000);
    } catch (err) {
      logDiagnostic("WebSocket-Exception", false, { error: String(err) });
      resolve(false);
    }
  });
}

/**
 * Test PHASE 3: Socket.IO Authentication
 * Teste la séquence complète jusqu'à "successauth"
 */
export async function testSocketIOAuth(
  host: string,
  sid: string,
  cookies: string[],
  sessionToken: string,
  isDemo: boolean
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const encodedSid = encodeURIComponent(sid);
      const wsUrl = `wss://${host}/socket.io/?EIO=4&transport=websocket&sid=${encodedSid}`;

      const ws = new WebSocket(wsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.0.0",
          "Origin": "https://pocketoption.com",
          ...(cookies.length > 0 ? { Cookie: cookies.join("; ") } : {}),
        },
        handshakeTimeout: 30000,
        perMessageDeflate: false,
      });

      let phase = "open";
      let authSent = false;

      ws.on("open", () => {
        logDiagnostic("SocketIO-Auth-Open", true, {});
      });

      ws.on("message", (msg) => {
        const text = msg.toString();

        if (text === "3probe") {
          ws.send("5");
          logDiagnostic("SocketIO-Auth-Probe", true, {});
        }

        if (text.startsWith("0")) {
          phase = "engine-open";
          logDiagnostic("SocketIO-Auth-EngineOpen", true, { message: text.substring(0, 100) });
          ws.send("40"); // Socket.IO CONNECT
          logDiagnostic("SocketIO-Auth-SendConnect", true, { sent: "40" });
        }

        if (text.startsWith("40") && !authSent) {
          phase = "socket-connected";
          authSent = true;

          const authMsg = '42' + JSON.stringify([
            "auth",
            {
              session: sessionToken,
              isDemo: isDemo ? 1 : 0,
              uid: 0,
              platform: 2,
            },
          ]);

          logDiagnostic("SocketIO-Auth-SendAuth", true, {
            message: authMsg.substring(0, 100) + "...",
            tokenPreview: sessionToken.substring(0, 20) + "...",
          });

          ws.send(authMsg);
        }

        if (text.includes("successauth")) {
          logDiagnostic("SocketIO-Auth-Success", true, {
            message: text,
            phase,
          });
          resolve(true);
          ws.close();
          return;
        }

        if (text.includes("NotAuthorized")) {
          logDiagnostic("SocketIO-Auth-NotAuthorized", false, {
            message: text,
            phase,
          });
          resolve(false);
          ws.close();
          return;
        }
      });

      ws.on("error", (err) => {
        logDiagnostic("SocketIO-Auth-Error", false, {
          error: err.message,
          phase,
        });
        resolve(false);
      });

      setTimeout(() => {
        logDiagnostic("SocketIO-Auth-Timeout", false, {
          timeoutMs: 30000,
          phase,
          authSent,
        });
        ws.close();
        resolve(false);
      }, 30000);
    } catch (err) {
      logDiagnostic("SocketIO-Auth-Exception", false, { error: String(err) });
      resolve(false);
    }
  });
}

export async function runFullDiagnostic(
  host: string,
  cookies: string[],
  sessionToken: string,
  isDemo: boolean
): Promise<void> {
  console.log("\n" + "=".repeat(80));
  console.log("[WebSocket Diagnostic] Starting full handshake test");
  console.log("=".repeat(80) + "\n");

  clearDiagnostics();

  // Phase 1
  const polling = await testHttpPollingOpen(host, cookies);
  if (!polling) {
    console.error("\n❌ HTTP Polling FAILED. Check cookies or host.");
    return;
  }

  // Phase 2
  const upgrade = await testWebSocketUpgrade(host, polling.sid, cookies);
  if (!upgrade) {
    console.error("\n❌ WebSocket Upgrade FAILED.");
    return;
  }

  // Phase 3
  const auth = await testSocketIOAuth(host, polling.sid, cookies, sessionToken, isDemo);

  console.log("\n" + "=".repeat(80));
  console.log(`[WebSocket Diagnostic] FINAL RESULT: ${auth ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=".repeat(80) + "\n");

  console.log("\nFull Diagnostic Report:");
  console.log(JSON.stringify(getDiagnostics(), null, 2));
}
