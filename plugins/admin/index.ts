import type { Plugin } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import AdminRoutes from "./routes";

interface AdminPluginOptions {
  dataService: IDataService;
  eventBus: IEventBus;
}

const AdminPlugin: Plugin<AdminPluginOptions> = {
  name: "admin",
  version: "1.0.0",
  register: async (server, options) => {
    const { dataService, eventBus } = options;
    server.expose("dataService", dataService);
    server.expose("eventBus", eventBus);
    server.route(AdminRoutes);
  },
};

export default AdminPlugin;
