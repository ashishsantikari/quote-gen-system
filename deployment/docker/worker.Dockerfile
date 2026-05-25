ARG WORKER_NAME=formProcessor
FROM oven/bun:alpine AS base
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --production
COPY . .
ENV WORKER_NAME=${WORKER_NAME}
CMD bun worker.ts
