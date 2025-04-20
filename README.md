# slippi-web-bridge

Forward Slippi spectate streams to WebSocket connections.

## Usage

`npm i slippi-web-bridge`

```js
import { Bridge } from "slippi-web-bridge";
const options = {}; // documented below
const bridge = new Bridge(options);
```

The constructor opens a WebSocket server to serve the game data unless the `server: false` options is passed.

The bridge options are:
- `server`:
  * `port`: the port to serve the WebSocket server on (`number`, default `4102`)
- `slippi`:
  * `address`: the address to read Slippi data from (`string`, default `"127.0.0.1"`)
  * `port`: the port to read Slippi data from (`number`, default `Ports.DEFAULT` from slippi-js)
