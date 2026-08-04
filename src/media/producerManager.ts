import { WebSocketServer } from "src/typings/ws";
import { types as mediasoupTypes } from "mediasoup";
import { childLogger } from "src/tools/logger";
import { StreamManager } from "./streamManager";
import { HLSStreamAvailableMessege, HLSUnavailable } from "src/config/config";
import { broadcastToRoom } from "src/signalling/handlers";
import { env } from "src/config/binding";
import { TransportManager } from "./transportManager";
import { WorkerManager } from "./workerManager";

const log = childLogger("media");

export class ProducerManager {
  //map producer id to socket id  
  // roomId -> Set of producer ids in that room
  private producers = new Map<string, mediasoupTypes.Producer<mediasoupTypes.AppData>>();
  private producerRoom = new Map<string, Set<string>>();
  private producerOwner = new Map<string, string>();

  constructor(
    private transportManager: TransportManager,
    private workerManager: WorkerManager,
    private streamManager: StreamManager
  ) { }

  async produce(
    wsId: string,
    transportId: string,
    rtpParameters: mediasoupTypes.RtpParameters,
    kind: mediasoupTypes.MediaKind,
    roomId: string,
    wss: WebSocketServer,
    rooms: { [roomId: string]: { id: string; name: string }[] }
  ) {
    const transport = this.transportManager.getTransport(transportId);
    if (!transport) {
      throw new Error('Transport not found');
    }

    const isFirstProducer = !this.producerRoom.has(roomId) || this.producerRoom.get(roomId)!.size === 0;

    const producer = await transport.produce({
      kind,
      rtpParameters,
      appData: { wsId },
    });

    this.producers.set(producer.id, producer);
    this.producerOwner.set(producer.id, wsId);

    if (!this.producerRoom.has(roomId)) {
      this.producerRoom.set(roomId, new Set());
    }
    this.producerRoom.get(roomId)?.add(producer.id);

    // start hls if its the first producer
    if (isFirstProducer) {
      try {
        await this.streamManager.startHLSStream(roomId, producer, this.workerManager.getRouter());
        log.info({ roomId }, 'started HLS for room');
      } catch (error) {
        log.error({ err: error, roomId }, 'failed to start HLS for room');
      }

      const hlsSteamAvailableMsg: HLSStreamAvailableMessege = {
        type: 'hlsSteamAvailable',
        roomId: roomId,
        playlistUrl: `${env.serverUrl}/hls/${roomId}/playlist.m3u8`,
      };
      broadcastToRoom(wss, rooms, roomId, hlsSteamAvailableMsg);
    }

    producer.on('transportclose', () => {
      log.debug({ producerId: producer.id }, "Producer's transport closed, closing producer");
      producer.close();
      this.producers.delete(producer.id);
      this.producerOwner.delete(producer.id);
    });

    log.info({ producerId: producer.id, transportId: transport.id, peerId: wsId, roomId }, 'Producer created');

    return { id: producer.id, kind: producer.kind };
  }

  // close all producers owned by a peer; stops HLS if this was the room's last producer
  async cleanupPeer(
    wsId: string,
    roomId: string,
    wss: WebSocketServer,
    rooms: { [roomId: string]: { id: string; name: string }[] }
  ): Promise<void> {
    for (const [producerId, ownerWsId] of this.producerOwner.entries()) {
      if (ownerWsId === wsId) {
        const producer = this.producers.get(producerId);
        if (producer) {
          producer.close();
          this.producers.delete(producerId);
          this.producerOwner.delete(producerId);
          this.producerRoom.get(roomId)?.delete(producerId);
          log.info({ producerId, peerId: wsId, roomId }, 'Producer closed');
        }
      }
    }

    if (this.producerRoom.get(roomId)?.size === 0) {
      log.info({ roomId }, 'last producer leaving, stopping HLS');
      await this.streamManager.stopHLSStream(roomId);
      this.producerRoom.delete(roomId);

      const hlsUnAvailMsg: HLSUnavailable = {
        type: 'hlsUnavailable',
        roomId: roomId,
      };
      await broadcastToRoom(wss, rooms, roomId, hlsUnAvailMsg);
    }
  }
}