import { SlippiConnection, SpectatorModeAdapter, IStreamAdapter, Ports } from "../dist/index.js";
import { SlpStream, SlpStreamMode, SlpStreamEvent, SlpCommandEventPayload, Command } from "@slippi/slippi-js";

class LocalAdapter implements IStreamAdapter {
  private slpStream = new SlpStream({ mode: SlpStreamMode.AUTO });

  constructor() {
    this.slpStream.on(SlpStreamEvent.COMMAND, (data: SlpCommandEventPayload) => {
      const { command, payload } = data;

      switch (command) {
        case Command.GAME_START:
          console.log("Game start:", payload);
          break;
        case Command.GAME_END:
          console.log("Game end");
          break;
      }
    });
  }

  public async connect(_disconnect) {} // nothing to do
  public disconnect() {} // nothing to do

  public receive(packet: Buffer) {
    this.slpStream.write(packet);
  }
}

const conn = new SlippiConnection("dolphin");
const relayAdapter = new SpectatorModeAdapter("ws://localhost:4000/bridge_socket/websocket");
const localAdapter = new LocalAdapter();

conn.pipeTo(relayAdapter);
conn.pipeTo(localAdapter);

conn.connect("127.0.0.1", Ports.DEFAULT); // calls connect() on each adapter afterwards

setTimeout(() => {
  console.log("Disconnecting...");
  conn.disconnect();
}, 10000);
