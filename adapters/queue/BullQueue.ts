import { Queue } from "bullmq";
import { Logger } from "../../core/telemetry/logger";

const log = new Logger({ component: "BullQueue" });

export function createDLQQueue(): Queue {
  const redisUrl = process.env.REDIS_URL;
  const connection = redisUrl
    ? { url: redisUrl }
    : {
        host: process.env.REDIS_HOST || "localhost",
        port: parseInt(process.env.REDIS_PORT || "6379", 10),
      };

  const queue = new Queue("dead-letter-queue", { connection });
  log.info("DLQ queue created", { queueName: "dead-letter-queue" });
  return queue;
}
