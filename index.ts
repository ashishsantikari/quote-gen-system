import Hapi from "@hapi/hapi";
import Vision from "@hapi/vision";
import Inert from "@hapi/inert";
import H2o2 from "@hapi/h2o2";
import HapiSwagger from "hapi-swagger";
import { MongoDataService } from "./adapters/database/MongoDataService";
import { S3FileStorage } from "./adapters/storage/S3FileStorage";
import { createEventBus } from "./adapters/eventbus/RedisEventBus";
import { createDLQQueue } from "./adapters/queue/BullQueue";
import CsrfPlugin from "./plugins/csrf";
import LoggingPlugin from "./plugins/logging";
import QuotePlugin from "./plugins/quote";
import { metricsText } from "./core/telemetry/metrics";
import AdminPlugin from "./plugins/admin";
import HealthCheckPlugin from "./plugins/health";
import S3HookPlugin from "./plugins/s3hook";
import { bullBoardPlugin } from "./plugins/bullboard";
import { proxyPlugin } from "./plugins/proxy";

async function main() {
  const dataService = await MongoDataService.create();
  const fileStorage = new S3FileStorage();
  const eventBus = createEventBus();
  const dlq = createDLQQueue();

  const server = Hapi.server({ port: 3000, host: "localhost" });

  const swaggerOptions: HapiSwagger.RegisterOptions = {
    info: {
      title: "Quote Generation System API",
      version: "1.0.0",
      description:
        "Multi-part quote creation with 2D/3D file uploads, event-driven processing, and email delivery",
    },
    documentationPath: "/docs",
    schemes: ["http"],
    grouping: "tags",
    sortEndpoints: "ordered",
  };

  await server.register([
    Vision,
    Inert,
    H2o2,
    { plugin: CsrfPlugin },
    { plugin: LoggingPlugin, options: {} },
    { plugin: HapiSwagger, options: swaggerOptions },
    { plugin: HealthCheckPlugin, options: {} },
    { plugin: QuotePlugin, options: { dataService, fileStorage, eventBus } },
    { plugin: AdminPlugin, options: { dataService, eventBus } },
    { plugin: S3HookPlugin, options: { dataService, eventBus } },
    { plugin: bullBoardPlugin, options: { queues: [dlq] } },
    { plugin: proxyPlugin },
  ]);

  server.route({
    method: "GET",
    path: "/metrics",
    handler: (_request, h) => {
      return h.response(metricsText()).type("text/plain");
    },
    options: { auth: false },
  });

  server.route({
    method: "GET",
    path: "/redoc",
    handler: (_request, h) => {
      return h
        .response(
          `<!DOCTYPE html>
<html>
<head>
  <title>Quote Generation System — ReDoc</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style> body { margin: 0; padding: 0; } </style>
</head>
<body>
  <redoc spec-url="/swagger.json" scroll-y-offset="0" hide-download-button></redoc>
  <script src="https://cdn.redoc.ly/redoc/latest/bundles/redoc.standalone.js"></script>
</body>
</html>`,
        )
        .type("text/html");
    },
    options: { auth: false },
  });

  await server.start();
  console.log("API Gateway running on %s", server.info.uri);
  console.log("Swagger UI:   %s/docs", server.info.uri);
  console.log("ReDoc:        %s/redoc", server.info.uri);
  console.log("Bull Board:   %s/admin/queues", server.info.uri);
  console.log("Minio Console:%s/console", server.info.uri);
  console.log("Mailpit:      %s/mailpit", server.info.uri);
  console.log("RedisInsight: %s/redis", server.info.uri);
}

main().catch((err) => {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "fatal", msg: "startup failed", error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
