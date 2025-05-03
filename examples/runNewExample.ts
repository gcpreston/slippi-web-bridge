import { Bridge, SpectatorModeAdapter, IStreamAdapter, Ports } from "../dist/index.js";
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

const bridge = new Bridge("dolphin");
const relayAdapter = new SpectatorModeAdapter("ws://localhost:4000/bridge_socket/websocket");
const localAdapter = new LocalAdapter();

bridge.pipeTo(relayAdapter);
bridge.pipeTo(localAdapter);

bridge.serve("127.0.0.1", Ports.DEFAULT).catch((err) => {
  console.log("Caught an error:", err);
}); // calls connect() on each adapter afterwards

bridge.on("slippi-connected", () => {
  console.log("Slippi connected.");
});

bridge.on("adapter-connected", (adapterName) => {
  console.log("Adapter", adapterName, "connected.");
});

bridge.on("open", () => {
  console.log("Bridge fully connected.");
});

bridge.on("close", (reason) => {
  console.log("Bridge exited with reason:", reason);
});

setTimeout(() => {
  console.log("Disconnecting...");
  bridge.disconnect();
}, 5000);
