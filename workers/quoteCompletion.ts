import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { PendingPartInfo } from "../core/events/types";

const TIMEOUT_MS = 25_000;

interface QuoteState {
  totalParts: number;
  completedParts: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

export function quoteCompletion(dataService: IDataService, eventBus: IEventBus): void {
  const quotes = new Map<string, QuoteState>();

  eventBus.subscribe(EventType.quote_all_mandatory_data_receipt, async (event) => {
    if (event.type !== EventType.quote_all_mandatory_data_receipt) return;
    const { quoteId } = event.payload;
    const quote = await dataService.getQuote(quoteId);
    if (!quote) return;

    const state: QuoteState = {
      totalParts: quote.parts.length,
      completedParts: new Set(),
      timer: setTimeout(() => handleTimeout(quoteId), TIMEOUT_MS),
    };

    quotes.set(quoteId, state);
  });

  eventBus.subscribe(EventType.part_processing_complete, async (event) => {
    if (event.type !== EventType.part_processing_complete) return;
    const { quoteId, partId } = event.payload;
    const state = quotes.get(quoteId);
    if (!state) return;

    state.completedParts.add(partId);

    if (state.completedParts.size === state.totalParts) {
      if (state.timer) clearTimeout(state.timer);
      quotes.delete(quoteId);

      await eventBus.publish({
        type: EventType.quote_data_normalization_complete,
        payload: { quoteId, completionStatus: "COMPLETE" },
      });
    }
  });

  async function handleTimeout(quoteId: string): Promise<void> {
    const state = quotes.get(quoteId);
    if (!state) return;
    quotes.delete(quoteId);

    const quote = await dataService.getQuote(quoteId);
    if (!quote) return;

    const completedParts: string[] = [...state.completedParts];
    const pendingParts: PendingPartInfo[] = [];

    const stages = ["form", "2d", "3d"] as const;
    for (const part of quote.parts) {
      if (state.completedParts.has(part.partId)) continue;
      const partProc = quote.processing?.[part.partId];
      const pendingStages: ("form" | "2d" | "3d")[] = [];
      const processed: Record<string, boolean> = {
        form: partProc?.form?.processed ?? false,
        "2d": partProc?.["2d"]?.processed ?? false,
        "3d": partProc?.["3d"]?.processed ?? false,
      };
      for (const stage of stages) {
        if (!processed[stage]) pendingStages.push(stage);
      }
      if (pendingStages.length > 0) {
        pendingParts.push({ partId: part.partId, pendingStages });
      }
    }

    await dataService.updateQuoteStatus(quoteId, "QUOTE_TIMED_OUT", {
      completedParts,
      pendingParts,
      timeoutAt: new Date().toISOString(),
    });

    await eventBus.publish({
      type: EventType.quote_data_normalization_timed_out,
      payload: {
        quoteId,
        completedParts,
        pendingParts,
        timeoutAt: new Date().toISOString(),
      },
    });

    for (const pending of pendingParts) {
      for (const stage of pending.pendingStages) {
        await eventBus.publish({
          type: EventType.error_operation_fail,
          payload: {
            quoteId,
            partId: pending.partId,
            stage,
            error: `Timed out after ${TIMEOUT_MS}ms — stage not processed`,
            attempts: 0,
          },
        });
      }
    }
  }
}
