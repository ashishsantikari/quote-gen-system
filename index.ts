import Hapi from "@hapi/hapi";
import Vision from "@hapi/vision";
import Inert from "@hapi/inert";
import HapiSwagger from "hapi-swagger";
import { MongoDataService } from "./adapters/database/MongoDataService";
import { S3FileStorage } from "./adapters/storage/S3FileStorage";
import { createEventBus } from "./adapters/eventbus/RedisEventBus";
import CsrfPlugin from "./plugins/csrf";
import LoggingPlugin from "./plugins/logging";
import QuotePlugin from "./plugins/quote";
import { metricsText } from "./core/telemetry/metrics";
import AdminPlugin from "./plugins/admin";
import HealthCheckPlugin from "./plugins/health";

async function main() {
  const dataService = await MongoDataService.create();
  const fileStorage = new S3FileStorage();
  const eventBus = createEventBus();

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
    { plugin: CsrfPlugin },
    { plugin: LoggingPlugin, options: {} },
    { plugin: HapiSwagger, options: swaggerOptions },
    { plugin: HealthCheckPlugin, options: {} },
    { plugin: QuotePlugin, options: { dataService, fileStorage, eventBus } },
    { plugin: AdminPlugin, options: { dataService, eventBus } },
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
  console.log("Swagger UI: %s/docs", server.info.uri);
  console.log("ReDoc:      %s/redoc", server.info.uri);
}

main().catch(console.error);
