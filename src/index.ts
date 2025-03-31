import { Ports } from '@slippi/slippi-js';
import { Relay } from './relay';

const SLIPPI_ADDRESS = '127.0.0.1';
const SLIPPI_PORT = Ports.DEFAULT;

const PHOENIX_URL = 'ws://127.0.0.1:4000/socket';
// const PHOENIX_URL = 'wss://spectator-mode.fly.dev/socket';

const relay = new Relay();
relay.start(SLIPPI_ADDRESS, SLIPPI_PORT, PHOENIX_URL)
