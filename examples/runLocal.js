const { Bridge, BridgeEvent } = require("../dist/index.js");

// The websocket URL SpectatorMode
const LOCAL_WS_URL = "ws://localhost:4000/bridge_socket/websocket";

const bridge = new Bridge();

bridge.on(BridgeEvent.SLIPPI_CONNECTED, () => {
  bridge.connectToRelayServer(LOCAL_WS_URL);
});

bridge.on(BridgeEvent.DISCONNECTED, (reason) => {
  console.log("Disconnected, reason:", reason);
});
