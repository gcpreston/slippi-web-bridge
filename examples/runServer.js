const { Bridge, BridgeEvent } = require("../dist/index.js");

const bridge = new Bridge();

bridge.on(BridgeEvent.DISCONNECTED, () => {
  process.exit();
});
