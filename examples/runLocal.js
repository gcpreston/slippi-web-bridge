const { Bridge } = require("../dist/index.js");

// The websocket URL SpectatorMode
const LOCAL_WS_URL = "ws://localhost:4000/bridge_socket/websocket";

const bridge = new Bridge();

bridge.onDisconnect((reason) => {
  console.log("Disconnected, reason:", reason);
});

bridge.connect(LOCAL_WS_URL);
