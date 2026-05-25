import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

interface PartStageTracker {
  form: boolean;
  "2d": boolean;
  "3d": boolean;
}

export function partCompletion(eventBus: IEventBus): void {
  const tracker = new Map<string, PartStageTracker>();

  const key = (quoteId: string, partId: string) => `${quoteId}_${partId}`;

  eventBus.subscribe(EventType.PartFormProcessed, async (event) => {
    if (event.type !== EventType.PartFormProcessed) return;
    const { quoteId, partId } = event.payload;
    const k = key(quoteId, partId);
    const entry = tracker.get(k) || { form: false, "2d": false, "3d": false };
    entry.form = true;
    tracker.set(k, entry);
    checkPartComplete(quoteId, partId, entry, k);
  });

  eventBus.subscribe(EventType.Part2DProcessed, async (event) => {
    if (event.type !== EventType.Part2DProcessed) return;
    const { quoteId, partId } = event.payload;
    const k = key(quoteId, partId);
    const entry = tracker.get(k) || { form: false, "2d": false, "3d": false };
    entry["2d"] = true;
    tracker.set(k, entry);
    checkPartComplete(quoteId, partId, entry, k);
  });

  eventBus.subscribe(EventType.Part3DProcessed, async (event) => {
    if (event.type !== EventType.Part3DProcessed) return;
    const { quoteId, partId } = event.payload;
    const k = key(quoteId, partId);
    const entry = tracker.get(k) || { form: false, "2d": false, "3d": false };
    entry["3d"] = true;
    tracker.set(k, entry);
    checkPartComplete(quoteId, partId, entry, k);
  });

  async function checkPartComplete(
    quoteId: string,
    partId: string,
    entry: PartStageTracker,
    k: string
  ): Promise<void> {
    if (entry.form && entry["2d"] && entry["3d"]) {
      tracker.delete(k);
      await eventBus.publish({
        type: EventType.PartProcessingComplete,
        payload: { quoteId, partId },
      });
    }
  }
}
