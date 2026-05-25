import type {
  RouteDefMethods,
  RouteRules,
  Server,
  ServerRoute,
} from "@hapi/hapi";

const healthRoute: ServerRoute = {
  method: "GET",
  path: "/health",
  handler: (request, h) => {
    return h.response("Health Ok").code(200);
  },
};

const ROUTES = [healthRoute];

export default ROUTES;
