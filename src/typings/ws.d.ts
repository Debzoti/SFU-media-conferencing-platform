
import { WebSocket } from "ws";

declare module "ws" {
  interface WebSocket {
    id: string; // Optional property to store a unique identifier for the WebSocket connection
    WebsocketServer: typeof WebSocketServer;
  }

}

interface WebSocketWithId extends WebSocket {
  id: string; // Unique identifier for the WebSocket connection
}



export { WebSocket,  WebSocketWithId , WebSocketServer };
export default WebSocket;
export as namespace WebSocket;
export * from "ws";