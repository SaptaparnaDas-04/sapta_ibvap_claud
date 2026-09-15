/**
 * Minimal WebRTC signaling client for a 1-to-1 phone-to-laptop video relay.
 *
 * This is real peer-to-peer video: once connected, the video frames flow
 * directly between the two devices (phone -> laptop), not through any
 * server. The signaling-server/ (a tiny WebSocket relay) is only needed for
 * the few seconds it takes both sides to exchange connection info — it
 * never sees the video itself.
 *
 * Works reliably on the same Wi-Fi / LAN. Across different networks (phone
 * on mobile data, laptop elsewhere) it may fail without a TURN server —
 * that's a deliberate scope cut, noted in the README.
 */

export type RelayRole = "broadcaster" | "viewer";

interface RelayHandlers {
  onStatus?: (status: string) => void;
  onStream?: (stream: MediaStream) => void; // fires on the viewer side
  onPeerJoined?: () => void;
  onPeerLeft?: () => void;
}

export function getSignalingUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const port = import.meta.env["VITE_SIGNALING_PORT"] || "8090";
  return `${proto}//${window.location.hostname}:${port}`;
}

export class RelayConnection {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;

  constructor(
    private room: string,
    private role: RelayRole,
    private handlers: RelayHandlers,
  ) {}

  connect(localStream?: MediaStream) {
    let ws: WebSocket;
    try {
      ws = new WebSocket(getSignalingUrl());
    } catch {
      this.handlers.onStatus?.("Could not reach the relay server.");
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.handlers.onStatus?.("Connected to relay — waiting for the other device…");
      this.send({ type: "join", room: this.room, role: this.role });
    };

    ws.onmessage = (event) => {
      void this.handleMessage(event, localStream);
    };

    ws.onerror = () => {
      this.handlers.onStatus?.(
        "Could not reach the relay server — make sure signaling-server is running.",
      );
    };
  }

  private async handleMessage(event: MessageEvent, localStream?: MediaStream) {
    let msg: any;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "peer-ready") {
      this.handlers.onPeerJoined?.();
      if (this.role === "broadcaster" && localStream) {
        await this.createOffer(localStream);
      }
    } else if (msg.type === "offer") {
      await this.handleOffer(msg.sdp);
    } else if (msg.type === "answer") {
      await this.pc?.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      this.handlers.onStatus?.("Connected — streaming live to the paired screen.");
    } else if (msg.type === "candidate" && msg.candidate) {
      try {
        await this.pc?.addIceCandidate(msg.candidate);
      } catch {
        /* stray/late candidates are safe to ignore */
      }
    } else if (msg.type === "peer-left") {
      this.handlers.onPeerLeft?.();
      this.handlers.onStatus?.("The other device disconnected.");
    }
  }

  private ensurePeerConnection() {
    if (this.pc) return this.pc;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: "candidate", room: this.room, candidate: e.candidate });
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) this.handlers.onStream?.(e.streams[0]);
    };
    this.pc = pc;
    return pc;
  }

  private async createOffer(stream: MediaStream) {
    const pc = this.ensurePeerConnection();
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: "offer", room: this.room, sdp: offer.sdp });
    this.handlers.onStatus?.("Phone found — connecting video…");
  }

  private async handleOffer(sdp: string) {
    const pc = this.ensurePeerConnection();
    await pc.setRemoteDescription({ type: "offer", sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.send({ type: "answer", room: this.room, sdp: answer.sdp });
    this.handlers.onStatus?.("Phone connected — receiving live video.");
  }

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    this.pc?.getSenders().forEach((s) => s.track?.stop());
    this.pc?.close();
    this.pc = null;
    this.ws?.close();
    this.ws = null;
  }
}
