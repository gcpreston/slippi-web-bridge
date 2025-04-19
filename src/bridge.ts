import { EventEmitter } from "events";
import WebSocket, { WebSocketServer } from "ws";
import { DolphinConnection, SlpRawEventPayload } from "@slippi/slippi-js";
import {
  ConnectionStatus,
  ConnectionEvent,
  Connection,
  SlpStream,
  SlpStreamMode,
  SlpStreamEvent,
  Command,
  SlpCommandEventPayload
} from "@slippi/slippi-js";
import { SLIPPI_LOCAL_ADDR, SLIPPI_PORTS, WSS_DEFAULT_PORT } from "./constants";

const WS_CONNECTION_TIMEOUT_MS = 3000;
const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;

export enum BridgeEvent {
  SLIPPI_CONNECTED = "swb-slippi-connected",
  RELAY_CONNECTED = "swb-relay-connected",
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

type BridgeOptions = {
  server?: { port: number } | false,
  slippi?: {
    address?: string,
    port?: number
  }
};

/**
 * A bridge from Slippi's raw socket stream to a WebSocket.
 *
 * Please note that programs using the Bridge class may not exit as expected
 * when all listeners are disconnected. This may be due to enet, which is used
 * by Slippi. For this reason, it's recommended that dependents wanting to exit
 * when the bridge is shut down use:
 *
 * ```js
 * const bridge = new Bridge();
 * bridge.on(BridgeEvent.DISCONNECTED, (reason) => {
 *   // handle reason if desired...
 *   process.exit();
 * });
 * ```
 */
// TODO: Add type to eventemitter
export class Bridge extends EventEmitter {
  // only Dolphin connection
  private slippiConnection: Connection = new DolphinConnection();
  private slpStream: SlpStream = new SlpStream({ mode: SlpStreamMode.AUTO });
  private sendBuffer: Buffer[] = [];

  // events to send upon client connection
  private eventPayloadsBinary?: Buffer;
  private gameStartBinary?: Buffer;

  // just one relay server for now
  private relayWs?: WebSocket;
  private disconnectReason: DisconnectReason | null = null;
  private connectedClients = new Set<WebSocket>();
  private wss?: WebSocketServer

  public bridgeId?: string;

  constructor(options?: BridgeOptions) {
    super();

    const slippiAddress = options?.slippi?.address || SLIPPI_LOCAL_ADDR;
    const slippiPort = options?.slippi?.port || SLIPPI_PORTS.DEFAULT;

    this.startSlippiConnection(slippiAddress, slippiPort)
      .then(() => {
        if (options?.server === false) return;

        const serverPort = options?.server?.port || WSS_DEFAULT_PORT;
        this.wss = new WebSocketServer({ port: serverPort });
        console.log("WebSocket server running on port", serverPort);

        this.wss.on("connection", (ws) => {
          console.log("Client connection opened");
          this.connectedClients.add(ws);
          if (this.eventPayloadsBinary && this.gameStartBinary) {
            ws.send(new Blob([this.eventPayloadsBinary, this.gameStartBinary]))
          }

          ws.on("error", (err) => {
            console.error("Client connection:", err);
            this.connectedClients.delete(ws);
          });
          ws.on("close", (code) => {
            console.log("Client connection closed with code", code);
            this.connectedClients.delete(ws);
          });
        });
      })
      .catch((reason) => {
        console.error("Slippi connection:", reason);
        this.disconnect(DisconnectReason.SLIPPI_TIMEOUT);
      });
  }

  /**
   * Forward Slippi data to the WebSocket connection.
   * TODO: Rethink send buffer
   */
  private forward(data: Buffer): void {
    // forward to relay
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(data);
    } else {
      this.sendBuffer.push(data);
    }

    // forward to websocket clients
    for (const ws of this.connectedClients) {
      ws.send(data);
    }
  }

  /**
   * Connect to a server which wants to receive Slippi events.
   * TODO: Make receiving bridge ID injectable behavior
   */
  public connectToRelayServer(relayServerWsUrl: string): Promise<string | void> {
    const wsPromise = new Promise<string>((resolve, _reject) => {
      this.relayWs = new WebSocket(relayServerWsUrl);

      this.relayWs.onopen = () => {
        for (const b of this.sendBuffer) {
          this.forward(b);
        }
      }

      this.relayWs.onmessage = (msg) => {
        console.log("Bridge ID:", msg.data);
        // TODO: Better typing
        this.bridgeId = msg.data as string;
        this.emit(BridgeEvent.RELAY_CONNECTED, msg.data);
        resolve(this.bridgeId);
      };

      this.relayWs.onclose = (msg) => {
        console.log("Server connection closed:", msg.code);
      };

      this.relayWs.onerror = (err) => {
        console.error("Relay connection:", err.message);
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
      this.relayWs?.close();
      this.relayWs = undefined;
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
            console.log("Connected to Slippi.");
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

      this.slpStream.on(SlpStreamEvent.RAW, (data: SlpRawEventPayload) => {
        const { command, payload } = data;

        switch (command) {
          case Command.MESSAGE_SIZES:
            this.eventPayloadsBinary = payload;
            break;
          case Command.GAME_START:
            this.gameStartBinary = payload;
            break;
          case Command.GAME_END:
            this.eventPayloadsBinary = undefined;
            this.gameStartBinary = undefined;
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
