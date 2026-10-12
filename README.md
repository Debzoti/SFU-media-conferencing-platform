# p2p-streaming

Video-call rooms with an HLS side-channel, built on a **mediasoup SFU**. (The name is historical — media flows through the server, not peer-to-peer.)

**Three flows:**

| Flow | Carries | Path |
|---|---|---|
| Signalling | JSON control protocol | WebSocket |
| Live media | encrypted RTP | browser → mediasoup WebRtcTransport → each viewer's consumer (forwarded, never transcoded) |
| HLS | H.264 segments | PlainTransport → FFmpeg → `.m3u8`/`.ts` → Express HTTP |

Any peer may publish camera/mic; the room's first video producer is also transcoded to HLS so viewers without WebRTC can watch.

## Run

```bash
pnpm install
pnpm dev            # server + signalling on :3000
```

- Publisher: open `http://localhost:3000/` (mediasoup-client page), join a room, allow camera/mic.
- HLS viewer: `http://localhost:3000/watch.html` (hls.js), enter the room id.
- Docker: `docker compose up --build` (host networking, FFmpeg included; set `ANNOUNCED_IP` to the host IP).

## Stack

Node + TypeScript · mediasoup (SFU) · ws + Express · FFmpeg · pino · mediasoup-client + hls.js in the browser.

## Layout

```
src/media/         Worker/Transport/Producer/Consumer/Stream managers, FFmpeg transcoder
src/signalling/   WebSocket message protocol (handlers.ts)
client/           publisher client (vite-bundled into public/dist)
public/watch.html  HLS viewer
```

## Status

Early MVP: single worker/router, in-memory rooms, video-only HLS. Design rules, known flaws, and the phased plan live in `PROJECT_DIRECTION.md` (kept local, untracked).
