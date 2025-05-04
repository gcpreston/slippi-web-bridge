import { IStreamAdapter } from "./bridge";

const RELAY_RECONNECT_MAX_ATTEMPTS = 5;
const RELAY_CONNECTION_TIMEOUT_MS = 8000;

type RelayConnectionInfo = {
  bridge_id: string,
  reconnect_token: string
};

export class SpectatorModeAdapter implements IStreamAdapter {
  public readonly name = "spectator-mode-adapter";
  public readonly connectionTimeoutMs: number = RELAY_CONNECTION_TIMEOUT_MS;

  private wsUrl: string;
  private relayWs?: WebSocket;
  private reconnectToken?: string;
  private reconnectAttempt: number = 0;
  private bridgeDisconnected = false;
  private readonly currentGameTracker = new SlippiGameTracker();

  constructor(wsUrl: string) {
    this.wsUrl = wsUrl;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let wsUrlWithParams: string = this.wsUrl;
      if (this.reconnectToken !== undefined) {
        wsUrlWithParams += `?${new URLSearchParams({ "reconnect_token": this.reconnectToken })}`
      }
      this.relayWs = new WebSocket(wsUrlWithParams);

      this.relayWs.onmessage = (msg) => {
        if (typeof msg.data === "string") { // should always be true
          const data: RelayConnectionInfo = JSON.parse(msg.data);
          console.log("Bridge connected with ID:", data.bridge_id);
          this.reconnectToken = data.reconnect_token;
          this.reconnectAttempt = 0;
          resolve();
        }
      };

      this.relayWs.onclose = () => {
        if (!this.bridgeDisconnected) {
          this._reconnect();
        }
      };

      this.relayWs.onerror = () => {
        reject();
        this._reconnect();
      }
    });
  }

  public receive(packet: Buffer) {
    this.currentGameTracker.write(packet);

    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(packet);
    }

    // TODO: The problems with this code:
    // 1.
  }

  public disconnect(): void {
    this.bridgeDisconnected = true;
    this.relayWs?.close();
  }

  private _reconnect(): void {
    if (this.reconnectAttempt >= RELAY_RECONNECT_MAX_ATTEMPTS) {
      return;
    }

    const delay = this._getBackoffDelay(this.reconnectAttempt);
    setTimeout(() => {
      this.reconnectAttempt++;
      this.connect()
        .then(() => {
          if (this.currentGameTracker.isInGame()) {
            this.relayWs?.send(this.currentGameTracker.getEventPayloadsAndGameStart());
          }
        });
    }, delay);
  }

  private _getBackoffDelay(attempt: number): number {
    const base = 500; // 0.5 second
    const max = 30000; // 30 seconds
    const jitter = Math.random() * 1000;
    return Math.min(base * 2 ** attempt + jitter, max);
  }
}
