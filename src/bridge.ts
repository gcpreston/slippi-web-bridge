import {
  Connection,
  DolphinConnection,
  ConsoleConnection,
  ConnectionEvent,
  ConnectionStatus
} from "@slippi/slippi-js";
import { EventEmitter } from "node:events";
import { promiseTimeout } from "./util";

const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;
const DEFAULT_ADAPTER_TIMEOUT_MS = 3000;

/**
 * A StreamAdapter is any object to receive Slippi stream data. Any potential
 * connection parameters (URLs, ports, etc) should be taken in the constructor.
 *
 * The connect method is called by Bridge's connect method, after
 * Slippi itself is connected, and the receive method is called whenever there
 * is a new packet to be processed.
 */
export interface IStreamAdapter {
  readonly name: string;
  readonly connectionTimeoutMs?: number;
  connect(): Promise<void>;
  receive(data: Buffer): void;
  disconnect(): void;
}

type SlippiConnectionType = "dolphin" | "console";

enum SlippiConnectionStatus {
  INITIALIZED,
  CONNECTING,
  CONNECTED,
  DISCONNECTING,
  DISCONNECTED
}

export enum DisconnectReason {
  ADAPTER_TIMEOUT,
  SLIPPI_TIMEOUT,
  SLIPPI_DISCONNECT,
  QUIT
}

export class Bridge extends EventEmitter {
  private slippiConn: Connection;
  private adapters: IStreamAdapter[] = [];
  private status: SlippiConnectionStatus = SlippiConnectionStatus.INITIALIZED;
  private sendBuffer: Buffer[] = [];

  constructor(connType: SlippiConnectionType) {
    super();

    switch (connType) {
      case "dolphin":
        this.slippiConn = new DolphinConnection();
        break;
      case "console":
        this.slippiConn = new ConsoleConnection();
        break;
    }

    this.slippiConn.on(ConnectionEvent.DATA, (b: Buffer) => {
      if (this.status === SlippiConnectionStatus.CONNECTED) {
        for (const adapter of this.adapters) {
          adapter.receive(b);
        }
      } else {
        this.sendBuffer.push(b);
      }
    });
  }

  public async connect(slippiAddr: string, slippiPort: number): Promise<void> {
    this.status = SlippiConnectionStatus.CONNECTING;
    promiseTimeout(SLIPPI_CONNECTION_TIMEOUT_MS, this._connectToSlippi(slippiAddr, slippiPort))
      .then(() => {
        this.emit("slippi-connected");

        const connectPromises: Promise<void>[] = [];
        for (const adapter of this.adapters) {
          connectPromises.push(
            promiseTimeout(
              adapter.connectionTimeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS,
              adapter.connect()
            )
          );
        }

        return Promise.all(connectPromises)
          .then(() => {
            this.status = SlippiConnectionStatus.CONNECTED;
            for (const adapter of this.adapters) {
              if (this.sendBuffer.length > 0) {
                // TODO: This doesn't work with reconnects that are handled
                // within SpectatorModeAdapter itself.
                adapter.receive(Buffer.concat(this.sendBuffer));
              }
            }
            this.sendBuffer = [];
            this.emit("open");
          })
          .catch(() => {
            this.disconnect(DisconnectReason.ADAPTER_TIMEOUT);
          });
      })
      .catch(() => {
        this.disconnect(DisconnectReason.SLIPPI_TIMEOUT);
      });
  }

  public pipeTo(adapter: IStreamAdapter): void {
    this.adapters.push(adapter);
  }

  public quit(): void {
    this.disconnect(DisconnectReason.QUIT);
  }

  private disconnect(reason: DisconnectReason): void {
    // TODO: This ends up getting called a second time from the adapter
    //   disconnect method, and for some reason `this` is undefined.
    if (this && ![SlippiConnectionStatus.DISCONNECTING, SlippiConnectionStatus.DISCONNECTED].includes(this.status)) {
      this.status = SlippiConnectionStatus.DISCONNECTING;
      this.slippiConn.disconnect();

      for (const adapter of this.adapters) {
        adapter.disconnect();
      }
      this.status = SlippiConnectionStatus.DISCONNECTED;
      this.emit("close", reason);
    }
  }

  private _connectToSlippi(slippiAddr: string, slippiPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
      // Handle connection
      this.slippiConn.on(ConnectionEvent.STATUS_CHANGE, (status: ConnectionStatus) => {
        if (status !== ConnectionStatus.CONNECTED && status !== ConnectionStatus.DISCONNECTED) {
          return;
        }

        switch (status) {
          case ConnectionStatus.CONNECTED:
            console.log("Connected to Slippi.");
            resolve();
            break;
          case ConnectionStatus.DISCONNECTED:
            this.disconnect(DisconnectReason.SLIPPI_DISCONNECT);
            reject(new Error(`Disconnected from Slippi: ${slippiAddr}:${slippiPort}`));
            break;
        }
      });

      // Try to connect
      this.slippiConn.connect(slippiAddr, slippiPort);
    });
  }
}
