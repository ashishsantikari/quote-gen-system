import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { TransparencyReport } from "../core/events/types";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "quoteGenerator" });

export function quoteGenerator(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.QuoteInfoComplete, async (event) => {
    if (event.type !== EventType.QuoteInfoComplete) return;
    await generateQuote(event.payload.quoteId, event.payload.completionStatus, event.traceId);
  });

  eventBus.subscribe(EventType.QuoteTimedOut, async (event) => {
    if (event.type !== EventType.QuoteTimedOut) return;
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

      for (const stage of stages) {
        const output =
          stage === "form"
            ? part.formOutput
            : stage === "2d"
            ? part.file2DOutput
            : part.file3DOutput;
        const error =
          stage === "form"
            ? part.formError
            : stage === "2d"
            ? part.file2DError
            : part.file3DError;
        const processed =
          stage === "form"
            ? part.formProcessed
            : stage === "2d"
            ? part.file2DProcessed
            : part.file3DProcessed;

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
        formData: p.formOutput || null,
        file2DData: p.file2DOutput || null,
        file3DData: p.file3DOutput || null,
      })),
    };

    await eventBus.publish({
      type: EventType.QuoteGenerated,
      payload: { quoteId, generatedData, transparency },
      traceId,
    });
    log.info("quote generated", { quoteId, traceId, dataCompleteness, totalStages, successful, errored, timedOut });
  }
}
