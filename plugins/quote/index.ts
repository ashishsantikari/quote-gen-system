import type { Plugin } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import QuoteRoutes from "./routes";

interface QuotePluginOptions {
  dataService: IDataService;
  fileStorage: IFileStorage;
  eventBus: IEventBus;
}

const QuotePlugin: Plugin<QuotePluginOptions> = {
  name: "quote",
  version: "1.0.0",
  register: async (server, options) => {
    const { dataService, fileStorage, eventBus } = options;
    server.expose("dataService", dataService);
    server.expose("fileStorage", fileStorage);
    server.expose("eventBus", eventBus);
    server.route(QuoteRoutes);
  },
};

export default QuotePlugin;
