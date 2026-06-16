import type { INotificationService } from "../core/ports/INotificationService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function notificationService(
  notifyService: INotificationService,
  eventBus: IEventBus
): void {
  eventBus.subscribe(EventType.quote_ready, async (event) => {
    if (event.type !== EventType.quote_ready) return;
    const { quoteId, generatedData, transparency } = event.payload;

    await notifyService.notify(quoteId, {
      event: "quote_ready",
      generatedData,
      transparency,
    });

    await eventBus.publish({
      type: EventType.quote_notification_send,
      payload: { quoteId, channel: "websocket" },
    });
  });
}
