import { v4 as uuidv4 } from "uuid";
import type { Request, ResponseToolkit, Lifecycle } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";

const S3_BUCKET = process.env.S3_BUCKET || "quote-gen-uploads";
const S3_PRESIGNED_EXPIRY = parseInt(process.env.S3_PRESIGNED_EXPIRY || "3600", 10);

function getServices(request: Request) {
  const plugins = request.server.plugins as Record<string, any>;
  const { dataService, fileStorage, eventBus } = plugins.quote;
  return { dataService, fileStorage, eventBus } as {
    dataService: IDataService;
    fileStorage: IFileStorage;
    eventBus: IEventBus;
  };
}

export async function createQuoteHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { dataService, fileStorage, eventBus } = getServices(request);
  const { parts } = request.payload as { parts: { name: string }[] };

  const quoteId = uuidv4();
  const partsWithIds = parts.map((p) => ({ partId: uuidv4(), name: p.name }));

  await dataService.createQuote({ quoteId, parts: partsWithIds });

  const presignedEntries = await Promise.all(
    partsWithIds.map(async (part) => {
      const key2D = `quotes/${quoteId}/parts/${part.partId}/2d/${part.name}`;
      const key3D = `quotes/${quoteId}/parts/${part.partId}/3d/${part.name}`;

      const [presignedUrl2D, presignedUrl3D] = await Promise.all([
        fileStorage.generatePresignedUrl(S3_BUCKET, key2D, S3_PRESIGNED_EXPIRY),
        fileStorage.generatePresignedUrl(S3_BUCKET, key3D, S3_PRESIGNED_EXPIRY),
      ]);

      const expiry = new Date(Date.now() + S3_PRESIGNED_EXPIRY * 1000);
      await dataService.updatePartPresignedUrls(quoteId, part.partId, presignedUrl2D, presignedUrl3D, expiry);

      return { partId: part.partId, name: part.name, presignedUrl2D, presignedUrl3D, key2D, key3D };
    })
  );

  await eventBus.publish({
    type: EventType.QuoteCreated,
    payload: { quoteId, parts: partsWithIds },
  });

  return h.response({ quoteId, parts: presignedEntries }).code(201);
}

export async function confirmFileHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { dataService, eventBus } = getServices(request);
  const { quoteId, partId } = request.params as { quoteId: string; partId: string };
  const { type } = request.payload as { type: "2d" | "3d" };

  await dataService.markPartFileUploaded(quoteId, partId, type);

  const quote = await dataService.getQuote(quoteId);
  if (!quote) {
    return h.response({ error: "Quote not found" }).code(404);
  }

  const part = quote.parts?.find((p: any) => p.partId === partId);
  const fileKey = type === "2d" ? part?.file2DKey : part?.file3DKey;

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId, partId, fileType: type, fileKey: fileKey || "" },
  });

  return h.response({ success: true, quoteId, partId, type }).code(200);
}

export async function submitFormHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { dataService, eventBus } = getServices(request);
  const { quoteId } = request.params as { quoteId: string };
  const { formData, email } = request.payload as { formData: Record<string, unknown>; email: string };

  await dataService.submitForm(quoteId, formData || {}, email);
  await dataService.updateQuoteStatus(quoteId, "QUOTE_FORM_UPLOAD_SUCCESS");

  await eventBus.publish({
    type: EventType.FormUploaded,
    payload: { quoteId, formData: formData || {}, email },
  });

  return h.response({ success: true, quoteId }).code(200);
}

export async function getQuoteHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { dataService } = getServices(request);
  const { quoteId } = request.params as { quoteId: string };

  const quote = await dataService.getQuote(quoteId);
  if (!quote) {
    return h.response({ error: "Quote not found" }).code(404);
  }

  return h.response(quote).code(200);
}

export async function regenerateUrlHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { dataService, fileStorage } = getServices(request);
  const { quoteId } = request.params as { quoteId: string };
  const { partId, type } = request.payload as { partId: string; type: "2d" | "3d" };

  const quote = await dataService.getQuote(quoteId);
  if (!quote) {
    return h.response({ error: "Quote not found" }).code(404);
  }

  const part = quote.parts?.find((p: any) => p.partId === partId);
  if (!part) {
    return h.response({ error: "Part not found" }).code(404);
  }

  const key = type === "2d"
    ? `quotes/${quoteId}/parts/${partId}/2d/${part.name}`
    : `quotes/${quoteId}/parts/${partId}/3d/${part.name}`;

  const presignedUrl = await fileStorage.generatePresignedUrl(S3_BUCKET, key, S3_PRESIGNED_EXPIRY);
  const expiry = new Date(Date.now() + S3_PRESIGNED_EXPIRY * 1000);

  await dataService.updatePartPresignedUrls(
    quoteId,
    partId,
    type === "2d" ? presignedUrl : part.presignedUrl2D || "",
    type === "3d" ? presignedUrl : part.presignedUrl3D || "",
    expiry
  );

  return h.response({ quoteId, partId, type, presignedUrl, key, expiresAt: expiry.toISOString() }).code(200);
}
