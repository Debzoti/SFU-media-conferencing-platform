import type { WebSocketServer } from 'ws';
import { broadcastToRoom } from 'src/signalling/handlers';
import { RoomHlsNotifier } from 'src/rooms/roomHlsTypes';
import { HLSStreamAvailableMessege, HLSUnavailable } from 'src/config/config';
import { env } from 'src/config/binding';

// Adapter: the coordinator's RoomHlsNotifier port over broadcastToRoom.
export class RoomHlsNotifierAdapter implements RoomHlsNotifier {
  constructor(
    private wss: WebSocketServer,
    private rooms: { [roomId: string]: { id: string; name: string }[] }
  ) {}

  async available(roomId: string): Promise<void> {
    const message: HLSStreamAvailableMessege = {
      type: 'hlsStreamAvailable',
      roomId,
      playlistUrl: `${env.serverUrl}/hls/${roomId}/playlist.m3u8`,
    };
    await broadcastToRoom(this.wss, this.rooms, roomId, message);
  }

  async unavailable(roomId: string): Promise<void> {
    const message: HLSUnavailable = { type: 'hlsStreamUnavailable', roomId };
    await broadcastToRoom(this.wss, this.rooms, roomId, message);
  }
}
