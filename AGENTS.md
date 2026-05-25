# AGENTS.md

## Runtime & Toolchain
- Use `bun` for everything (runtime, package manager, test runner, bundler)
- `bun run dev` — API Gateway with watch (`bun --watch index.ts`)
- `bun run start` — API Gateway without watch
- `bun run worker` — workers with watch (`bun --watch worker.ts`)
- `bun run start:worker` — workers without watch
- `bun test` — all tests; `bun test tests/unit` — unit; `bun test tests/integration` — integration

### Local Dev Setup
- `docker compose up -d` — starts MongoDB, Minio (S3), and Redis
- `cp .env.example .env` — default env connects to these services
- Minio console: `http://localhost:9001` (user: minioadmin, pass: minioadmin)
- Redis URL auto-detected: set `REDIS_URL` in `.env` to use Redis event bus, omit for InMemory

## Architecture

```
                    ┌─────────────────────────────┐
                    │     Hapi API Gateway (:3000) │
                    │  CSRF │ QuotePlugin │ Admin  │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ↓                    ↓                    ↓
        ┌──────────┐       ┌──────────────┐      ┌──────────┐
        │ MongoDB  │       │   S3/Minio   │      │  Event   │
        │(mongoose)│       │(presigned PUT│      │   Bus    │
        └────▲─────┘       │   uploads)   │      └────┬─────┘
             │             └──────────────┘           │
             │                  ↑                     │
      IDataService         IFileStorage          subscribe/publish
             │                  │                     │
             └──────────────────┼─────────────────────┘
                                │
    ┌───────────────────────────┼───────────────────────────┐
    │                       WORKERS (13)                     │
    │                                                        │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐               │
    │  │  formProc │ │ 2dProc  │ │ 3dProc   │  per-part     │
    │  │           │ │  +CB    │ │  +CB     │  per-stage    │
    │  └─────┬─────┘ └────┬────┘ └────┬─────┘               │
    │        │             │          │                      │
    │        └──────┬──────┘          │                      │
    │               ↓                 ↓                      │
    │        ┌──────────────┐ ┌──────────────┐              │
    │        │partCompletion│ │quoteCompletion│ 25s timer   │
    │        └──────┬───────┘ └──────┬───────┘              │
    │               ↓                ↓                       │
    │        ┌─────────────────────────────┐                │
    │        │       quoteGenerator        │ external svc   │
    │        │  (QuoteInfoComplete |       │                │
    │        │   QuoteTimedOut → gen)     │                │
    │        └──────────────┬──────────────┘                │
    │                       ↓                                │
    │        ┌──────────────┼──────────────┐                │
    │        ↓              ↓              ↓                │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
    │  │notifySvc │  │pdfGenSvc │  │emailWorker│            │
    │  │(websock) │  │(pdf gen) │  │(sends     │            │
    │  │          │  │          │  │ email+pdf)│            │
    │  └──────────┘  └──────────┘  └──────────┘            │
    │                                                        │
    │  mongoPersister ← ONLY DB writer (all result events)   │
    │  cleanupWorker  ← 24h expiry → delete S3 → CANCELLED   │
    │  retryQueue     ← manual RetryCommand                  │
    │  deadLetter     ← OperationFailed → retry collection   │
    │                                                        │
    │  infra: withRetry(3, 1s→2s→4s) + CircuitBreaker(5/120s, open=30s)│
    └────────────────────────────────────────────────────────┘
```

### Framework
- **@hapi/hapi** — HTTP framework (ignore CLAUDE.md's Bun.serve() advice)
- `routes.ts` at root is dead code; all routes live in Hapi plugins under `plugins/`

### Pattern: Ports & Adapters (Hexagonal)
- `core/ports/` — interfaces for IEventBus, IFileStorage, IEmailService, IDataService, INotificationService
- `adapters/` — implementations: InMemoryEventBus, S3FileStorage, SmtpEmailService, MongoDataService, WebSocketNotificationService
- All DB access goes through `IDataService` (never touch Mongoose directly from handlers/workers)
- `mongoPersister` is the ONLY worker that writes to MongoDB (via IDataService)

### Entry Points
- `index.ts` — Hapi API Gateway on `localhost:3000`, registers CSRF + Quote + Admin plugins
- `worker.ts` — Creates InMemoryEventBus, registers all 13 workers, starts cleanup interval

### Deployment Adapters (swappable presentation layer)
The ports & adapters pattern makes the API Gateway swappable without touching core logic:
- **Local dev**: Hapi server (`index.ts`, `plugins/`) — handles HTTP, CSRF, routing
- **AWS managed**: API Gateway + Lambda (`serverless/handlers/`) — same core services, different entry
- What stays identical: `core/` (events, ports, infra), `adapters/` (Mongo, S3, email, event bus), `workers/` (all 13)
- What changes: HTTP layer — Hapi plugins vs Lambda handlers; CSRF moves to AWS WAF

### Quote Flow
1. POST /quote/create { parts[] } → QUOTE_INIT, generates presigned PUT URLs (2D+3D per part)
2. Client uploads files directly to S3/Minio via presigned URLs
3. POST /quote/{qid}/part/{pid}/confirm { type } → marks upload done
4. POST /quote/{qid}/form { formData, email } → submits form
5. Workers process each part in 3 parallel stages (form, 2D, 3D)
6. When all parts+stages done → QuoteInfoComplete → quoteGenerator (external service)
7. QuoteGenerated → notificationService (websocket) + pdfGenerator → PdfGenerated → emailWorker
8. Transparency report flows through entire chain: any missing/errored data is documented with assumptions

### Quote States
QUOTE_INIT → QUOTE_FORM_UPLOAD_SUCCESS → QUOTE_INFO_COMPLETE | QUOTE_TIMED_OUT | CANCELLED

### Workers (13 total)
- formProcessor, twoDProcessor, threeDProcessor — per-part, per-stage processing
- partCompletion — aggregates 3 stages per part → PartProcessingComplete
- quoteCompletion — 25s timer; aggregates all parts → QuoteInfoComplete or QuoteTimedOut
- quoteGenerator — calls external quote generation service, publishes QuoteGenerated
- notificationService — websocket push to notify user on QuoteGenerated
- pdfGenerator — generates PDF from generated quote data, publishes PdfGenerated
- emailWorker — sends email with PDF attachment (subscribes to PdfGenerated)
- mongoPersister — ONLY DB writer; subscribes to ALL result events
- cleanupWorker — 24h expiry: deletes S3 files → CANCELLED
- retryQueue — processes manual RetryCommand
- deadLetter — captures OperationFailed into retry queue collection

### Reliability
- `core/infra/retry.ts` — withRetry, maxAttempts=3, backoff 1s→2s→4s
- `core/infra/circuitBreaker.ts` — 5 failures / 120s sliding window, OPEN for 30s; applied to 2D/3D processors
- Idempotency: every worker checks DB cache before processing (skip if output already exists)
- On failure: publishes output with `output: null, error: "..."` — processing continues
- Completion statuses: COMPLETE, COMPLETE_WITH_ERRORS, PARTIAL
- Transparency: quoteGenerator documents every assumption when data is missing/errored; report flows through notification → PDF → email

### Shared Events Library
- `core/events/types.ts` — single source of truth with `EventType` string constants + discriminated union
- All `publish()` and `subscribe()` calls use `EventType.*` — no magic strings in code

### Deployment (AWS)
- **Hapi**: ECS Fargate task behind Application Load Balancer (or API Gateway + Lambda swap)
- **Workers**: Each of the 13 workers runs as its own lightweight ECS Fargate task (or Lambda)
- **Event Bus**: SQS queues (prod) / InMemoryEventBus (dev)
- **Database**: MongoDB Atlas or DocumentDB
- **Storage**: S3 bucket with lifecycle policies
- **Infrastructure as Code**: CloudFormation template (`deployment/cloudformation.yaml`)
- **Containers**: Lightweight Docker images per worker (`deployment/docker/`), base: `oven/bun:alpine`

### API Endpoints
- POST /quote/create, POST /quote/{qid}/part/{pid}/confirm, POST /quote/{qid}/form
- GET /quote/{qid}, POST /quote/{qid}/regenerate-url
- GET /admin/retry-queue, POST /admin/retry/{qid}

### Dependencies
- mongodb driver: mongoose
- s3/minio: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
- email: nodemailer
- ids: uuid
- event bus (prod): ioredis (Redis pub/sub)
- event bus (dev): InMemoryEventBus (no Redis required)

## Testing
- `bun test` — framework; tests in `tests/unit/` (13 files) and `tests/integration/` (1 file)
- Unit tests mock all ports (IDataService, IEventBus, etc.)
- Integration test spins full Hapi server + all workers with InMemoryEventBus
