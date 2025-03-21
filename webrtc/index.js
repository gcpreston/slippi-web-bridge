var peer = new Peer();
var remoteConn;

peer.on('open', function(id) {
    console.log(id);
});

peer.on('connection', function(conn) {
    makeconn(conn);
})

function connect(id) {
    let conn = peer.connect(id);
    makeconn(conn);
}

function makeconn(conn) {
    remoteConn = conn;
    console.log('connection...');
    conn.on('open', function() {
        conn.on('data', function(data) {
            console.log('Received data:', data);
        });
        conn.send('Hello!');
        console.log('ready');
    });
}

function send(msg) {
  remoteConn.send(msg);
}

window.connect = connect;
window.send = send;
