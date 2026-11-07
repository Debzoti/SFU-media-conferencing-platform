import {
  RoomHlsState,
  RoomHlsEvent,
  RoomHlsAction,
  VideoSourceCatalog,
  RoomHlsPipeline,
  RoomHlsNotifier,
} from './roomHlsTypes';
import { RoomManager } from './roomManager';

/**
 * Executor coordinator for the room-owned HLS state machine.
 *
 * The decision layer (RoomManager) stays pure; this class owns the live
 * per-room state and serializes the side effects the decisions ask for.
 * All state mutation happens only inside handle() and applyResult().
 *
 * handle() runs synchronously against the decision layer and returns
 * before the effect is performed — the effect is queued per room so a
 * slow pipeline never blocks the next decision. applyResult() reconciles
 * the settled effect against the current generation and discards stale
 * completions.
 */
export class RoomHlsCoordinator {
  private states = new Map<string, RoomHlsState>();
  private queues = new Map<string, Promise<void>>();

  constructor(
    private roomManager: RoomManager,
    private catalog: VideoSourceCatalog,
    private pipeline: RoomHlsPipeline,
    private notifier: RoomHlsNotifier
  ) {}

  async handle(event: RoomHlsEvent): Promise<void> {
    let state = this.states.get(event.roomId);
    if (state === undefined) {
      state = {
        roomId: event.roomId,
        status: 'idle',
        sourceProducerId: null,
        generation: 0,
        closedProducerIds: [],
      };
      this.states.set(event.roomId, state);
    }

    const candidates = this.catalog.listVideoCandidates(event.roomId);
    const decision = this.roomManager.decideHlsForRoom(state, event, candidates);
    this.states.set(event.roomId, decision.nextState);

    if (decision.action.type === 'NOOP') {
      return;
    }

    // Fire-and-forget: the effect is serialized per room, not awaited here.
    this.enqueueEffect(event.roomId, decision.nextState.generation, decision.action);
  }

  private enqueueEffect(roomId: string, generation: number, action: RoomHlsAction): void {
    const prev = this.queues.get(roomId) ?? Promise.resolve();
    const next = prev.then(async () => {
      let ok = true;
      try {
        if (action.type === 'START') {
          await this.pipeline.start(roomId, action.producerId, generation);
        } else if (action.type === 'SWITCH') {
          await this.pipeline.switchSource(roomId, action.producerId, generation);
        } else {
          await this.pipeline.stop(roomId, generation);
        }
      } catch {
        ok = false;
      }
      try {
        await this.applyResult(roomId, generation, ok);
      } catch {
        // Never break the per-room chain: a notification failure must not
        // stall subsequent effects. Errors are surfaced by the notifier.
      }
    });
    this.queues.set(roomId, next);
  }

  private async applyResult(roomId: string, generation: number, ok: boolean): Promise<void> {
    const state = this.states.get(roomId);
    if (!state) {
      return;
    }

    // Stale completion — a newer decision owns the room. Discard it so a
    // late-resolving effect can never clobber the current pipeline.
    if (generation !== state.generation) {
      return;
    }

    if (!ok) {
      this.states.set(roomId, { ...state, status: 'failed', sourceProducerId: null });
      await this.notifier.unavailable(roomId).catch(() => {});
      return;
    }

    if (state.status === 'starting' || state.status === 'switching') {
      this.states.set(roomId, { ...state, status: 'active' });
      await this.notifier.available(roomId).catch(() => {});
      return;
    }

    if (state.status === 'stopping') {
      this.states.set(roomId, { ...state, status: 'idle', sourceProducerId: null });
      await this.notifier.unavailable(roomId).catch(() => {});
    }
  }

  getState(roomId: string): RoomHlsState | undefined {
    return this.states.get(roomId);
  }
}
