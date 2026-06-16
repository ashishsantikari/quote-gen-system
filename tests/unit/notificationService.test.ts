import { test, expect, mock } from "bun:test";
import type { INotificationService } from "../../core/ports/INotificationService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { notificationService } from "../../workers/notificationService";

function createMockNotifyService(overrides?: Partial<INotificationService>): INotificationService {
  return {
    notify: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function createMockEventBus(): IEventBus & { getPublished(): any[] } {
  const handlers = new Map<string, Set<(event: any) => Promise<void>>>();
  const published: any[] = [];

  return {
    async publish(event: any) {
      published.push({ type: event.type, payload: { ...event.payload } });
      const subs = handlers.get(event.type);
      if (subs) {
        await Promise.all([...subs].map((h) => h(event)));
      }
    },
    subscribe(eventType: string, handler: (event: any) => Promise<void>) {
      if (!handlers.has(eventType)) handlers.set(eventType, new Set());
      handlers.get(eventType)!.add(handler);
    },
    getPublished() {
      return published;
    },
  };
}

test("receives QuoteGenerated, calls notify, publishes NotificationSent", async () => {
  const notifyService = createMockNotifyService();
  const eventBus = createMockEventBus();

  notificationService(notifyService, eventBus);

  await eventBus.publish({
    type: EventType.quote_ready,
    payload: {
      quoteId: "q1",
      generatedData: { quoteId: "q1", items: [] },
      transparency: {
        totalStages: 3,
        successful: 3,
        errored: 0,
        timedOut: 0,
        dataCompleteness: "COMPLETE",
        assumptions: [],
      },
    },
  });

  const published = eventBus.getPublished();
  const notificationEvents = published.filter(
    (e: any) => e.type === EventType.quote_notification_send
  );
  expect(notificationEvents.length).toBe(1);
  expect(notificationEvents[0].payload.quoteId).toBe("q1");
  expect(notificationEvents[0].payload.channel).toBe("websocket");
});

test("calls notify with correct message payload", async () => {
  const notifyService = createMockNotifyService();
  const eventBus = createMockEventBus();

  notificationService(notifyService, eventBus);

  await eventBus.publish({
    type: EventType.quote_ready,
    payload: {
      quoteId: "q2",
      generatedData: { foo: "bar" },
      transparency: {
        totalStages: 6,
        successful: 4,
        errored: 2,
        timedOut: 0,
        dataCompleteness: "PARTIAL",
        assumptions: ["Part x form: parse error — best assumption used"],
      },
    },
  });

  const published = eventBus.getPublished();
  const notificationEvents = published.filter(
    (e: any) => e.type === EventType.quote_notification_send
  );
  expect(notificationEvents.length).toBe(1);
  expect(notificationEvents[0].payload.quoteId).toBe("q2");
});
