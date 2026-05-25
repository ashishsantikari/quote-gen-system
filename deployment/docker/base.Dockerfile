FROM oven/bun:alpine
WORKDIR /app
COPY bun.lock package.json ./
RUN bun install --production
