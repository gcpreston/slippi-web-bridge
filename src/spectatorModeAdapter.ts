import { IStreamAdapter } from "./slippiConnection";

const RELAY_RECONNECT_MAX_ATTEMPTS = 5;
const RELAY_CONNECTION_TIMEOUT_MS = 8000;
const WS_NORMAL_CLOSE_CODES = [1000, 1001];

type RelayConnectionInfo = {
  bridge_id: string,
  reconnect_token: string
};

export class SpectatorModeAdapter implements IStreamAdapter {
  public connectionTimeoutMs: number = RELAY_CONNECTION_TIMEOUT_MS;

  private wsUrl: string;
  private relayWs?: WebSocket;
  private reconnectToken?: string;
  private reconnectAttempt: number = 0;

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  public connect(disconnectBridge: () => void): Promise<void> {
    return new Promise((resolve, _reject) => {
      let wsUrlWithParams: string = this.wsUrl;
      if (this.reconnectToken !== undefined) {
        wsUrlWithParams += `?${new URLSearchParams({ "reconnect_token": this.reconnectToken })}`
      }
      this.relayWs = new WebSocket(wsUrlWithParams);

      this.relayWs.onmessage = (msg) => {
        if (typeof msg.data === "string") { // should always be true
          const data: RelayConnectionInfo = JSON.parse(msg.data);
          console.log("Bridge ID:", data.bridge_id);
          console.log("Reconnect token:", data.reconnect_token);
          this.reconnectToken = data.reconnect_token;
          this.reconnectAttempt = 0;
          resolve();
        }
      };
      // TODO: Remove onmessage handler after first message

      this.relayWs.onclose = (msg) => {
        console.log("Server connection closed:", msg.code);
        if (WS_NORMAL_CLOSE_CODES.includes(msg.code)) {
          console.log("Calling disconnectBridge:", disconnectBridge);
          disconnectBridge();
        } else {
          this._reconnect(disconnectBridge);
        }
      };

      this.relayWs.onerror = (err) => {
        console.error("Relay connection error:", err);
        disconnectBridge();
      }
    });
  }

  public receive(packet: Buffer) {
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(packet);
    }
  }

  public disconnect(): void {
    this.relayWs?.close();
  }

  private _reconnect(disconnectBridge: () => void): void {
    if (this.reconnectAttempt >= RELAY_RECONNECT_MAX_ATTEMPTS) {
      console.error('Max reconnection attempts reached.');
      return;
    }

    const delay = this._getBackoffDelay(this.reconnectAttempt);
    console.log(`Reconnecting in ${delay}ms`);

    setTimeout(() => {
      this.reconnectAttempt++;
      this.connect(disconnectBridge);
    }, delay);
  }

  private _getBackoffDelay(attempt: number): number {
    const base = 500; // 0.5 second
    const max = 30000; // 30 seconds
    const jitter = Math.random() * 1000;
    return Math.min(base * 2 ** attempt + jitter, max);
  }
}
