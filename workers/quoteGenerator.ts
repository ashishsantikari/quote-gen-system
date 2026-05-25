import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { TransparencyReport } from "../core/events/types";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "quoteGenerator" });

export function quoteGenerator(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.quote_data_normalization_complete, async (event) => {
    if (event.type !== EventType.quote_data_normalization_complete) return;
    await generateQuote(event.payload.quoteId, event.payload.completionStatus, event.traceId);
  });

  eventBus.subscribe(EventType.quote_data_normalization_timed_out, async (event) => {
    if (event.type !== EventType.quote_data_normalization_timed_out) return;
    await generateQuote(event.payload.quoteId, "COMPLETE_WITH_ERRORS", event.traceId);
  });

  async function generateQuote(quoteId: string, completionStatus: string, traceId?: string): Promise<void> {
    log.info("generating quote", { quoteId, completionStatus, traceId });
    const quote = await dataService.getQuote(quoteId);
    if (!quote) { log.warn("quote not found", { quoteId, traceId }); return; }

    const stages = ["form", "2d", "3d"] as const;
    let successful = 0;
    let errored = 0;
    let timedOut = 0;
    const assumptions: string[] = [];

    for (const part of quote.parts) {
      const partName = part.name || part.partId;
      const partProc = quote.processing?.[part.partId];

      for (const stage of stages) {
        const stageProc = partProc?.[stage];
        const output = stageProc?.output ?? null;
        const error = stageProc?.error;
        const processed = stageProc?.processed ?? false;

        if (output) {
          successful++;
        } else if (error) {
          errored++;
          assumptions.push(`Part ${partName} ${stage}: ${error} — best assumption used`);
        } else if (!processed) {
          timedOut++;
          assumptions.push(`Part ${partName} ${stage}: not processed in time — estimate used`);
        } else {
          timedOut++;
          assumptions.push(`Part ${partName} ${stage}: no output available — estimate used`);
        }
      }
    }

    const totalStages = quote.parts.length * stages.length;
    const dataCompleteness =
      timedOut === 0 && errored === 0
        ? "COMPLETE"
        : errored > 0
        ? "PARTIAL"
        : "COMPLETE_WITH_ESTIMATES";

    const transparency: TransparencyReport = {
      totalStages,
      successful,
      errored,
      timedOut,
      dataCompleteness,
      assumptions,
    };

    const generatedData = {
      quoteId,
      generatedAt: new Date().toISOString(),
      completionStatus,
      parts: quote.parts.map((p: any) => ({
        partId: p.partId,
        name: p.name,
        formData: (quote.processing?.[p.partId]?.form?.output) || null,
        file2DData: (quote.processing?.[p.partId]?.["2d"]?.output) || null,
        file3DData: (quote.processing?.[p.partId]?.["3d"]?.output) || null,
      })),
    };

    await eventBus.publish({
      type: EventType.quote_ready,
      payload: { quoteId, generatedData, transparency },
      traceId,
    });
    log.info("quote generated", { quoteId, traceId, dataCompleteness, totalStages, successful, errored, timedOut });
  }
}
