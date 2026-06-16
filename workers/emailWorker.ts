import type { IDataService } from "../core/ports/IDataService";
import type { IEmailService, EmailAttachment } from "../core/ports/IEmailService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function emailWorker(
  dataService: IDataService,
  emailService: IEmailService,
  eventBus: IEventBus
): void {
  eventBus.subscribe(EventType.quote_pdf_complete, async (event) => {
    if (event.type !== EventType.quote_pdf_complete) return;
    const { quoteId, pdfKey, pdfUrl } = event.payload;

    const quote = await dataService.getQuote(quoteId);
    if (!quote || !quote.email) return;

    const transparency = quote.transparency;
    const assumptionsHtml = transparency?.assumptions
      ? `<ul>${transparency.assumptions.map((a: string) => `<li>${a}</li>`).join("")}</ul>`
      : "";

    const body = `
      <h1>Your Quote is Ready</h1>
      <p>Quote ID: <strong>${quoteId}</strong></p>
      <h2>Transparency Report</h2>
      <p>Data Completeness: <strong>${transparency?.dataCompleteness || "N/A"}</strong></p>
      <p>Successful Stages: ${transparency?.successful || 0} / ${transparency?.totalStages || 0}</p>
      ${transparency?.errored ? `<p>Errors: ${transparency.errored}</p>` : ""}
      ${transparency?.timedOut ? `<p>Timed Out: ${transparency.timedOut}</p>` : ""}
      ${assumptionsHtml}
      <p>PDF: <a href="${pdfUrl}">Download Quote PDF</a></p>
    `;

    const attachments: EmailAttachment[] = [
      {
        filename: "quote.pdf",
        content: Buffer.from(JSON.stringify({ quoteId, pdfKey })), // simulated PDF content
        contentType: "application/pdf",
      },
    ];

    await emailService.sendQuoteEmail(
      quote.email,
      `Your Quote ${quoteId} is Ready`,
      body,
      attachments
    );

    await eventBus.publish({
      type: EventType.quote_email_send,
      payload: { quoteId, sentAt: new Date().toISOString() },
    });
  });
}
