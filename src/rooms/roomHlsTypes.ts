// Logical (decision-only) types for the room-owned HLS state machine.
// No mediasoup/ffmpeg objects belong here: these must stay testable
// without a Worker, Router or ffmpeg process.
//
// Emitter contract: emitters must update the producer registry BEFORE
// emitting VIDEO_ADDED / VIDEO_CLOSED.

export type RoomHlsStatus =
  | 'idle' // no HLS pipeline exists
  | 'starting' // START effect in flight (pipeline creation)
  | 'active' // pipeline streaming, source bound
  | 'switching' // SWITCH effect in flight (replacing the source)
  | 'stopping' // STOP effect in flight (pipeline teardown)
  | 'failed'; // last START/SWITCH failed and was cleaned up

export interface RoomHlsState {
  roomId: string;
  status: RoomHlsStatus;

  // The selected video source, or the target we are starting/switching
  // toward. null = deliberately no source (idle, stopping, failed).
  sourceProducerId: string | null;

  // Increments on every START/SWITCH/STOP decision. The executor must
  // reject async completions whose generation does not match, so a
  // stale result can never clobber a newer pipeline.
  generation: number;

  // Durable tombstone: every producer named by a VIDEO_CLOSED event is
  // permanently unselectable for this room, even if a registry snapshot
  // still lists it.
  closedProducerIds: string[];
}

export interface VideoCandidate {
  // Only video producers can ever be HLS candidates; the producer registry
  // must filter when building candidates.
  kind: 'video';
  producerId: string;
  createdAt: number;

  // Reserved for the master-sharer feature (Phase C); selection
  // currently ignores it, so it stays optional.
  role?: 'participant' | 'admin' | 'broadcaster';
  paused?: boolean
}

export type RoomHlsEvent =
  | {
      type: 'VIDEO_ADDED';
      roomId: string;
      producerId: string;
    }
  | {
      type: 'VIDEO_CLOSED';
      roomId: string;
      producerId: string;
    };

export type RoomHlsAction =
  | {
      type: 'START';
      producerId: string;
    }
  | {
      type: 'SWITCH';
      producerId: string;
    }
  | {
      type: 'STOP';
    }
  | {
      type: 'NOOP';
    };

// Lives here (not in roomManager) so the handlers can import it without
// a circular module dependency: roomManager -> handlers -> types.
export interface HlsDecision {
  nextState: RoomHlsState;
  action: RoomHlsAction;
}

// Ports the coordinator depends on. Implementations live outside the
// decision layer (ProducerManager, StreamManager, a broadcast adapter).
export interface VideoSourceCatalog {
  // Current video candidates for a room. The implementation must update
  // the producer registry BEFORE emitting events (emitter contract).
  listVideoCandidates(roomId: string): VideoCandidate[];
}

export interface RoomHlsPipeline {
  // Effects. Resolve on success; reject on failure — never swallow.
  // Every effect must clean up the previous pipeline (controlled restart).
  start(roomId: string, sourceProducerId: string, generation: number): Promise<void>;
  switchSource(roomId: string, sourceProducerId: string, generation: number): Promise<void>;
  stop(roomId: string, generation: number): Promise<void>;
}

export interface RoomHlsNotifier {
  // available: broadcast hlsStreamAvailable (the adapter builds the playlist URL from env).
  // unavailable: broadcast hlsStreamUnavailable.
  available(roomId: string): Promise<void>;
  unavailable(roomId: string): Promise<void>;
}
