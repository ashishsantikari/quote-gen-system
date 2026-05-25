import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { PendingPartInfo } from "../core/events/types";

const TIMEOUT_MS = 25_000;

interface QuoteState {
  totalParts: number;
  completedParts: Set<string>;
  partStages: Map<string, { form: boolean; "2d": boolean; "3d": boolean }>;
  timer: ReturnType<typeof setTimeout>;
}

export function quoteCompletion(eventBus: IEventBus): void {
  const quotes = new Map<string, QuoteState>();

  eventBus.subscribe(EventType.QuoteCreated, async (event) => {
    if (event.type !== EventType.QuoteCreated) return;
    const { quoteId, parts } = event.payload;

    const partStages = new Map<string, { form: boolean; "2d": boolean; "3d": boolean }>();
    for (const part of parts) {
      partStages.set(part.partId, { form: false, "2d": false, "3d": false });
    }

    const timer = setTimeout(() => handleTimeout(quoteId), TIMEOUT_MS);

    quotes.set(quoteId, {
      totalParts: parts.length,
      completedParts: new Set(),
      partStages,
      timer,
    });
  });

  eventBus.subscribe(EventType.PartFormProcessed, async (event) => {
    if (event.type !== EventType.PartFormProcessed) return;
    const { quoteId, partId } = event.payload;
    const state = quotes.get(quoteId);
    if (!state) return;
    const stages = state.partStages.get(partId);
    if (stages) stages.form = true;
  });

  eventBus.subscribe(EventType.Part2DProcessed, async (event) => {
    if (event.type !== EventType.Part2DProcessed) return;
    const { quoteId, partId } = event.payload;
    const state = quotes.get(quoteId);
    if (!state) return;
    const stages = state.partStages.get(partId);
    if (stages) stages["2d"] = true;
  });

  eventBus.subscribe(EventType.Part3DProcessed, async (event) => {
    if (event.type !== EventType.Part3DProcessed) return;
    const { quoteId, partId } = event.payload;
    const state = quotes.get(quoteId);
    if (!state) return;
    const stages = state.partStages.get(partId);
    if (stages) stages["3d"] = true;
  });

  eventBus.subscribe(EventType.PartProcessingComplete, async (event) => {
    if (event.type !== EventType.PartProcessingComplete) return;
    const { quoteId, partId } = event.payload;
    const state = quotes.get(quoteId);
    if (!state) return;

    state.completedParts.add(partId);

    if (state.completedParts.size === state.totalParts) {
      clearTimeout(state.timer);
      quotes.delete(quoteId);

      const hasErrors = [...state.partStages.values()].some(
        (s) => !s.form || !s["2d"] || !s["3d"]
      );

      await eventBus.publish({
        type: EventType.QuoteInfoComplete,
        payload: {
          quoteId,
          completionStatus: hasErrors ? "COMPLETE_WITH_ERRORS" : "COMPLETE",
        },
      });
    }
  });

  async function handleTimeout(quoteId: string): Promise<void> {
    const state = quotes.get(quoteId);
    if (!state) return;
    quotes.delete(quoteId);

    const completedParts: string[] = [...state.completedParts];
    const pendingParts: PendingPartInfo[] = [];

    for (const [partId, stages] of state.partStages) {
      if (state.completedParts.has(partId)) continue;
      const pendingStages: ("form" | "2d" | "3d")[] = [];
      if (!stages.form) pendingStages.push("form");
      if (!stages["2d"]) pendingStages.push("2d");
      if (!stages["3d"]) pendingStages.push("3d");
      pendingParts.push({ partId, pendingStages });
    }

    await eventBus.publish({
      type: EventType.QuoteTimedOut,
      payload: {
        quoteId,
        completedParts,
        pendingParts,
        timeoutAt: new Date().toISOString(),
      },
    });
  }
}
