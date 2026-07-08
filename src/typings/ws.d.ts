
import { WebSocket } from "ws";
import type { Logger } from "pino";

declare module "ws" {
  interface WebSocket {
    id: string; // Optional property to store a unique identifier for the WebSocket connection
    log?: Logger; // Per-connection child logger, bound with peerId (and roomId once joined)
    WebsocketServer: typeof WebSocketServer;
  }

}

interface WebSocketWithId extends WebSocket {
  id: string; // Unique identifier for the WebSocket connection
  log?: Logger; // Per-connection child logger, bound with peerId (and roomId once joined)
}



export { WebSocket,  WebSocketWithId , WebSocketServer };
export default WebSocket;
export as namespace WebSocket;
export * from "ws";