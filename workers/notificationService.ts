import type { INotificationService } from "../core/ports/INotificationService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function notificationService(
  notifyService: INotificationService,
  eventBus: IEventBus
): void {
  eventBus.subscribe(EventType.QuoteGenerated, async (event) => {
    if (event.type !== EventType.QuoteGenerated) return;
    const { quoteId, generatedData, transparency } = event.payload;

    await notifyService.notify(quoteId, {
      event: "QuoteGenerated",
      generatedData,
      transparency,
    });

    await eventBus.publish({
      type: EventType.NotificationSent,
      payload: { quoteId, channel: "websocket" },
    });
  });
}
