import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { HapiAdapter } from "@bull-board/hapi";
import type { Queue } from "bullmq";
import path from "path";
import { fileURLToPath } from "url";

export const bullBoardPlugin = {
  name: "bullboard",
  version: "1.0.0",
  register: async function (server: any, options: { queues: Queue[] }) {
    const resolvedUrl = import.meta.resolve("@bull-board/ui/package.json");
    const uiPackageDir = path.dirname(fileURLToPath(resolvedUrl));

    const serverAdapter = new HapiAdapter();
    serverAdapter.setBasePath("/admin/queues");

    createBullBoard({
      queues: options.queues.map((q) => new BullMQAdapter(q)),
      serverAdapter,
      options: {
        uiBasePath: uiPackageDir,
        uiConfig: {
          boardTitle: "Dead Letter Queue",
          miscLinks: [],
          favIcon: { default: "", alternative: "" },
        },
      },
    });

    const plugin = serverAdapter.registerPlugin();
    await server.register(plugin, {
      routes: { prefix: "/admin/queues" },
    });

    server.route({
      method: "GET",
      path: "/admin/queues/",
      handler: (_request: any, h: any) => h.redirect("/admin/queues"),
    });
  },
};
