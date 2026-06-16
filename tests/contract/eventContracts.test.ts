import { describe, test, expect, mock } from "bun:test";
import { EventType } from "../../core/events/types";
import type { QuoteEvent } from "../../core/events/types";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createMockEventBus() {
  const handlers = new Map<string, Set<(event: any) => Promise<void>>>();
  const published: any[] = [];

  return {
    async publish(event: any) {
      published.push(event);
      const subs = handlers.get(event.type);
      if (subs) {
        await Promise.all([...subs].map((h) => h(event)));
      }
    },
    subscribe(eventType: string, handler: (event: any) => Promise<void>) {
      if (!handlers.has(eventType)) handlers.set(eventType, new Set());
      handlers.get(eventType)!.add(handler);
    },
    getPublished() { return published; },
  };
}

function createMockDataService(overrides?: Record<string, any>) {
  return {
    createQuote: mock(() => Promise.resolve({})),
    getQuote: mock(() => Promise.resolve(null)),
    submitForm: mock(() => Promise.resolve()),
    markPartFileUploaded: mock(() => Promise.resolve()),
    updatePartStage: mock(() => Promise.resolve()),
    updatePartPresignedUrls: mock(() => Promise.resolve()),
    updateQuoteStatus: mock(() => Promise.resolve()),
    markEmailSent: mock(() => Promise.resolve()),
    cancelQuote: mock(() => Promise.resolve()),
    findExpiredQuotes: mock(() => Promise.resolve([])),
    getQuoteStatus: mock(() => Promise.resolve(null)),
    isPartStageProcessed: mock(() => Promise.resolve(false)),
    addToRetryQueue: mock(() => Promise.resolve()),
    getRetryQueue: mock(() => Promise.resolve([])),
    markRetryStatus: mock(() => Promise.resolve()),
    batchUpdate: mock(() => Promise.resolve()),
    ...overrides,
  };
}

// ──────────────────────────────────────────────
// 1. Event Type Registry Contract
// ──────────────────────────────────────────────

describe("Event type registry contract", () => {

  test("every EventType key has a string value identical to its key", () => {
    const keys = Object.keys(EventType) as (keyof typeof EventType)[];
    for (const key of keys) {
      expect(EventType[key]).toBe(key);
    }
  });

  test("no duplicate event type string values exist", () => {
    const values = Object.values(EventType);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  test("all EventType values have a matching QuoteEvent union member", () => {
    const values = Object.values(EventType);
    for (const v of values) {
      const event = { type: v, payload: {} } as QuoteEvent;
      expect(event.type).toBe(v);
    }
  });

  test("count of event types matches expected total", () => {
    expect(Object.keys(EventType).length).toBe(19);
  });
});

// ──────────────────────────────────────────────
// 2. Event Bus Interface Contract
// ──────────────────────────────────────────────

describe("IEventBus contract", () => {
  test("publish/subscribe roundtrip delivers event", async () => {
    const bus = createMockEventBus();
    const received: any[] = [];

    bus.subscribe(EventType.init_quote_creation_request, async (event) => {
      received.push(event);
    });

    await bus.publish({
      type: EventType.init_quote_creation_request,
      payload: { quoteId: "q-111111111111", parts: [{ partId: "p-111111111111", name: "test" }] },
    });

    expect(received.length).toBe(1);
    expect(received[0].type).toBe(EventType.init_quote_creation_request);
    expect(received[0].payload.quoteId).toBe("q-111111111111");
  });

  test("multiple subscribers to same event type all get called", async () => {
    const bus = createMockEventBus();
    const called: number[] = [];

    bus.subscribe(EventType.quote_ready, async () => { called.push(1); });
    bus.subscribe(EventType.quote_ready, async () => { called.push(2); });
    bus.subscribe(EventType.quote_ready, async () => { called.push(3); });

    await bus.publish({
      type: EventType.quote_ready,
      payload: { quoteId: "q1", generatedData: {}, transparency: { totalStages: 0, successful: 0, errored: 0, timedOut: 0, dataCompleteness: "COMPLETE", assumptions: [] } },
    });

    expect(called.sort()).toEqual([1, 2, 3]);
  });

  test("subscriber only receives events for subscribed type", async () => {
    const bus = createMockEventBus();
    const received: string[] = [];

    bus.subscribe(EventType.init_quote_form_upload, async (e) => {
      received.push(e.type);
    });

    await bus.publish({
      type: EventType.init_quote_creation_request,
      payload: { quoteId: "q1", parts: [] },
    });
    await bus.publish({
      type: EventType.init_quote_form_upload,
      payload: { quoteId: "q1", formData: {}, email: "a@b.com" },
    });

    expect(received).toEqual([EventType.init_quote_form_upload]);
  });
});

// ──────────────────────────────────────────────
// 3. Producer Contract: mongoPersister (completeness → quote_data_normalization_begin)
// ──────────────────────────────────────────────

describe("mongoPersister completeness transition contract", () => {
  test("after flushing complete upload data, publishes quote_data_normalization_begin and quote_all_mandatory_data_receipt", async () => {
    const bus = createMockEventBus();
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-mp-ct-001",
        status: "QUOTE_INIT",
        formSubmitted: true,
        parts: [
          { partId: "p1", file2DUploaded: true, file3DUploaded: true },
        ],
      })),
    });

    process.env.MONGO_BATCH_WINDOW_MS = "0";
    const { mongoPersister } = await import("../../workers/mongoPersister");
    mongoPersister(ds, bus as any);

    // A file upload triggers flush + completeness check
    await bus.publish({
      type: EventType.init_quote_part_2d_file_upload,
      payload: { quoteId: "q-mp-ct-001", partId: "p1", fileKey: "quotes/q-mp-ct-001/parts/p1/2d/widget.stl", fileName: "widget.stl" },
    });

    const normalizationBegin = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_data_normalization_begin
    );
    expect(normalizationBegin).toBeTruthy();
    expect(normalizationBegin.payload.quoteId).toBe("q-mp-ct-001");

    const allDataReceipt = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_all_mandatory_data_receipt
    );
    expect(allDataReceipt).toBeTruthy();
    expect(allDataReceipt.payload.quoteId).toBe("q-mp-ct-001");
    expect(typeof allDataReceipt.payload.receivedAt).toBe("string");
  });
});

// ──────────────────────────────────────────────
// 4. Producer Contract: quoteCompletion
// ──────────────────────────────────────────────

describe("quoteCompletion producer contract", () => {
  test("on quote_all_mandatory_data_receipt, starts timer and with all parts done publishes quote_data_normalization_complete", async () => {
    const bus = createMockEventBus();
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-ct-002",
        parts: [{ partId: "p-ct-002", name: "widget" }],
      })),
    });

    const { quoteCompletion } = await import("../../workers/quoteCompletion");
    quoteCompletion(ds, bus as any);

    // Start the timer by publishing received event
    await bus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q-ct-002", receivedAt: new Date().toISOString() },
    });

    // All parts complete processing
    await bus.publish({
      type: EventType.part_processing_complete,
      payload: { quoteId: "q-ct-002", partId: "p-ct-002" },
    });

    const normComplete = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_data_normalization_complete
    );
    expect(normComplete).toBeTruthy();
    expect(normComplete.payload).toEqual({ quoteId: "q-ct-002", completionStatus: "COMPLETE" });
  });

  test("publishes quote_data_normalization_timed_out on timeout", async () => {
    const bus = createMockEventBus();
    const quoteId = "q-ct-003";
    const partId = "p-ct-003";

    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId,
        parts: [{ partId, name: "widget" }],
        processing: { [partId]: { form: { processed: false, output: null, error: null, retries: 0 }, "2d": { processed: false, output: null, error: null, retries: 0 }, "3d": { processed: false, output: null, error: null, retries: 0 } } },
      })),
    });

    const originalSetTimeout = globalThis.setTimeout;
    const timers = new Map<string, () => void>();
    globalThis.setTimeout = ((cb: () => void) => {
      const id = `t-${timers.size}`;
      timers.set(id, cb);
      return id as any;
    }) as typeof setTimeout;

    try {
      const { quoteCompletion } = await import("../../workers/quoteCompletion");
      quoteCompletion(ds, bus as any);

      await bus.publish({
        type: EventType.quote_all_mandatory_data_receipt,
        payload: { quoteId, receivedAt: new Date().toISOString() },
      });

      const timerCb = [...timers.values()][0];
      if (timerCb) await timerCb();

      const timedOut = bus.getPublished().find(
        (e: any) => e.type === EventType.quote_data_normalization_timed_out
      );
      expect(timedOut).toBeTruthy();
      expect(timedOut.payload.quoteId).toBe(quoteId);
      expect(Array.isArray(timedOut.payload.pendingParts)).toBe(true);
      expect(typeof timedOut.payload.timeoutAt).toBe("string");
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

// ──────────────────────────────────────────────
// 5. Producer Contract: formProcessor / 2D / 3D
// ──────────────────────────────────────────────

describe("Stage processor producer contracts", () => {
  test("formProcessor publishes part_form_complete for each part", async () => {
    const bus = createMockEventBus();
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-fp-001",
        parts: [{ partId: "p-fp-001", name: "widget" }],
        formData: { p_fp_001: { color: "red" } },
        processing: {},
      })),
      isPartStageProcessed: mock(() => Promise.resolve(false)),
    });

    const { formProcessor } = await import("../../workers/formProcessor");
    formProcessor(ds, bus as any);

    await bus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q-fp-001", receivedAt: new Date().toISOString() },
    });

    await new Promise((r) => setTimeout(r, 20));

    const formComplete = bus.getPublished().find(
      (e: any) => e.type === EventType.part_form_complete
    );
    expect(formComplete).toBeTruthy();
    expect(formComplete.payload.quoteId).toBe("q-fp-001");
    expect(formComplete.payload.partId).toBe("p-fp-001");
    expect(formComplete.payload.output).toBeTruthy();
  });

  test("twoDProcessor publishes part_2d_complete for each part", async () => {
    const bus = createMockEventBus();
    const fileStorage = { fileExists: mock(() => Promise.resolve(true)) };
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-2d-001",
        parts: [{ partId: "p-2d-001", name: "widget", file2DKey: "quotes/q-2d-001/parts/p-2d-001/2d/widget" }],
      })),
      isPartStageProcessed: mock(() => Promise.resolve(false)),
    });

    const { twoDProcessor } = await import("../../workers/twoDProcessor");
    twoDProcessor(ds, fileStorage as any, bus as any);

    await bus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q-2d-001", receivedAt: new Date().toISOString() },
    });

    await new Promise((r) => setTimeout(r, 20));

    const twoDComplete = bus.getPublished().find(
      (e: any) => e.type === EventType.part_2d_complete
    );
    expect(twoDComplete).toBeTruthy();
    expect(twoDComplete.payload.quoteId).toBe("q-2d-001");
    expect(twoDComplete.payload.partId).toBe("p-2d-001");
    expect(twoDComplete.payload.output).toBeTruthy();
  });

  test("threeDProcessor publishes part_3d_complete for each part", async () => {
    const bus = createMockEventBus();
    const fileStorage = { fileExists: mock(() => Promise.resolve(true)) };
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-3d-001",
        parts: [{ partId: "p-3d-001", name: "widget", file3DKey: "quotes/q-3d-001/parts/p-3d-001/3d/widget" }],
      })),
      isPartStageProcessed: mock(() => Promise.resolve(false)),
    });

    const { threeDProcessor } = await import("../../workers/threeDProcessor");
    threeDProcessor(ds, fileStorage as any, bus as any);

    await bus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q-3d-001", receivedAt: new Date().toISOString() },
    });

    await new Promise((r) => setTimeout(r, 20));

    const threeDComplete = bus.getPublished().find(
      (e: any) => e.type === EventType.part_3d_complete
    );
    expect(threeDComplete).toBeTruthy();
    expect(threeDComplete.payload.quoteId).toBe("q-3d-001");
    expect(threeDComplete.payload.partId).toBe("p-3d-001");
    expect(threeDComplete.payload.output).toBeTruthy();
  });
});

// ──────────────────────────────────────────────
// 6. Producer Contract: partCompletion
// ──────────────────────────────────────────────

describe("partCompletion producer contract", () => {
  test("publishes part_processing_complete when all 3 stages done", async () => {
    const bus = createMockEventBus();

    const { partCompletion } = await import("../../workers/partCompletion");
    partCompletion(bus as any);

    const quoteId = "q-pc-001";
    const partId = "p-pc-001";

    await bus.publish({
      type: EventType.part_form_complete,
      payload: { quoteId, partId, output: {} },
    });
    await bus.publish({
      type: EventType.part_2d_complete,
      payload: { quoteId, partId, output: {} },
    });
    await bus.publish({
      type: EventType.part_3d_complete,
      payload: { quoteId, partId, output: {} },
    });

    const partComplete = bus.getPublished().find(
      (e: any) => e.type === EventType.part_processing_complete
    );
    expect(partComplete).toBeTruthy();
    expect(partComplete.payload).toEqual({ quoteId, partId });
  });
});

// ──────────────────────────────────────────────
// 7. Producer Contract: quoteGenerator → quote_ready
// ──────────────────────────────────────────────

describe("quoteGenerator producer contract", () => {
  test("publishes quote_ready with transparency report from normalization_complete", async () => {
    const bus = createMockEventBus();
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-qg-001",
        parts: [
          { partId: "p1", name: "engine" },
          { partId: "p2", name: "transmission" },
        ],
        processing: {
          p1: { form: { processed: true, output: { processedForm: {} }, error: null, retries: 0 }, "2d": { processed: true, output: { processed: true }, error: null, retries: 0 }, "3d": { processed: true, output: { processed: true }, error: null, retries: 0 } },
          p2: { form: { processed: true, output: { processedForm: {} }, error: null, retries: 0 }, "2d": { processed: true, output: { processed: true }, error: null, retries: 0 }, "3d": { processed: true, output: { processed: true }, error: null, retries: 0 } },
        },
      })),
    });

    const { quoteGenerator } = await import("../../workers/quoteGenerator");
    quoteGenerator(ds, bus as any);

    await bus.publish({
      type: EventType.quote_data_normalization_complete,
      payload: { quoteId: "q-qg-001", completionStatus: "COMPLETE" },
    });

    const ready = bus.getPublished().find((e: any) => e.type === EventType.quote_ready);
    expect(ready).toBeTruthy();
    expect(ready.payload.quoteId).toBe("q-qg-001");
    expect(ready.payload.generatedData).toBeTruthy();
    expect(ready.payload.transparency).toBeTruthy();
    expect(ready.payload.transparency.totalStages).toBe(6);
    expect(ready.payload.transparency.dataCompleteness).toBe("COMPLETE");
  });

  test("also handles normalization_timed_out and publishes quote_ready", async () => {
    const bus = createMockEventBus();
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q-qg-002",
        parts: [{ partId: "p1", name: "widget" }],
        processing: {
          p1: { form: { processed: true, output: {}, error: null, retries: 0 }, "2d": { processed: true, output: {}, error: null, retries: 0 }, "3d": { processed: true, output: {}, error: null, retries: 0 } },
        },
      })),
    });

    const { quoteGenerator } = await import("../../workers/quoteGenerator");
    quoteGenerator(ds, bus as any);

    await bus.publish({
      type: EventType.quote_data_normalization_timed_out,
      payload: { quoteId: "q-qg-002", completedParts: ["p1"], pendingParts: [], timeoutAt: new Date().toISOString() },
    });

    const ready = bus.getPublished().find((e: any) => e.type === EventType.quote_ready);
    expect(ready).toBeTruthy();
    expect(ready.payload.transparency.dataCompleteness).toBe("COMPLETE");
  });
});

// ──────────────────────────────────────────────
// 8. Producer Contract: remaining delivery chain
// ──────────────────────────────────────────────

describe("Delivery chain producer contracts", () => {
  test("pdfGenerator publishes quote_pdf_complete", async () => {
    const bus = createMockEventBus();
    const fileStorage = { generatePresignedUrl: mock(() => Promise.resolve("https://s3.example.com/pdf")) };

    const { pdfGenerator } = await import("../../workers/pdfGenerator");
    pdfGenerator(fileStorage as any, bus as any);

    await bus.publish({
      type: EventType.quote_ready,
      payload: { quoteId: "q-pdf-001", generatedData: {}, transparency: { totalStages: 0, successful: 0, errored: 0, timedOut: 0, dataCompleteness: "COMPLETE", assumptions: [] } },
    });

    const pdfComplete = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_pdf_complete
    );
    expect(pdfComplete).toBeTruthy();
    expect(pdfComplete.payload.quoteId).toBe("q-pdf-001");
    expect(typeof pdfComplete.payload.pdfKey).toBe("string");
    expect(typeof pdfComplete.payload.pdfUrl).toBe("string");
  });

  test("emailWorker publishes quote_email_send", async () => {
    const bus = createMockEventBus();
    const emailService = { sendQuoteEmail: mock(() => Promise.resolve()) };
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve({ quoteId: "q-em-001", email: "a@b.com", transparency: {} })),
    });

    const { emailWorker } = await import("../../workers/emailWorker");
    emailWorker(ds, emailService as any, bus as any);

    await bus.publish({
      type: EventType.quote_pdf_complete,
      payload: { quoteId: "q-em-001", pdfKey: "pdfs/q-em-001.pdf", pdfUrl: "https://s3.example.com/pdf" },
    });

    const emailSent = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_email_send
    );
    expect(emailSent).toBeTruthy();
    expect(emailSent.payload.quoteId).toBe("q-em-001");
    expect(typeof emailSent.payload.sentAt).toBe("string");
  });

  test("notificationService publishes quote_notification_send", async () => {
    const bus = createMockEventBus();
    const notifyService = { notify: mock(() => Promise.resolve()) };

    const { notificationService } = await import("../../workers/notificationService");
    notificationService(notifyService as any, bus as any);

    await bus.publish({
      type: EventType.quote_ready,
      payload: { quoteId: "q-ns-001", generatedData: {}, transparency: { totalStages: 0, successful: 0, errored: 0, timedOut: 0, dataCompleteness: "COMPLETE", assumptions: [] } },
    });

    const notifSent = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_notification_send
    );
    expect(notifSent).toBeTruthy();
    expect(notifSent.payload.quoteId).toBe("q-ns-001");
    expect(notifSent.payload.channel).toBe("websocket");
  });

  test("cleanupWorker publishes quote_cancel on expiry", async () => {
    const bus = createMockEventBus();
    const fileStorage = { deleteFiles: mock(() => Promise.resolve()) };
    const ds = createMockDataService({
      findExpiredQuotes: mock(() => Promise.resolve([{ quoteId: "q-cw-001", parts: [] }])),
    });

    const { cleanupWorker } = await import("../../workers/cleanupWorker");
    cleanupWorker(ds, fileStorage as any, bus as any, 24);
    await new Promise((r) => setTimeout(r, 30));

    const cancelled = bus.getPublished().find(
      (e: any) => e.type === EventType.quote_cancel
    );
    expect(cancelled).toBeTruthy();
    expect(cancelled.payload).toEqual({ quoteId: "q-cw-001", reason: "EXPIRED" });
  });
});

// ──────────────────────────────────────────────
// 9. Consumer Contract: mongoPersister
// ──────────────────────────────────────────────

describe("mongoPersister consumer contract", () => {
  test("handles init_quote_creation_request → createQuote", async () => {
    const bus = createMockEventBus();
    const writes: string[] = [];
    const ds = createMockDataService({
      getQuote: mock(() => Promise.resolve(null)),
      createQuote: mock(() => { writes.push("createQuote"); return Promise.resolve({}); }),
      addToRetryQueue: mock(() => { writes.push("addToRetryQueue"); return Promise.resolve(); }),
      cancelQuote: mock(() => { writes.push("cancelQuote"); return Promise.resolve(); }),
      batchUpdate: mock(() => { writes.push("batchUpdate"); return Promise.resolve(); }),
    });

    const { mongoPersister } = await import("../../workers/mongoPersister");
    mongoPersister(ds, bus as any);

    await bus.publish({
      type: EventType.init_quote_creation_request,
      payload: { quoteId: "q-mp-001", parts: [{ partId: "p-mp-001", name: "x" }] },
    });

    expect(writes).toContain("createQuote");
  });

  test("handles error_operation_fail → addToRetryQueue", async () => {
    const bus = createMockEventBus();
    const writes: string[] = [];
    const ds = createMockDataService({
      addToRetryQueue: mock(() => { writes.push("addToRetryQueue"); return Promise.resolve(); }),
      batchUpdate: mock(() => { writes.push("batchUpdate"); return Promise.resolve(); }),
    });

    const { mongoPersister } = await import("../../workers/mongoPersister");
    mongoPersister(ds, bus as any);

    await bus.publish({
      type: EventType.error_operation_fail,
      payload: { quoteId: "q-mp-002", stage: "test", error: "err", attempts: 1 },
    });

    expect(writes).toContain("addToRetryQueue");
  });

  test("handles quote_cancel → cancelQuote", async () => {
    const bus = createMockEventBus();
    const writes: string[] = [];
    const ds = createMockDataService({
      cancelQuote: mock(() => { writes.push("cancelQuote"); return Promise.resolve(); }),
      batchUpdate: mock(() => { writes.push("batchUpdate"); return Promise.resolve(); }),
    });

    const { mongoPersister } = await import("../../workers/mongoPersister");
    mongoPersister(ds, bus as any);

    await bus.publish({
      type: EventType.quote_cancel,
      payload: { quoteId: "q-mp-003", reason: "EXPIRED" },
    });

    expect(writes).toContain("cancelQuote");
  });
});
