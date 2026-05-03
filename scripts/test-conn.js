const WebSocket = require("ws");
const https = require("https");

const HOST = "demo-api-eu.po.market";
const SSID = '42["auth",{"session":"ui79rfql07vtntchhuqrm3ikb8","isDemo":1,"uid":90720400,"platform":2,"isFastHistory":true,"isOptimized":true}]';
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

console.log("Test 1: HTTPS polling...");
const req = https.get({
  hostname: HOST,
  path: "/socket.io/?EIO=4&transport=polling",
  method: "GET",
  headers: {
    "User-Agent": UA,
    "Accept": "*/*",
    "Host": HOST,
    "Origin": "https://pocketoption.com",
    "Referer": "https://pocketoption.com/",
  },
}, (res) => {
  let body = "";
  res.on("data", (c) => { body += c.toString(); });
  res.on("end", () => {
    console.log("HTTPS Status:", res.statusCode);
    console.log("HTTPS Body:", body.substring(0, 500));

    console.log("\nTest 2: Direct WebSocket...");
    const ws = new WebSocket("wss://" + HOST + "/socket.io/?EIO=4&transport=websocket", {
      headers: {
        "Origin": "https://pocketoption.com",
        "User-Agent": UA,
        "Host": HOST,
      },
      handshakeTimeout: 15000,
    });

    const timer = setTimeout(() => {
      console.log("WS TIMEOUT");
      ws.close();
      process.exit(1);
    }, 16000);

    ws.on("open", () => console.log("WS: connected"));
    ws.on("error", (e) => console.log("WS error:", e.message));
    ws.on("close", (c, r) => { console.log("WS closed:", c, r.toString()); });
    ws.on("message", (raw) => {
      const t = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
      console.log("WS <<", t.substring(0, 300));
      if (t.startsWith("0")) { console.log("Sending 40"); ws.send("40"); }
      if (t.startsWith("40")) { console.log("Sending auth"); ws.send(SSID); }
      if (t === "2") ws.send("3");
      if (t.includes("successauth")) { console.log("AUTH SUCCESS!"); clearTimeout(timer); ws.close(); setTimeout(() => process.exit(0), 500); }
      if (t.includes("NotAuthorized")) { console.log("NOT AUTHORIZED"); clearTimeout(timer); ws.close(); setTimeout(() => process.exit(0), 500); }
    });
  });
});
req.on("error", (e) => console.log("HTTPS error:", e.message));
req.setTimeout(15000, () => { console.log("HTTPS TIMEOUT"); req.destroy(); process.exit(1); });
