import type { Plugin } from "@hapi/hapi";
import type { ServerRoute } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { s3EventHandler } from "./handlers";

interface S3HookPluginOptions {
  dataService: IDataService;
  eventBus: IEventBus;
}

const routes: ServerRoute[] = [
  {
    method: "POST",
    path: "/internal/s3-event",
    handler: s3EventHandler,
    options: {
      description: "Internal S3/Minio bucket event notification webhook",
      notes: "Receives s3:ObjectCreated:Put events from Minio/AWS S3 and publishes FileUploaded on the event bus.",
      tags: ["internal"],
      auth: false as const,
    },
  },
];

const S3HookPlugin: Plugin<S3HookPluginOptions> = {
  name: "s3hook",
  version: "1.0.0",
  register: async (server, options) => {
    const { dataService, eventBus } = options;
    server.expose("dataService", dataService);
    server.expose("eventBus", eventBus);
    server.route(routes);
  },
};

export default S3HookPlugin;
