import type {
  Plugin,
  Request,
  ResponseObject,
  ResponseToolkit,
  Server,
  ServerRoute,
} from "@hapi/hapi";

const handler = async (
  request: Request,
  h: ResponseToolkit,
): Promise<ResponseObject> => {
  return h.response({ message: "Healthcheck ok" }).code(200);
};

const healthcheckRoutes: ServerRoute[] = [
  {
    method: "GET",
    path: "/health",
    handler: handler,
    options: {
      description: "Pings for service health check",
      tags: ["health"],
    },
  },
];

interface HealthcheckPluginOptions {}

const HealthCheckPlugin: Plugin<HealthcheckPluginOptions> = {
  name: "healthcheck",
  version: "1.0.0",
  register: async (server: Server, options: HealthcheckPluginOptions) => {
    server.route(healthcheckRoutes);
    // server.expose()
  },
};

export default HealthCheckPlugin;
