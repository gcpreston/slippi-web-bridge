import { EventEmitter } from "node:events";
import { IStreamAdapter } from "./bridge";
import { SlippiGameTracker } from "./slippiGameTracker";

const RELAY_RECONNECT_MAX_ATTEMPTS = 5;
const RELAY_CONNECTION_TIMEOUT_MS = 8000;

type RelayConnectionInfo = {
  bridge_id: string,
  reconnect_token: string
};

export class SpectatorModeAdapter extends EventEmitter  implements IStreamAdapter {
  public readonly name = "spectator-mode-adapter";
  public readonly connectionTimeoutMs: number = RELAY_CONNECTION_TIMEOUT_MS;

  private wsUrl: string;
  private relayWs?: WebSocket;
  private readyToReceive: boolean = false;
  private reconnectToken?: string;
  private reconnectAttempt: number = 0;
  private bridgeDisconnected = false;
  private readonly currentGameTracker = new SlippiGameTracker();

  constructor(wsUrl: string) {
    super();
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
          this.reconnectToken = data.reconnect_token;
          this.reconnectAttempt = 0;
          this._sendCurrentGame();
          this.readyToReceive = true;
          resolve();
          this.emit("connect", data.bridge_id);
        }
      };

      this.relayWs.onclose = () => {
        this.readyToReceive = false;
        if (!this.bridgeDisconnected) {
          this._reconnect();
        }
      };

      this.relayWs.onerror = () => {
        reject();
        this.readyToReceive = false;
        this._reconnect();
      }
    });
  }

  public receive(packet: Buffer) {
    this.currentGameTracker.write(packet);

    if (this.readyToReceive) {
      this.relayWs!.send(packet);
    }
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
      this.connect();
    }, delay);
  }

  private _getBackoffDelay(attempt: number): number {
    const base = 500; // 0.5 second
    const max = 30000; // 30 seconds
    const jitter = Math.random() * 1000;
    return Math.min(base * 2 ** attempt + jitter, max);
  }

  private _sendCurrentGame(): void {
    const currentGame: Buffer | null = this.currentGameTracker.getCurrentGame();
    if (currentGame) {
      this.relayWs?.send(currentGame);
    }
  }
}
