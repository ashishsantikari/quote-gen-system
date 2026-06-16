export const proxyPlugin = {
  name: "proxy",
  version: "1.0.0",
  register: async function (server: any) {
    const proxyConfigs: { prefix: string; upstream: string; label: string }[] = [
      {
        prefix: "/console",
        upstream: "http://localhost:9001",
        label: "Minio Console",
      },
      {
        prefix: "/mailpit",
        upstream: "http://localhost:8025",
        label: "Mailpit",
      },
      {
        prefix: "/redis",
        upstream: "http://localhost:5540",
        label: "RedisInsight",
      },
    ];

    for (const { prefix, upstream, label } of proxyConfigs) {
      server.route({
        method: "*",
        path: `${prefix}/{path*}`,
        handler: {
          proxy: {
            mapUri: (request: any) => {
              const tail = request.params.path || "";
              return { uri: `${upstream}/${tail}` };
            },
            passThrough: true,
            xforward: true,
          },
        },
        options: {
          auth: false,
          description: `Proxy to ${label}`,
          tags: ["api", "proxy"],
        },
      });

      server.route({
        method: "*",
        path: `${prefix}`,
        handler: {
          proxy: {
            uri: `${upstream}/`,
            passThrough: true,
            xforward: true,
          },
        },
        options: {
          auth: false,
          description: `Proxy root to ${label}`,
          tags: ["api", "proxy"],
        },
      });
    }
  },
};
