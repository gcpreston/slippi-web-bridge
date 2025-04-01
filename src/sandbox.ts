const PHOENIX_URL = 'ws://127.0.0.1:4000/bridge_socket/websocket';

const ws = new WebSocket(PHOENIX_URL + '?bridge_id=test_bridge');

ws.onmessage = (msg) => {
  console.log('reeived', msg);
};

function bufferToArrayBuffer(b: Buffer) {
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

ws.onopen = () => {
  const buf = Buffer.from([53, 0, 0, 60]);
  ws.send(bufferToArrayBuffer(buf));
}
