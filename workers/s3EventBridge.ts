import Redis from "ioredis";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { parseS3Key } from "../core/ids";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "s3EventBridge" });
const CHANNEL = "minio-events";

interface S3RecordRaw {
  eventName?: string;
  eventVersion?: string;
  s3SchemaVersion?: string;
  configurationId?: string;
  bucket?: { name: string; arn?: string; ownerIdentity?: unknown };
  object?: { key: string; size?: number; eTag?: string; contentType?: string; sequencer?: string };
  source?: { host?: string; port?: string; userAgent?: string };
}

interface MinioNotification {
  EventName?: string;
  Key?: string;
  Records?: S3RecordRaw[];
}

function extractRecords(raw: unknown): S3RecordRaw[] {
  if (typeof raw !== "object" || raw === null) return [];

  const msg = raw as S3RecordRaw;
  if (msg.object?.key) return [msg];

  const notif = raw as MinioNotification;
  if (Array.isArray(notif.Records) && notif.Records.length > 0) {
    return notif.Records;
  }

  return [];
}

export function s3EventBridge(
  eventBus: IEventBus,
  redisUrl?: string
): void {
  const url = redisUrl || process.env.REDIS_URL || "redis://localhost:6379";
  const sub = new Redis(url, { lazyConnect: false });

  sub.on("error", (err) => {
    log.error("redis connection error", { error: err.message });
  });

  sub.subscribe(CHANNEL, (err) => {
    if (err) {
      log.error("failed to subscribe to minio-events", { error: err.message });
    } else {
      log.info("subscribed to Minio Redis notifications", { channel: CHANNEL });
    }
  });

  sub.on("message", async (channel: string, message: string) => {
    if (channel !== CHANNEL) return;

    log.info("received Minio notification", { preview: message.slice(0, 250) });

    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      log.warn("failed to parse Minio notification JSON");
      return;
    }

    const records = extractRecords(raw);
    if (records.length === 0) {
      log.warn("unrecognized notification format — no object key found", {
        preview: message.slice(0, 200),
      });
      return;
    }

    for (const record of records) {
      const key = record.object?.key;
      if (!key) {
        log.warn("notification record missing object.key");
        continue;
      }

      const parsed = parseS3Key(key);
      if (!parsed) {
        log.warn("key does not match quote upload pattern", { key });
        continue;
      }

      const { quoteId, partId, fileType, fileName, decodedKey } = parsed;
      const eventType = fileType === "2d" ? EventType.init_quote_part_2d_file_upload : EventType.init_quote_part_3d_file_upload;

      await eventBus.publish({
        type: eventType,
        payload: { quoteId, partId, fileKey: decodedKey, fileName },
      });

      log.info("Minio event → FileUploaded published", {
        quoteId,
        partId,
        fileType,
        fileName,
        size: record.object?.size,
      });
    }
  });
}
