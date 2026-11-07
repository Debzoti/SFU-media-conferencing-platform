// Logical (decision-only) types for the room-owned HLS state machine.
// No mediasoup/ffmpeg objects belong here: these must stay testable
// without a Worker, Router or ffmpeg process.

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
}

export interface VideoCandidate {
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
