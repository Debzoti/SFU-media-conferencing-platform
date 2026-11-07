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


    const producer = await transport.produce({ // async call: need to wait here for the producer to be created
      kind,
      rtpParameters,
      appData: { wsId },
    });

    this.producers.set(producer.id, producer);
    this.producerOwner.set(producer.id, wsId);

    if (this.producerRoom.has(roomId)) { //add to the producer oom if it has a roomId
      this.producerRoom.set(roomId, new Set());
    }
    const isFirstProducer = !this.producerRoom.has(roomId) || this.producerRoom.get(roomId)!.size === 0;
    this.producerRoom.get(roomId)?.add(producer.id);

    // start hls if its the first producer--> its ditched bro  
    if (isFirstProducer) {
      try {
        await this.streamManager.startHLSStream(roomId, producer, this.workerManager.getRouter());
        log.info({ roomId }, 'started HLS for room');
      } catch (error) {
        log.error({ err: error, roomId }, 'failed to start HLS for room');
      }

      const hlsStreamAvailableMsg: HLSStreamAvailableMessege = {
        type: 'hlsStreamAvailable',
        roomId: roomId,
        playlistUrl: `${env.serverUrl}/hls/${roomId}/playlist.m3u8`,
      };
      broadcastToRoom(wss, rooms, roomId, hlsStreamAvailableMsg);
    }

    producer.on('transportclose', () => {
      log.debug({ producerId: producer.id }, "Producer's transport closed, closing producer");
      producer.close();
      this.producers.delete(producer.id);
      this.producerOwner.delete(producer.id);
      this.producerRoom.get(roomId)?.delete(producer.id);
    });

    log.info({ producerId: producer.id, transportId: transport.id, peerId: wsId, roomId }, 'Producer created');

    return { id: producer.id, kind: producer.kind };
  }

  // producers already live in a room (so a late joiner can consume them),
  // skipping the ones owned by `excludeWsId` (a peer never consumes its own media)
  getRoomProducers(roomId: string, excludeWsId: string) {
    const result: { producerId: string; producerSocketId: string; kind: mediasoupTypes.MediaKind }[] = [];
    for (const producerId of this.producerRoom.get(roomId) ?? []) {
      const ownerWsId = this.producerOwner.get(producerId);
      const producer = this.producers.get(producerId);
      if (!producer || !ownerWsId || ownerWsId === excludeWsId) continue;
      result.push({ producerId, producerSocketId: ownerWsId, kind: producer.kind });
    }
    return result;
  }

  // close all producers owned by a peer; stops HLS if this was the room's last producer
  /*
  TODO: a bug here details
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   `handleDisconnect` calls `transportManager.cleanupPeer(ws.id)` first, then `await producerManager.cleanupPeer(...)`.
   Closing a transport makes each of its producers emit `transportclose`, whose handler (in `produce`) deletes the producer
   from `producers` and `producerOwner`. Assuming that emit is synchronous, what does `producerManager.cleanupPeer` then do
   for that peer?

   ✗ 1. Loops over the peer's producers as usual, closes them again, and stops HLS when the room empties
     2. Stops HLS anyway, because the room's peer list is empty after the disconnect
   ✓ 3. Finds no entries in producerOwner, so producerRoom still holds the ids and HLS is never stopped
     4. Throws because producer.close() is called on an already-closed producer

   ✗ Incorrect.
   Correct answer: 3. Finds no entries in producerOwner, so producerRoom still holds the ids and HLS is never stopped

   The loop iterates producerOwner, which the transportclose handler already emptied. producerRoom (never touched by that
   handler) still has the ids, so size stays > 0 and stopHLSStream never runs. A likely real bug to fix when you resume.
  */
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
        type: 'hlsStreamUnavailable',
        roomId: roomId,
      };
      await broadcastToRoom(wss, rooms, roomId, hlsUnAvailMsg);
    }
  }
}
