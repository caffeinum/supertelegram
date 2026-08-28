import type { TelegramClient } from "telegram";
import { ConnectionTCPObfuscated } from "telegram/network";

import { wssEnabled } from "../config/manager";
export { wssEnabled };

const WEB_DC_HOSTS: Record<number, string> = {
  1: "pluto",
  2: "venus",
  3: "aurora",
  4: "vesta",
  5: "flora",
};

const TCP_DC_IPS: Record<number, string> = {
  1: "149.154.175.53",
  2: "149.154.167.51",
  3: "149.154.175.100",
  4: "149.154.167.91",
  5: "91.108.56.130",
};

export function isWebHost(host: string): boolean {
  return host.endsWith(".web.telegram.org");
}

export function restoreTcpDc(client: TelegramClient): void {
  const host = client.session.serverAddress;
  if (!host || !isWebHost(host)) return;
  const dcId = client.session.dcId;
  const ip = TCP_DC_IPS[dcId];
  if (!ip) throw new Error(`no tcp ip for DC ${dcId}`);
  client.session.setDC(dcId, ip, 443);
}

export const MTPROTO_BLOCKED_HINT =
  "mtproto handshake failed — this network likely blocks raw telegram DC traffic.\n" +
  "retry over websockets: TELEGRAM_WSS=1 or `telegram config set wss true`";

export function explainConnectionError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (!wssEnabled() && msg.includes("Not connected")) {
    return new Error(`${MTPROTO_BLOCKED_HINT}\noriginal: ${msg}`);
  }
  return err instanceof Error ? err : new Error(msg);
}

export function webDcHost(dcId: number, download = false): string {
  const name = WEB_DC_HOSTS[dcId];
  if (!name) throw new Error(`no web host for DC ${dcId}`);
  return `${name}${download ? "-1" : ""}.web.telegram.org`;
}

const closeError = new Error("WebSocket was closed");

// gramjs ships PromisedWebSockets on top of the `websocket` npm package,
// which breaks under bun (101 upgrade surfaces as a plain http response).
// native WebSocket exists in bun and node >= 22, so use that instead.
// same read/write shape gramjs' Connection expects.
class NativeWebSocket {
  private ws?: WebSocket;
  private stream = Buffer.alloc(0);
  private closed = true;
  private canRead!: Promise<boolean>;
  private resolveRead?: (value: boolean) => void;

  private resetRead() {
    this.canRead = new Promise((resolve) => {
      this.resolveRead = resolve;
    });
  }

  getWebSocketLink(host: string, port: number, testServers: boolean): string {
    const scheme = port === 443 ? "wss" : "ws";
    return `${scheme}://${host}/apiws${testServers ? "_test" : ""}`;
  }

  async connect(port: number, host: string, testServers = false): Promise<this> {
    if (typeof WebSocket === "undefined") {
      throw new Error("wss transport needs a native WebSocket (bun or node >= 22)");
    }
    this.stream = Buffer.alloc(0);
    this.resetRead();
    this.closed = false;
    const url = this.getWebSocketLink(host, port, testServers);
    const ws = new WebSocket(url, "binary");
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve(this);
      ws.onerror = (event) => {
        reject(new Error(`wss connect to ${url} failed: ${(event as ErrorEvent).message ?? "unknown"}`));
      };
      ws.onclose = () => {
        this.closed = true;
        this.resolveRead?.(false);
      };
      ws.onmessage = (message) => {
        this.stream = Buffer.concat([this.stream, Buffer.from(message.data as ArrayBuffer)]);
        this.resolveRead?.(true);
      };
    });
  }

  async read(number: number): Promise<Buffer> {
    if (this.closed) throw closeError;
    await this.canRead;
    if (this.closed) throw closeError;
    const toReturn = this.stream.subarray(0, number);
    this.stream = this.stream.subarray(number);
    if (this.stream.length === 0) this.resetRead();
    return toReturn;
  }

  async readExactly(number: number): Promise<Buffer> {
    let readData = Buffer.alloc(0);
    while (number > 0) {
      const chunk = await this.read(number);
      readData = Buffer.concat([readData, chunk]);
      number -= chunk.length;
    }
    return readData;
  }

  async readAll(): Promise<Buffer> {
    if (this.closed || !(await this.canRead)) throw closeError;
    const toReturn = this.stream;
    this.stream = Buffer.alloc(0);
    this.resetRead();
    return toReturn;
  }

  write(data: Buffer) {
    if (this.closed) throw closeError;
    this.ws?.send(data);
  }

  async close() {
    this.ws?.close();
    this.closed = true;
  }

  toString() {
    return "NativeWebSocket";
  }
}

export const wssClientParams = {
  useWSS: true,
  networkSocket: NativeWebSocket as any,
  connection: ConnectionTCPObfuscated,
} as const;

export function applyWss(client: TelegramClient): void {
  const dcId = client.session.dcId || 2;
  client.session.setDC(dcId, webDcHost(dcId), 443);

  const original = client.getDC.bind(client);
  client.getDC = (id: number, downloadDC = false) =>
    original(id, downloadDC, true);
}
