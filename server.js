// signaling-server/server.js
//
// This is the whole "backend" the phone-to-laptop live relay needs. It does
// not see or store any video — it only forwards small JSON messages
// (WebRTC offer/answer/ICE candidates) between the two devices in the same
// room (identified by the pairing PIN shown on /live), so they can agree on
// how to open a direct peer-to-peer video connection.
//
// Run: node server.js   (or npm start)

const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8090;
const wss = new WebSocketServer({ port: PORT });

// room (pin) -> Map(role -> socket), role is "broadcaster" | "viewer"
const rooms = new Map();

wss.on("connection", (ws) => {
  let room = null;
  let role = null;

  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      room = String(msg.room || "");
      role = msg.role === "broadcaster" ? "broadcaster" : "viewer";
      if (!room) return;

      if (!rooms.has(room)) rooms.set(room, new Map());
      rooms.get(room).set(role, ws);

      const peers = rooms.get(room);
      if (peers.size === 2) {
        for (const sock of peers.values()) {
          if (sock.readyState === sock.OPEN) sock.send(JSON.stringify({ type: "peer-ready" }));
        }
      }
      return;
    }

    // Anything else (offer/answer/candidate) just gets relayed to the other
    // peer in the same room — this server never inspects the contents.
    if (!room) return;
    const peers = rooms.get(room);
    if (!peers) return;
    for (const [peerRole, sock] of peers) {
      if (peerRole !== role && sock.readyState === sock.OPEN) sock.send(JSON.stringify(msg));
    }
  });

  ws.on("close", () => {
    if (!room || !role) return;
    const peers = rooms.get(room);
    if (!peers) return;
    peers.delete(role);
    for (const sock of peers.values()) {
      if (sock.readyState === sock.OPEN) sock.send(JSON.stringify({ type: "peer-left" }));
    }
    if (peers.size === 0) rooms.delete(room);
  });
});

console.log(`IBVAP signaling server listening on ws://0.0.0.0:${PORT}`);
