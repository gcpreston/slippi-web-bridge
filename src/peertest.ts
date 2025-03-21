import { Peer } from 'peerjs';
import { Ports } from '@slippi/slippi-js';
const { DolphinConnection } = require('@slippi/slippi-js');

const peer = new Peer();

peer.on('open', (id: string) => {
  console.log('Peer created:', id);
});

peer.on('connection', (conn) => {
	conn.on('data', (data) => {
		console.log('Received PeerJS data:', data);
	});
	conn.on('open', () => {
		console.log('Opened PeerJS connection');
	});
});

// Create slippi conn to keep it running lol
const slippiConnection = new DolphinConnection();
slippiConnection.connect('127.0.0.1', Ports.DEFAULT);
