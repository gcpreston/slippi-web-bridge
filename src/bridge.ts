import { EventEmitter } from "events";
import WebSocket, { WebSocketServer } from "ws";
import { DolphinConnection, SlpRawEventPayload } from "@slippi/slippi-js/node";
import {
  ConnectionStatus,
  ConnectionEvent,
  Connection,
  SlpStream,
  SlpStreamMode,
  SlpStreamEvent,
  Command,
  SlpCommandEventPayload
} from "@slippi/slippi-js/node";
import { SLIPPI_LOCAL_ADDR, SLIPPI_PORTS, WSS_DEFAULT_PORT } from "./constants";

const RELAY_RECONNECT_MAX_ATTEMPTS = 5;
const RELAY_CONNECTION_TIMEOUT_MS = 8000;
const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;

export enum BridgeEvent {
  SLIPPI_CONNECTED = "swb-slippi-connected",
  RELAY_CONNECTED = "swb-relay-connected",
  GAME_START = "swb-game-start",
  GAME_END = "swb-game-end",
  DISCONNECTED = "swb-disconnected"
}

export enum DisconnectReason {
  RELAY_TIMEOUT = "swb-relay-timeout",
  SLIPPI_TIMEOUT = "swb-slippi-timeout",
  SLIPPI_DISCONNECT = "swb-slippi-disconnect",
  ERROR = "swb-error", // TODO: Catch-all?
  QUIT = "swb-quit"
}

export type BridgeOptions = {
  server?: { port: number } | false,
  slippi?: {
    address?: string,
    port?: number
  }
};

type RelayConnectionInfoJson = {
  bridge_id: string,
  stream_ids: number[],
  reconnect_token: string
};

export type RelayConnectionInfo = {
  bridgeId: string,
  streamIds: number[]
}

// IDEA: Want to properly compartmentalize spectator-mode logic
// - Connection protocol: Expect to receive bridge ID and reconnect token upon
//   connection. WebSocket does not support a "connection response"-type thing
//   like Phoenix Channels do. Maybe look into that for implementation ideas.
// - This could be 2 main components:
//   1. The connector between the Slippi data being transferred to this machine
//   2. A sort of "stream-to-able" interface. The idea would be data can be
//      agnostically sent to any of these interfaces to forward, and they can
//      deal with setup, shutdown, etc. **This way each component handles only
//      one potential connection**, i.e. simplifying the Slippi + relay logic
//      that currently all lives in Bridge.

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
class BridgeEmitter extends EventEmitter {
  // only Dolphin connection
  private slippiConnection: Connection = new DolphinConnection();
  private slpStream: SlpStream = new SlpStream({ mode: SlpStreamMode.AUTO });

  // events to send upon client connection
  private currentGameEvents: Uint8Array[] = [];

  // just one relay server for now
  private relayWsUrl?: string;
  private relayWs?: WebSocket;
  private disconnectReason: DisconnectReason | null = null;
  private reconnectToken?: string;
  private reconnectAttempt: number = 0;
  private connectedClients = new Set<WebSocket>();
  private wss?: WebSocketServer
  private didQuit = false;

  public bridgeId?: string;
  public streamId?: number;

  constructor(slippiHost: string, slippiPort: number, serverPort: number | false) {
    super();

    this.startSlippiConnection(slippiHost, slippiPort)
      .then(() => {
        if (serverPort === false) return;

        this.wss = new WebSocketServer({ port: serverPort });
        console.log("WebSocket server running on port", serverPort);

        this.wss.on("connection", (ws) => {
          console.log("Client connection opened");
          this.connectedClients.add(ws);
          this.sendCurrentGameInfo(ws);

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

  private sendCurrentGameInfo(ws: WebSocket): void {
    if (this.currentGameEvents.length > 0) {
      ws.send(new Blob(this.currentGameEvents.map(e => new Uint8Array(createPacket(this.streamId!, e)))));
    }
  }

  /**
   * Forward Slippi data to the WebSocket connection.
   */
  private forward(data: Uint8Array): void {
    const packet = createPacket(this.streamId!, data);

    // forward to relay
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(packet);
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
  public connectToRelayServer(relayServerWsUrl: string, reconnectToken?: string): Promise<string | void> {
    this.relayWsUrl = relayServerWsUrl;

    const wsPromise = new Promise<string>((resolve, _reject) => {
      if (reconnectToken) {
        const params = new URLSearchParams({ reconnect_token: reconnectToken });
        relayServerWsUrl = `${relayServerWsUrl}?${params.toString()}`;
      }
      this.relayWs = new WebSocket(relayServerWsUrl);

      this.relayWs.onopen = (wsEvent) => {
        this.sendCurrentGameInfo(wsEvent.target);
        this.reconnectAttempt = 0;
      }

      this.relayWs.onmessage = (msg) => {
        if (typeof msg.data === "string") { // should always be true
          const data: RelayConnectionInfoJson = JSON.parse(msg.data);
          console.log("Bridge ID:", data.bridge_id);
          console.log("Stream ID:", data.stream_ids[0]);
          this.bridgeId = data.bridge_id;
          this.streamId = data.stream_ids[0];
          this.reconnectToken = data.reconnect_token;
          this.emit(BridgeEvent.RELAY_CONNECTED, msg.data);
          resolve(this.bridgeId);
        }
      };

      this.relayWs.onclose = (msg) => {
        console.log("Server connection closed:", msg.code);
        if (!this.didQuit) {
          this.reconnectRelay();
        }
      };

      this.relayWs.onerror = (err) => {
        console.error("Relay connection:", err.message);
        this.reconnectRelay();
      }
    });
    return promiseTimeout(RELAY_CONNECTION_TIMEOUT_MS, wsPromise)
      .catch(() => { this.disconnect(DisconnectReason.RELAY_TIMEOUT); });
  }

  private reconnectRelay(): void {
    if (this.reconnectAttempt >= RELAY_RECONNECT_MAX_ATTEMPTS) {
      console.error('Max reconnection attempts reached.');
      return;
    }

    const delay = this.getBackoffDelay(this.reconnectAttempt);
    console.log(`Reconnecting in ${delay}ms`);

    setTimeout(() => {
      this.reconnectAttempt++;
      this.connectToRelayServer(this.relayWsUrl!, this.reconnectToken);
    }, delay);
  }

  private getBackoffDelay(attempt: number): number {
    const base = 500; // 0.5 second
    const max = 30000; // 30 seconds
    const jitter = Math.random() * 1000;
    return Math.min(base * 2 ** attempt + jitter, max);
  }

  public quit(): void {
    this.didQuit = true;
    this.disconnect(DisconnectReason.QUIT);
  }

  private disconnect(reason: DisconnectReason): void {
    if (!this.disconnectReason) {
      if ([DisconnectReason.QUIT, DisconnectReason.SLIPPI_TIMEOUT].includes(reason)) {
        this.relayWs?.send("quit");
      }

      this.disconnectReason = reason;
      this.slippiConnection.disconnect();
      this.relayWs?.close();
      this.relayWs = undefined;
      this.wss?.close();
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

      this.slippiConnection.on(ConnectionEvent.DATA, (b: Uint8Array) => {
        this.slpStream.process(b);
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

        if (command === Command.MESSAGE_SIZES) {
          this.currentGameEvents = [payload];
        } else {
          this.currentGameEvents.push(payload);
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

export enum ConnectResultError {
  SLIPPI_CONNECT_ERROR,
  RELAY_CONNECT_ERROR
}

export type ConnectResult = {
  data: RelayConnectionInfo | null,
  error: ConnectResultError | null
};

export type BridgeConnectOptions = {
  slippiHost?: string,
  slippiPort?: number
};

export class Bridge {
  private disconnectCallback: (reason: DisconnectReason) => void = () => {};
  private bridge?: BridgeEmitter;

  public async connect(relayWsUrl: string, options?: BridgeConnectOptions): Promise<ConnectResult> {
    const slippiHost = options?.slippiHost ?? SLIPPI_LOCAL_ADDR;
    const slippiPort = options?.slippiPort ?? SLIPPI_PORTS.DEFAULT;

    const bridge = new BridgeEmitter(slippiHost, slippiPort, false);
    this.bridge = bridge;

    // Setup listeners
    bridge.on(BridgeEvent.DISCONNECTED, this.disconnectCallback);

    const slippiConnectionPromise = new Promise<void>((resolve, _) => {
      const onSlippiConnected = () => {
        bridge.removeListener(BridgeEvent.SLIPPI_CONNECTED, onSlippiConnected);
        resolve();
      };

      bridge.on(BridgeEvent.SLIPPI_CONNECTED, onSlippiConnected);
    });

    const relayConnectPromise = new Promise<ConnectResult>((resolve, _reject) => {
      const onRelayConnected = (data: string) => {
        bridge.removeListener(BridgeEvent.RELAY_CONNECTED, onRelayConnected);
        const parsed: RelayConnectionInfoJson = JSON.parse(data);

        const connectionInfo: RelayConnectionInfo = {
          bridgeId: parsed.bridge_id,
          streamIds: parsed.stream_ids
        };

        resolve({ data: connectionInfo, error: null });
      };

      bridge.on(BridgeEvent.RELAY_CONNECTED, onRelayConnected);
    });

    // Initiate connection
    bridge.connectToRelayServer(relayWsUrl);

    // TODO: Make promiseTimeout not throw
    try {
      await promiseTimeout(SLIPPI_CONNECTION_TIMEOUT_MS, slippiConnectionPromise);
    } catch {
      return { data: null, error: ConnectResultError.SLIPPI_CONNECT_ERROR };
    }

    return promiseTimeout(RELAY_CONNECTION_TIMEOUT_MS, relayConnectPromise)
      .catch(() => ({ data: null, error: ConnectResultError.RELAY_CONNECT_ERROR }));
  }

  public onDisconnect(callback: (reason: DisconnectReason) => void) {
    this.disconnectCallback = callback;
  }

  public quit() {
    if (this.bridge) {
      this.bridge.quit();
    }
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

function createPacket(streamId: number, data: Uint8Array): Buffer {
  // Create 8-byte header: stream ID (4 bytes) + data size (4 bytes)
  const headerBuffer = Buffer.alloc(8);
  headerBuffer.writeUInt32LE(streamId, 0);
  headerBuffer.writeUInt32LE(data.length, 4);

  return Buffer.concat([headerBuffer, data]);
}
