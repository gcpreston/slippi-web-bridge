import {
  Connection,
  DolphinConnection,
  ConsoleConnection,
  ConnectionEvent,
  ConnectionStatus
} from "@slippi/slippi-js";
import { promiseTimeout } from "./util";

const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;

/**
 * A StreamAdapter is any object to receive Slippi stream data. Any potential
 * connection parameters (URLs, ports, etc) should be taken in the constructor.
 *
 * The connect method is called by SlippiConnection's connect method, after
 * Slippi itself is connected, and the receive method is called whenever there
 * is a new packet to be processed.
 *
 * We consider that in the case of an unrecoverable adapter disconnect, the
 * entire bridge disconnects and exits. For this reason, connect is passed
 * a function calls back to the bridge to disconnect. This should be invoked
 * if/when the adapter goes down. Each adapter is also expected to provide a
 * method to shut itself down. The purpose of this is to be called by the
 * bridge for a graceful exit, and does not need to be called by the adapter
 * itself during its own shutdown.
 */
export interface IStreamAdapter {
  connectionTimeoutMs: number;
  connect(disconnectBridge: () => void): Promise<void>;
  receive(data: Buffer): void;
  disconnect(): void;
}

type SlippiConnectionType = "dolphin" | "console";

export class SlippiConnection {
  private slippiConn: Connection;
  private adapters: IStreamAdapter[];

  // events to send upon client connection
  private eventPayloadsBinary?: Buffer;
  private gameStartBinary?: Buffer;

  constructor(connType: SlippiConnectionType) {
    switch (connType) {
      case "dolphin":
        this.slippiConn = new DolphinConnection();
        break;
      case "console":
        this.slippiConn = new ConsoleConnection();
        break;
    }

    this.slippiConn.on(ConnectionEvent.DATA, (b: Buffer) => {
      for (const adapter of this.adapters) {
        adapter.receive(b);
      }
    });
  }

  // TODO: Does the logic for connecting adapters and forwarding data to them
  //   want to be handled by another class? Right now it feels like this class
  //   is doing 2 things: managing the slippi connection, and acting like the
  //   glue. The glue can be its own class, a Bridge maybe :)

  public async connect(slippiAddr: string, slippiPort: number): Promise<void[]> {
    await promiseTimeout(SLIPPI_CONNECTION_TIMEOUT_MS, this._connectToSlippi(slippiAddr, slippiPort));

    const connectPromises: Promise<void>[] = [];
    for (const adapter of this.adapters) {
      connectPromises.push(
        promiseTimeout(
          adapter.connectionTimeoutMs,
          adapter.connect(this._disconnect).then(() => {
            this._sendCurrentGameInfo(adapter);
          })
        )
      );
    }

    return Promise.all(connectPromises);
  }

  public pipeTo(adapter: IStreamAdapter): void {
    this.adapters.push(adapter);
  }

  private _disconnect(): void {
    for (const adapter of this.adapters) {
      adapter.disconnect();
    }
    this.slippiConn.disconnect();
  }

  private _connectToSlippi(slippiAddr: string, slippiPort: number): Promise<void> {
    return new Promise((resolve, reject) => {
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
            reject(new Error(`Disconnected from Slippi: ${slippiAddr}:${slippiPort}`));
            break;
        }
      });

      this.slippiConn.connect(slippiAddr, slippiPort);
    });
  }

  private _sendCurrentGameInfo(adapter: IStreamAdapter): void {
    if (this.eventPayloadsBinary && this.gameStartBinary) {
      adapter.receive(Buffer.concat([this.eventPayloadsBinary, this.gameStartBinary]));
    }
  }
}
