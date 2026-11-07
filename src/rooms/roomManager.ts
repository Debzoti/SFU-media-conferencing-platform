import {
  RoomHlsEvent,
  RoomHlsState,
  VideoCandidate,
  HlsDecision,
} from "./roomHlsTypes";
import { handleActive, handleIdle } from "./handlers/roomHandlers";

/**
 * Pure HLS policy for one room.
 *
 * Given the room's current logical state, a producer lifecycle event and
 * the current video candidates, decide the next state and the action the
 * pipeline executor must perform. No mediasoup or ffmpeg calls in here —
 * that is the executor's job.
 */
export class RoomManager {
  decideHlsForRoom(
    state: RoomHlsState,
    event: RoomHlsEvent,
    candidates: VideoCandidate[]
  ): HlsDecision {
    // Events for another room never affect this room.
    if (state.roomId !== event.roomId) {
      return { nextState: state, action: { type: 'NOOP' } };
    }

    switch (state.status) {
      // No pipeline exists, or the last one failed and was cleaned up:
      // the oldest live video candidate may start a new one.
      case 'idle':
      case 'failed':
        return handleIdle(state, event, candidates);

      // A source is bound or targeted: only its death changes anything.
      case 'starting':
      case 'active':
      case 'switching':
        return handleActive(state, event, candidates);

      // Teardown is already in flight: nothing can be decided until the
      // executor flips the room back to 'idle'.
      case 'stopping':
        return { nextState: state, action: { type: 'NOOP' } };
    }
  }
}
