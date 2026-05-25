import { test, expect } from "bun:test";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { partCompletion } from "../../workers/partCompletion";

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

test("receives all 3 stage events and publishes PartProcessingComplete", async () => {
  const eventBus = createMockEventBus();
  partCompletion(eventBus);

  const quoteId = "q1";
  const partId = "p1";

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId, output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });
  await eventBus.publish({
    type: EventType.part_3d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });

  const completeEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEvents.length).toBe(1);
  expect(completeEvents[0].payload.quoteId).toBe(quoteId);
  expect(completeEvents[0].payload.partId).toBe(partId);
});

test("does not publish PartProcessingComplete until all 3 stages received", async () => {
  const eventBus = createMockEventBus();
  partCompletion(eventBus);

  const quoteId = "q1";
  const partId = "p1";

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId, output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });

  const completeEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEvents.length).toBe(0);
});

test("handles out-of-order arrival of stage events", async () => {
  const eventBus = createMockEventBus();
  partCompletion(eventBus);

  const quoteId = "q1";
  const partId = "p1";

  await eventBus.publish({
    type: EventType.part_3d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });
  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId, output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });

  const completeEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEvents.length).toBe(1);
});

test("tracks multiple parts independently", async () => {
  const eventBus = createMockEventBus();
  partCompletion(eventBus);

  const quoteId = "q1";

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId: "p1", output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId: "p1", output: { processed: true } },
  });
  await eventBus.publish({
    type: EventType.part_3d_complete,
    payload: { quoteId, partId: "p1", output: { processed: true } },
  });

  let completeEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEvents.length).toBe(1);
  expect(completeEvents[0].payload.partId).toBe("p1");

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId: "p2", output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId: "p2", output: { processed: true } },
  });
  await eventBus.publish({
    type: EventType.part_3d_complete,
    payload: { quoteId, partId: "p2", output: { processed: true } },
  });

  completeEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEvents.length).toBe(2);
});

test("deduplicates completion — publishes only once per part", async () => {
  const eventBus = createMockEventBus();
  partCompletion(eventBus);

  const quoteId = "q1";
  const partId = "p1";

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId, output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });
  await eventBus.publish({
    type: EventType.part_3d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });

  const completeEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEvents.length).toBe(1);

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId, partId, output: { processedForm: {} } },
  });
  await eventBus.publish({
    type: EventType.part_2d_complete,
    payload: { quoteId, partId, output: { processed: true } },
  });

  const completeEventsAfter = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.part_processing_complete
  );
  expect(completeEventsAfter.length).toBe(1);
});
