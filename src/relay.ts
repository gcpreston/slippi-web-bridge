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
import { Socket } from 'phoenix-channels';

const SLIPPI_CONNECTION_TIMEOUT_MS = 3000;

function bufferToArrayBuffer(b: Buffer) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

type Metadata = {
  messageSizes: Buffer,
  gameStart?: Buffer
};

function createMetadataBuffer(meta: Metadata): Buffer {
  const b = [meta.messageSizes];
  if (meta.gameStart) {
    b.push(meta.gameStart!);
  }
  return Buffer.concat(b);
}

export class Relay {
  // Most basic cases to start
  // only Dolphin connection
  private slippiConnection: Connection = new DolphinConnection();
  private slpStream: SlpStream = new SlpStream({ mode: SlpStreamMode.AUTO });
  private currentGameMetadata: Metadata | undefined;
  // TODO: Manage closing of one connection with the other (or whatever is desired)

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
      let metadataBuffer = null;
      switch (command) {
        case Command.MESSAGE_SIZES:
          console.log('Reveived MESSAGE_SIZES event.');
          this.currentGameMetadata = { messageSizes: payload };
          break;
        case Command.GAME_START:
          console.log('Reveived GAME_START event.');
          this.currentGameMetadata!.gameStart = payload;
          metadataBuffer = createMetadataBuffer(this.currentGameMetadata!)
          this.phoenixChannel.push("metadata", bufferToArrayBuffer(metadataBuffer));
          break;
        case Command.GAME_END:
          console.log('Reveived GAME_END event.');
          this.currentGameMetadata!.gameStart = undefined;
          metadataBuffer = createMetadataBuffer(this.currentGameMetadata!)
          this.phoenixChannel.push("metadata", bufferToArrayBuffer(metadataBuffer));
          break;
      }
    });

    return slippiConnectionPromise;
  }

  private startPhoenixConnection(phoenixUrl: string): void {
    let socket = new Socket(phoenixUrl);

    socket.connect();

    const bridgeId = "test_bridge"
    this.phoenixChannel = socket.channel("bridges", { bridge_id: bridgeId });
    console.log('Connecting bridge', bridgeId);
    this.phoenixChannel.join()
      .receive("ok", (resp: any) => {
        console.log("Joined successfully", resp);

        if (this.currentGameMetadata) {
          const metadataBuffer = createMetadataBuffer(this.currentGameMetadata);
          console.log('sending metadata', this.currentGameMetadata);
          this.phoenixChannel.push("metadata", bufferToArrayBuffer(metadataBuffer));
        }
      })
      .receive("error", (resp: any) => { console.log("Unable to join", resp) });
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
