import { types as mediasoupTypes } from "mediasoup";
import { childLogger } from "src/tools/logger";
import { TransportManager } from "./transportManager";
import { WorkerManager } from "./workerManager";
import { RoomHlsCoordinator } from "src/rooms/roomHlsCoordinator";
import { VideoCandidate, VideoSourceCatalog } from "src/rooms/roomHlsTypes";

const log = childLogger("media");

export class ProducerManager implements VideoSourceCatalog {
  //map producer id to socket id
  // roomId -> Set of producer ids in that room
  private producers = new Map<string, mediasoupTypes.Producer<mediasoupTypes.AppData>>();
  private producerRoom = new Map<string, Set<string>>();
  private producerOwner = new Map<string, string>();
  private producerCreatedAt = new Map<string, number>();
  hlsCoordinator?: RoomHlsCoordinator;

  constructor(
    private transportManager: TransportManager,
    private workerManager: WorkerManager
  ) { }

  async produce(
    wsId: string,
    transportId: string,
    rtpParameters: mediasoupTypes.RtpParameters,
    kind: mediasoupTypes.MediaKind,
    roomId: string
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

    if (!this.producerRoom.has(roomId)) { // create the room's producer set on its first producer
      this.producerRoom.set(roomId, new Set());
    }
    this.producerRoom.get(roomId)?.add(producer.id);

    this.producerCreatedAt.set(producer.id, Date.now());
    await this.hlsCoordinator?.handle({ type: "VIDEO_ADDED", roomId, producerId: producer.id });

    producer.on('transportclose', async () => {
      log.debug({ producerId: producer.id }, "Producer's transport closed, closing producer");
      producer.close();
      this.producers.delete(producer.id);
      this.producerOwner.delete(producer.id);
      this.producerRoom.get(roomId)?.delete(producer.id);
      this.producerCreatedAt.delete(producer.id);
      await this.hlsCoordinator?.handle({ type: "VIDEO_CLOSED", roomId, producerId: producer.id });
    });

    log.info({ producerId: producer.id, transportId: transport.id, peerId: wsId, roomId }, 'Producer created');

    return { id: producer.id, kind: producer.kind };
  }

  // Resolve a producer id to a live VIDEO producer (HLS sources are video-only).
  getVideoProducer(producerId: string): mediasoupTypes.Producer<mediasoupTypes.AppData> | undefined {
      const producer = this.producers.get(producerId);
      return producer && producer.kind === 'video' ? producer : undefined;
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

  // VideoSourceCatalog: current video candidates for a room, for the coordinator.
  listVideoCandidates(roomId: string): VideoCandidate[] {
      const result: VideoCandidate[] = [];
      for (const producerId of this.producerRoom.get(roomId) ?? []) {
          const producer = this.producers.get(producerId);
          if (!producer || producer.kind !== "video") continue;
          result.push({
              kind: "video",
              producerId,
              createdAt: this.producerCreatedAt.get(producerId) ?? 0,
          });
      }
      return result;
  }

  // close all producers owned by a peer; emits VIDEO_CLOSED for each so the
  // coordinator can decide whether to switch/stop the room's HLS pipeline.
  async cleanupPeer(
    wsId: string,
    roomId: string
  ): Promise<void> {
    for (const [producerId, ownerWsId] of this.producerOwner.entries()) {
      if (ownerWsId === wsId) {
        const producer = this.producers.get(producerId);
        if (producer) {
          producer.close();
          this.producers.delete(producerId);
          this.producerOwner.delete(producerId);
          this.producerRoom.get(roomId)?.delete(producerId);
          this.producerCreatedAt.delete(producerId);
          await this.hlsCoordinator?.handle({ type: "VIDEO_CLOSED", roomId, producerId });
          log.info({ producerId, peerId: wsId, roomId }, 'Producer closed');
        }
      }
    }

    if (this.producerRoom.get(roomId)?.size === 0) {
      this.producerRoom.delete(roomId);
    }
  }
}
