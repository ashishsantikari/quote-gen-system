import { createEventBus } from "./adapters/eventbus/RedisEventBus";
import { S3FileStorage } from "./adapters/storage/S3FileStorage";
import { createSmtpEmailServiceFromEnv } from "./adapters/email/SmtpEmailService";
import { WebSocketNotificationService } from "./adapters/notification/WebSocketNotificationService";
import { MongoDataService } from "./adapters/database/MongoDataService";
import { createDLQQueue } from "./adapters/queue/BullQueue";
import { formProcessor } from "./workers/formProcessor";
import { twoDProcessor } from "./workers/twoDProcessor";
import { threeDProcessor } from "./workers/threeDProcessor";
import { partCompletion } from "./workers/partCompletion";
import { quoteCompletion } from "./workers/quoteCompletion";
import { quoteGenerator } from "./workers/quoteGenerator";
import { notificationService } from "./workers/notificationService";
import { pdfGenerator } from "./workers/pdfGenerator";
import { emailWorker } from "./workers/emailWorker";
import { mongoPersister } from "./workers/mongoPersister";
import { cleanupWorker } from "./workers/cleanupWorker";
import { retryQueue } from "./workers/retryQueue";
import { deadLetter } from "./workers/deadLetter";
import { s3EventBridge } from "./workers/s3EventBridge";

async function main() {
  const dataService = await MongoDataService.create();
  const fileStorage = new S3FileStorage();
  const emailService = createSmtpEmailServiceFromEnv();
  const notifyService = new WebSocketNotificationService();
  const eventBus = createEventBus();

  // Stage processors
  formProcessor(dataService, eventBus);
  twoDProcessor(dataService, fileStorage, eventBus);
  threeDProcessor(dataService, fileStorage, eventBus);

  // Aggregation
  partCompletion(eventBus);
  quoteCompletion(dataService, eventBus);

  // Generation + delivery chain
  quoteGenerator(dataService, eventBus);
  notificationService(notifyService, eventBus);
  pdfGenerator(fileStorage, eventBus);
  emailWorker(dataService, emailService, eventBus);

  // Persistence
  mongoPersister(dataService, eventBus);

  // Operational
  const expiryHours = parseInt(process.env.QUOTE_EXPIRY_HOURS || "24", 10);
  cleanupWorker(dataService, fileStorage, eventBus, expiryHours);
  const dlq = createDLQQueue();
  retryQueue(dataService, eventBus);
  deadLetter(eventBus, dlq);

  // Minio S3 event notification bridge
  s3EventBridge(eventBus);

  console.log("All 14 workers registered");
}

main().catch((err) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "fatal", msg: "worker startup failed", error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
