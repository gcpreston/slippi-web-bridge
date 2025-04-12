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

// TODO: Add type to eventemitter
export class Bridge extends EventEmitter {
  // Most basic cases to start
  // only Dolphin connection
  private slippiConnection: Connection = new DolphinConnection();
  private slpStream: SlpStream = new SlpStream({ mode: SlpStreamMode.AUTO });
  private sendBuffer: Buffer[] = [];
  // TODO: Manage closing of one connection with the other (or whatever is desired)

  private ws?: WebSocket;
  public bridgeId?: string;

  /**
   * Connect to Slippi and the sink. Returns a promise which is resolved
   * on successful connection to both sides, which gives the assigned bridge ID.
   */
  public connect(slippiAddress: string, slippiPort: number, wsUrl: string): Promise<string> {
    const wsPromise = this.startWsConnection(wsUrl);
    const slippiPromise =  this.startSlippiConnection(slippiAddress, slippiPort)

    return Promise.all([wsPromise, slippiPromise])
      .then(([resolvedBridgeId, _]) => resolvedBridgeId);
  }

  /**
   * Forward Slippi data to the WebSocket connection. If there is no current
   * WebSocket connection, the data is stored in a buffer to be sent when
   * a connection is established.
   */
  private forward(b: Buffer): void {
    if (this.ws) {
      const ab = bufferToArrayBuffer(b)
      this.ws.send(ab);
    } else {
      this.sendBuffer.push(b);
    }
  }

  private startWsConnection(wsUrl: string): Promise<string> {
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
        this.disconnect();
      };

      this.ws.onerror = (err) => {
        console.error(err);
        this.disconnect();
      }
    });
    return promiseTimeout(WS_CONNECTION_TIMEOUT_MS, wsPromise);
  }

  public disconnect(): void {
    this.slippiConnection.disconnect();
    this.ws?.close();
    this.ws = undefined;
    this.emit(BridgeEvent.DISCONNECTED);
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
        this.slippiConnection.removeListener(ConnectionEvent.STATUS_CHANGE, onStatusChange);

        // Complete the promise
        switch (status) {
          case ConnectionStatus.CONNECTED:
            this.emit(BridgeEvent.SLIPPI_CONNECTED);
            console.log('Connected to Slippi.');
            resolve();
            break;
          case ConnectionStatus.DISCONNECTED:
            this.disconnect();
            reject(new Error(`Failed to connect to: ${slippiAddress}:${slippiPort}`));
            break;
        }
      };
      // TODO: Add disconnected event to slippi connection
      this.slippiConnection.on(ConnectionEvent.STATUS_CHANGE, onStatusChange);

      this.slippiConnection.on(ConnectionEvent.DATA, (b: Buffer) => {
        this.slpStream.write(b);
        this.forward(b);
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
    return promiseTimeout<void>(SLIPPI_CONNECTION_TIMEOUT_MS, assertConnected);
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
