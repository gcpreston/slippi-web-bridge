# slippi-web-bridge

Forward Slippi spectate streams to [SpectatorMode](https://spectatormode.tv).

## Usage

`npm i slippi-web-bridge`

```js
import { Bridge } from "slippi-web-bridge";
const bridge = new Bridge();

// Set actions upon disconnect
bridge.onDisconnect(reason => console.log("Disconnected, reason:", reason));

// Connect and stream to a local instance of SpectatorMode
bridge.connect("ws://localhost:4000/bridge_socket/websocket");

// Manually disconnect
bridge.quit();
```
