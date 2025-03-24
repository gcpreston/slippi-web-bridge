const { DolphinConnection } = require('@slippi/slippi-js');

import {
  ConnectionStatus,
  ConnectionEvent,
  Connection, SlpStream,
  SlpStreamMode,
  SlpStreamEvent,
  Command,
  SlpRawEventPayload
} from '@slippi/slippi-js';
import { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { Socket } from 'phoenix-channels';

const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;

function bufferToArrayBuffer(b: Buffer) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

export class Relay {
  // Most basic cases to start
  // only Dolphin connection
  private slippiConnection: Connection = new DolphinConnection();
  private slpStream: SlpStream = new SlpStream({ mode: SlpStreamMode.MANUAL });
  private currentGameMetadata: {
    messageSizes: Buffer,
    gameStart?: Buffer
  } | undefined;
  // TODO: Manage closing of one connection with the other (or whatever is desired)
  private wsServer: WebSocketServer | undefined;

  private phoenixChannel: any;

  public start(slippiAddress: string, slippiPort: number, phoenixUrl: string): Promise<void> {
    const slippiConnectionPromise = this.startSlippiConnection(slippiAddress, slippiPort)
      .then(() => this.startPhoenixConnection(phoenixUrl));

    this.slippiConnection.on(ConnectionEvent.DATA, (b: Buffer) => {
      this.phoenixChannel.push("game_data", bufferToArrayBuffer(b));
      this.slpStream.write(b);
    });

    this.slpStream.on(SlpStreamEvent.RAW, (data: SlpRawEventPayload) => {
      const { command, payload } = data;
      switch (command) {
        case Command.MESSAGE_SIZES:
          console.log('Reveived MESSAGE_SIZES event.');
          this.currentGameMetadata = { messageSizes: payload };
          break;
        case Command.GAME_START:
          console.log('Reveived GAME_START event.');
          this.currentGameMetadata!.gameStart = payload;
          break;
        case Command.GAME_END:
          console.log('Reveived GAME_END event.');
          this.currentGameMetadata!.gameStart = undefined;
          break;
      }
    });

    return slippiConnectionPromise;
  }

  private startPhoenixConnection(phoenixUrl: string): void {
    let socket = new Socket(phoenixUrl);

    socket.connect();

    // Now that you are connected, you can join channels with a topic:
    this.phoenixChannel = socket.channel("bridges", { hello: 'world' });
    this.phoenixChannel.join()
      .receive("ok", (resp: any) => {
        console.log("Joined successfully", resp);

        if (this.currentGameMetadata) {
          const meta = [this.currentGameMetadata.messageSizes];
          if (this.currentGameMetadata.gameStart) {
           meta.push(this.currentGameMetadata.gameStart!);
          }
          this.phoenixChannel.push("game_data", bufferToArrayBuffer(Buffer.concat(meta)));
        }
      })
      .receive("error", (resp: any) => { console.log("Unable to join", resp) });
  }

  private startWebSocketServer(wsPort: number): void {
    this.wsServer = new WebSocketServer({ port: wsPort });
    console.log('Serving WebSocket server on port', wsPort);

    this.wsServer.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      console.log('Incoming WebSocket connection from', req.socket.remoteAddress);
      ws.onerror = console.error;

      if (this.currentGameMetadata) {
        const meta = [this.currentGameMetadata.messageSizes];
        if (this.currentGameMetadata.gameStart) {
         meta.push(this.currentGameMetadata.gameStart!);
        }
        ws.send(Buffer.concat(meta));
      }
    });
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
            console.log('Connected to Slippi.');
            resolve();
            break;
          case ConnectionStatus.DISCONNECTED:
            reject(new Error(`Failed to connect to: ${slippiAddress}:${slippiPort}`));
            break;
        }
      };
      this.slippiConnection.on(ConnectionEvent.STATUS_CHANGE, onStatusChange);

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
  const timeout = new Promise((resolve, reject): void => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`Timed out after ${ms}ms.`));
    }, ms);
  });

  // Returns a race between our timeout and the passed in promise
  return Promise.race([promise, timeout]) as Promise<T>;
};
