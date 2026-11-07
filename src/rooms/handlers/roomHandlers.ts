import { RoomHlsEvent, RoomHlsState, VideoCandidate, HlsDecision } from "../roomHlsTypes";

/**
 * Oldest-first candidate selection.
 *
 * `excludeProducerId` is the tombstone rule: a producer named by a close
 * event is never selectable again, even if a stale registry snapshot still
 * lists it. `.filter` copies, so the caller's array is never mutated and
 * this stays pure.
 */
export function pickReplacement(
  candidates: VideoCandidate[],
  excludeProducerId?: string
): VideoCandidate | null {
  return (
    candidates
      .filter((candidate) => candidate.producerId !== excludeProducerId)
      .filter(candidate => !candidate.paused)
      .sort((a, b) => a.createdAt - b.createdAt)[0] ?? null
  );
}

/**
 * Handles statuses: 'idle' | 'failed'.
 *
 * No source is bound, so a VIDEO_CLOSED can never require a stop — the
 * room has no pipeline. Only a VIDEO_ADDED can change anything: the
 * oldest live video candidate starts a new session.
 */
export function handleIdle(
  state: RoomHlsState,
  event: RoomHlsEvent,
  candidates: VideoCandidate[]
): HlsDecision {
  if (event.type !== 'VIDEO_ADDED') {
    return { nextState: state, action: { type: 'NOOP' } };
  }

  const replacement = pickReplacement(candidates);
  if (!replacement) {
    return { nextState: state, action: { type: 'NOOP' } };
  }

  return {
    nextState: {
      ...state,
      status: 'starting',
      sourceProducerId: replacement.producerId,
      generation: state.generation + 1,
    },
    action: { type: 'START', producerId: replacement.producerId },
  };
}

/**
 * Handles statuses: 'starting' | 'active' | 'switching'.
 *
 * These three share the same transitions because in all of them a source
 * is bound (or targeted): only the death of THAT source changes the
 * decision. Everything else is NOOP.
 */
export function handleActive(
  state: RoomHlsState,
  event: RoomHlsEvent,
  candidates: VideoCandidate[]
): HlsDecision {
  if (event.type !== 'VIDEO_CLOSED') {
    return { nextState: state, action: { type: 'NOOP' } };
  }

  // A close of some other producer never affects the bound source.
  if (event.producerId !== state.sourceProducerId) {
    return { nextState: state, action: { type: 'NOOP' } };
  }

  // Tombstone rule: exclude by the event's producer id, not the state's —
  // the event is the authoritative fact even if the registry lags.
  const replacement = pickReplacement(candidates, event.producerId);

  if (replacement) {
    return {
      nextState: {
        ...state,
        status: 'switching',
        sourceProducerId: replacement.producerId,
        generation: state.generation + 1,
      },
      action: { type: 'SWITCH', producerId: replacement.producerId },
    };
  }

  // Source died and nobody is left: the pipeline MUST be torn down.
  // The executor flips 'stopping' -> 'idle' once teardown completes.
  return {
    nextState: {
      ...state,
      status: 'stopping',
      sourceProducerId: null,
      generation: state.generation + 1,
    },
    action: { type: 'STOP' },
  };
}
