import type { Request, ResponseToolkit, Lifecycle } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { generateId, S3_BUCKET, buildPartKey } from "../../core/ids";
import { NotFoundError, ValidationError, httpErrorResponse } from "../../core/errors";
import { getRequestTraceId } from "../logging";

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

function errorReply(h: ResponseToolkit, error: unknown, request: Request): Lifecycle.ReturnValue {
  const traceId = getRequestTraceId(request);
  const { statusCode, body } = httpErrorResponse(error, traceId);
  return h.response(body).code(statusCode);
}

export async function createQuoteHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { dataService, fileStorage, eventBus } = getServices(request);
    const { parts } = request.payload as { parts: { name: string }[] };

    const quoteId = generateId("q");
    const partsWithIds = parts.map((p) => ({ partId: generateId("p"), name: p.name }));

    await dataService.createQuote({ quoteId, parts: partsWithIds });

    const presignedEntries = await Promise.all(
      partsWithIds.map(async (part) => {
        const key2D = buildPartKey(quoteId, part.partId, "2d", part.name);
        const key3D = buildPartKey(quoteId, part.partId, "3d", part.name);

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
      type: EventType.init_quote_creation_request,
      payload: { quoteId, parts: partsWithIds },
    });

    return h.response({ quoteId, parts: presignedEntries }).code(201);
  } catch (error) {
    return errorReply(h, error, request);
  }
}

export async function confirmFileHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { dataService, eventBus } = getServices(request);
    const { quoteId, partId } = request.params as { quoteId: string; partId: string };
    const { type } = request.payload as { type: "2d" | "3d" };

    const quote = await dataService.getQuote(quoteId);
    if (!quote) throw new NotFoundError("Quote", quoteId);

    const part = quote.parts?.find((p: any) => p.partId === partId);
    if (!part) throw new NotFoundError("Part", partId, { quoteId });

    if (type === "2d" && part.file2DUploaded) {
      return h.response({ success: true, quoteId, partId, type, message: "2D file already uploaded" }).code(200);
    }
    if (type === "3d" && part.file3DUploaded) {
      return h.response({ success: true, quoteId, partId, type, message: "3D file already uploaded" }).code(200);
    }

    await dataService.markPartFileUploaded(quoteId, partId, type);

    const fileKey = type === "2d" ? part.file2DKey : part.file3DKey;
    const fileName = type === "2d" ? (part.file2DName || part.name) : (part.file3DName || part.name);

    const eventType = type === "2d" ? EventType.init_quote_part_2d_file_upload : EventType.init_quote_part_3d_file_upload;
    await eventBus.publish({
      type: eventType,
      payload: { quoteId, partId, fileKey: fileKey || "", fileName },
    });

    return h.response({ success: true, quoteId, partId, type }).code(200);
  } catch (error) {
    return errorReply(h, error, request);
  }
}

export async function submitFormHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { dataService, eventBus } = getServices(request);
    const { quoteId } = request.params as { quoteId: string };
    const { formData, email } = request.payload as { formData: Record<string, unknown>; email: string };

    const quote = await dataService.getQuote(quoteId);
    if (!quote) throw new NotFoundError("Quote", quoteId);

    if (quote.formSubmitted) {
      return h.response({ success: true, quoteId, message: "form already submitted" }).code(200);
    }

    await dataService.submitForm(quoteId, formData || {}, email);
    await dataService.updateQuoteStatus(quoteId, "QUOTE_FORM_UPLOAD_SUCCESS");

    await eventBus.publish({
      type: EventType.init_quote_form_upload,
      payload: { quoteId, formData: formData || {}, email },
    });

    return h.response({ success: true, quoteId }).code(200);
  } catch (error) {
    return errorReply(h, error, request);
  }
}

export async function getQuoteHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { dataService } = getServices(request);
    const { quoteId } = request.params as { quoteId: string };

    const quote = await dataService.getQuote(quoteId);
    if (!quote) throw new NotFoundError("Quote", quoteId);

    return h.response(quote).code(200);
  } catch (error) {
    return errorReply(h, error, request);
  }
}

export async function regenerateUrlHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { dataService, fileStorage } = getServices(request);
    const { quoteId } = request.params as { quoteId: string };
    const { partId, type } = request.payload as { partId: string; type: "2d" | "3d" };

    const quote = await dataService.getQuote(quoteId);
    if (!quote) throw new NotFoundError("Quote", quoteId);

    const part = quote.parts?.find((p: any) => p.partId === partId);
    if (!part) throw new NotFoundError("Part", partId, { quoteId });

    const key = buildPartKey(quoteId, partId, type, part.name);

    const presignedUrl = await fileStorage.generatePresignedUrl(S3_BUCKET, key, S3_PRESIGNED_EXPIRY);
    const expiry = new Date(Date.now() + S3_PRESIGNED_EXPIRY * 1000);

    await dataService.updatePartPresignedUrls(
      quoteId,
      partId,
      type === "2d" ? presignedUrl : (part.presignedUrl2D || ""),
      type === "3d" ? presignedUrl : (part.presignedUrl3D || ""),
      expiry
    );

    return h.response({ quoteId, partId, type, presignedUrl, key, expiresAt: expiry.toISOString() }).code(200);
  } catch (error) {
    return errorReply(h, error, request);
  }
}
