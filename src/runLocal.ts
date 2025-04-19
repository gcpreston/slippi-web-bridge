import { Bridge, SLIPPI_LOCAL_ADDR, SLIPPI_PORTS } from ".";

const LOCAL_WEB = "ws://localhost:4000/bridge_socket/websocket";

const bridge = new Bridge();
bridge.connect(SLIPPI_LOCAL_ADDR, SLIPPI_PORTS.DEFAULT, LOCAL_WEB);
