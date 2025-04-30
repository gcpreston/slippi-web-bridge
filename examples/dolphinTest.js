const { DolphinConnection, Ports, ConnectionEvent, ConnectionStatus } = require("@slippi/slippi-js");

const conn = new DolphinConnection();
conn.connect("127.0.0.1", Ports.DEFAULT);

conn.on(ConnectionEvent.STATUS_CHANGE, (e) => {
  if (e === ConnectionStatus.CONNECTED) {
    console.log("Connected to Dolphin.");

    setTimeout(() => {
      console.log("Disconnecting...");
      conn.disconnect();
    }, 1000);
  }
});
