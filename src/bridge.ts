import { EventEmitter } from 'events';
import { DolphinConnection } from '@slippi/slippi-js';
import {
  ConnectionStatus,
  ConnectionEvent,
  Connection,
  SlpStream,
  SlpStreamMode,
  SlpStreamEvent,
  Command,
  SlpCommandEventPayload
} from '@slippi/slippi-js';

const WS_CONNECTION_TIMEOUT_MS = 3000;
const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;

function bufferToArrayBuffer(b: Buffer): ArrayBufferLike {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

export enum BridgeEvent {
  WS_CONNECTED = "swb-ws-connected",
  SLIPPI_CONNECTED = "swb-slippi-connected",
  GAME_START = "swb-game-start",
  GAME_END = "swb-game-end",
  DISCONNECTED = "swb-disconnected"
}

export enum DisconnectReason {
  WS_TIMEOUT = "swb-ws-timeout",
  WS_DISCONNECT = "swb-ws-disconnect",
  SLIPPI_TIMEOUT = "swb-slippi-timeout",
  SLIPPI_DISCONNECT = "swb-slippi-disconnect",
  ERROR = "swb-error", // TODO: Catch-all?
  QUIT = "swb-quit"
}

// TODO: Add type to eventemitter
export class Bridge extends EventEmitter {
  // Most basic cases to start
  // only Dolphin connection
  private slippiConnection: Connection = new DolphinConnection();
  private ws?: WebSocket;
  private slpStream: SlpStream = new SlpStream({ mode: SlpStreamMode.AUTO });
  private sendBuffer: ArrayBufferLike[] = [];
  private disconnectReason: DisconnectReason | null = null;

  public bridgeId?: string;

  /**
   * Connect to Slippi and the sink. Returns a promise which is resolved
   * on successful connection to both sides, which gives the assigned bridge ID.
   */
  public connect(slippiAddress: string, slippiPort: number, wsUrl: string): Promise<string | void> {
    const wsPromise = this.startWsConnection(wsUrl);
    const slippiPromise =  this.startSlippiConnection(slippiAddress, slippiPort)

    return Promise.all([wsPromise, slippiPromise])
      .then(([maybeResolvedBridgeId, _]) => maybeResolvedBridgeId);
  }

  /**
   * Forward Slippi data to the WebSocket connection. If there is no current
   * WebSocket connection, the data is stored in a buffer to be sent when
   * a connection is established.
   */
  private forward(data: ArrayBufferLike): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    } else {
      this.sendBuffer.push(data);
    }
  }

  private startWsConnection(wsUrl: string): Promise<string | void> {
    const wsPromise = new Promise<string>((resolve, _reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        for (const b of this.sendBuffer) {
          this.forward(b);
        }
      }

      this.ws.onmessage = (msg) => {
        console.log("Bridge ID:", msg.data);
        this.bridgeId = msg.data;
        this.emit(BridgeEvent.WS_CONNECTED, msg.data);
        resolve(msg.data);
      };

      this.ws.onclose = (msg) => {
        console.log("WebSocket connection closed:", msg);
        this.disconnect(DisconnectReason.WS_DISCONNECT);
      };

      this.ws.onerror = (err) => {
        console.error(err);
        this.disconnect(DisconnectReason.WS_DISCONNECT);
      }
    });
    return promiseTimeout(WS_CONNECTION_TIMEOUT_MS, wsPromise)
      .catch(() => { this.disconnect(DisconnectReason.WS_TIMEOUT); });
  }

  public quit(): void {
    this.disconnect(DisconnectReason.QUIT);
  }

  private disconnect(reason: DisconnectReason): void {
    if (!this.disconnectReason) {
      this.disconnectReason = reason;
      this.slippiConnection.disconnect();
      this.ws?.close();
      this.ws = undefined;
      this.emit(BridgeEvent.DISCONNECTED, reason);
    }
  }

  // startSlippiConnection and promiseTimeout taken from
  // https://github.com/vinceau/slp-realtime/blob/7ad713c67904c4556cea29db7c8d37e9c5e25239/src/stream/slpLiveStream.ts

  private async startSlippiConnection(slippiAddress: string, slippiPort: number): Promise<void> {
    const assertConnected: Promise<void> = new Promise((resolve, reject): void => {
      // Attach the statusChange handler before we initiate the connection
      const onStatusChange = (status: ConnectionStatus) => {
        // We only care about the connected and disconnected statuses
        if (status !== ConnectionStatus.CONNECTED && status !== ConnectionStatus.DISCONNECTED) {
          return;
        }

        // Complete the promise
        switch (status) {
          case ConnectionStatus.CONNECTED:
            this.emit(BridgeEvent.SLIPPI_CONNECTED);
            console.log('Connected to Slippi.');
            resolve();
            break;
          case ConnectionStatus.DISCONNECTED:
            this.disconnect(DisconnectReason.SLIPPI_DISCONNECT);
            reject(new Error(`Disconnected from Slippi: ${slippiAddress}:${slippiPort}`));
            break;
        }
      };
      this.slippiConnection.on(ConnectionEvent.STATUS_CHANGE, onStatusChange);

      this.slippiConnection.on(ConnectionEvent.DATA, (b: Buffer) => {
        this.slpStream.write(b);
        const ab = bufferToArrayBuffer(b)
        this.forward(ab);
      });

      this.slpStream.on(SlpStreamEvent.COMMAND, (data: SlpCommandEventPayload) => {
        const { command, payload } = data;

        switch (command) {
          case Command.GAME_START:
            this.emit(BridgeEvent.GAME_START, payload);
            break;
          case Command.GAME_END:
            this.emit(BridgeEvent.GAME_END);
            break;
        }
      });

      try {
        // Actually try to connect
        this.slippiConnection.connect(slippiAddress, slippiPort);
      } catch (err) {
        reject(err);
      }
    });
    return promiseTimeout<void>(SLIPPI_CONNECTION_TIMEOUT_MS, assertConnected)
      .catch(() => { this.disconnect(DisconnectReason.SLIPPI_TIMEOUT); });
  }
}

/**
 * Returns either the promise resolved or a rejection after a specified timeout.
 */
const promiseTimeout = <T>(ms: number, promise: Promise<T>): Promise<T> => {
  // Create a promise that rejects in <ms> milliseconds
  const timeout = new Promise((_resolve, reject): void => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Timed out after ${ms}ms.`));
    }, ms);
  });

  // Returns a race between our timeout and the passed in promise
  return Promise.race([promise, timeout]) as Promise<T>;
};
