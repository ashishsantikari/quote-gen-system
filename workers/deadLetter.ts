import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function deadLetter(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.OperationFailed, async (event) => {
    if (event.type !== EventType.OperationFailed) return;

    await dataService.addToRetryQueue({
      quoteId: event.payload.quoteId,
      partId: event.payload.partId || "",
      stage: event.payload.stage || "",
      error: event.payload.error,
      attempts: event.payload.attempts,
      status: "PENDING",
    });
  });
}
