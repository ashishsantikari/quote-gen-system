import type { Request, ResponseToolkit, Lifecycle } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { parseS3Key } from "../../core/ids";
import { Logger } from "../../core/telemetry/logger";

const log = new Logger({ component: "s3hook" });

interface S3Record {
  eventVersion?: string;
  eventSource?: string;
  eventName: string;
  s3: {
    s3SchemaVersion?: string;
    configurationId?: string;
    bucket: { name: string; arn?: string };
    object: { key: string; size?: number; eTag?: string; contentType?: string };
  };
}

interface S3EventPayload {
  EventName?: string;
  Key?: string;
  Records?: S3Record[];
}

function getServices(request: Request) {
  const plugins = request.server.plugins as Record<string, any>;
  const { dataService, eventBus } = plugins.s3hook;
  return { dataService, eventBus } as { dataService: IDataService; eventBus: IEventBus };
}

export async function s3EventHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const body = request.payload as S3EventPayload;
  const { dataService, eventBus } = getServices(request);

  const records = body.Records || [];

  for (const record of records) {
    if (record.eventName !== "s3:ObjectCreated:Put") continue;

    const key = record.s3?.object?.key;
    if (!key) {
      log.warn("no object key in S3 event record", { eventName: record.eventName });
      continue;
    }

    const parsed = parseS3Key(key);
    if (!parsed) {
      log.debug("key does not match quote upload pattern", { key });
      continue;
    }

    const { quoteId, partId, fileType, fileName, decodedKey } = parsed;

    const eventType = fileType === "2d" ? EventType.init_quote_part_2d_file_upload : EventType.init_quote_part_3d_file_upload;
    await eventBus.publish({
      type: eventType,
      payload: { quoteId, partId, fileKey: decodedKey, fileName },
    });

    log.info("S3 event → FileUploaded published", { quoteId, partId, fileType, key });
  }

  return h.response({ received: true, processed: records.length }).code(200);
}
