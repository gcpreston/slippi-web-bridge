import { Ports } from '@slippi/slippi-js';
import { Relay } from './relay';

const SLIPPI_ADDRESS = '127.0.0.1';
const SLIPPI_PORT = Ports.DEFAULT;
const WS_PORT = 5197;

const relay = new Relay();
relay.start(SLIPPI_ADDRESS, SLIPPI_PORT, WS_PORT)
