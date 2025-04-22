const { Bridge, BridgeEvent } = require("../dist/index.js");

// The websocket URL SpectatorMode
const SM_WS_URL = "wss://spectator-mode.fly.dev/bridge_socket/websocket";

const bridge = new Bridge({ server: false });

bridge.on(BridgeEvent.SLIPPI_CONNECTED, () => {
  bridge.connectToRelayServer(SM_WS_URL);
});

bridge.on(BridgeEvent.DISCONNECTED, () => {
  process.exit();
});
