# AGENTS.md

## Runtime & Toolchain
- Use `bun` for everything (runtime, package manager, test runner, bundler)
- `bun run dev` — API Gateway with watch (`bun --watch index.ts`)
- `bun run start` — API Gateway without watch
- `bun run worker` — workers with watch (`bun --watch worker.ts`)
- `bun run start:worker` — workers without watch
- `bun test` — all tests; `bun test tests/unit` — unit; `bun test tests/integration` — integration

### Local Dev Setup
- `docker compose up -d` — starts MongoDB, Minio (S3), Redis, RedisInsight, and Mailpit (SMTP)
- `cp .env.example .env` — default env connects to these services
- Minio console: `http://localhost:9001` (user: minioadmin, pass: minioadmin)
- RedisInsight: `http://localhost:5540` (connect to host: `redis`, port: `6379`)
- Mailpit (email catcher): `http://localhost:8025` — SMTP on 1025, no real delivery
- Bull Board (DLQ monitor): `http://localhost:3000/admin/queues` — embedded in API Gateway
- Redis URL auto-detected: set `REDIS_URL` in `.env` to use Redis event bus, omit for InMemory
- For file uploads to auto-trigger processing, run both `bun run dev` and `bun run worker` (s3EventBridge bridges Minio Redis notifications)

## Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │        Hapi API Gateway (:3000)               │
                    │  CSRF │ QuotePlugin │ Admin │ S3HookPlugin   │
                    │        Bull Board (DLQ monitor)               │
                    └──────────────┬───────────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ↓                    ↓                    ↓
        ┌──────────┐       ┌──────────────┐      ┌──────────┐
        │ MongoDB  │       │   S3/Minio   │      │  Event   │
        │(mongoose)│       │(presigned PUT│      │   Bus    │
        └────▲─────┘       │   uploads)   │      └────┬─────┘
             │             │              │           │
             │             │ Minio notif→Redis        │
             │             │ ─────────────┘           │
             │             │      │                   │
       IDataService    IFileStorage  │          subscribe/publish
             │             │        │                   │
             │             │   s3EventBridge     ┌──────┴──────┐
             │             │   (Minio→Redis→Bus) │  BullMQ DLQ │
             │             │                     │  (Redis)    │
             └─────────────┼────────┼────────────┴──────┬──────┘
                           │        │                    │
    ┌──────────────────────┼────────┼────────────────────┼──────────┐
    │                  WORKERS (14)                       │          │
    │                                                    │          │
    │  ┌──────────┐ ┌──────────┐ ┌──────────┐           │          │
    │  │  formProc │ │ 2dProc  │ │ 3dProc   │  per-part │          │
    │  │  +CB     │ │  +CB    │ │  +CB     │  per-stage│          │
    │  └─────┬─────┘ └────┬────┘ └────┬─────┘           │          │
    │        │             │          │                  │          │
    │        └──────┬──────┘          │                  │          │
    │               ↓                 ↓                  │          │
    │        ┌──────────────┐ ┌──────────────┐          │          │
    │        │partCompletion│ │quoteCompletion│ 25s timer│          │
    │        └──────┬───────┘ └──────┬───────┘          │          │
    │               ↓                ↓                   │          │
    │        ┌─────────────────────────────┐            │          │
    │        │       quoteGenerator        │ external   │          │
    │        │  (QuoteInfoComplete |       │ svc        │          │
    │        │   QuoteTimedOut → gen)     │            │          │
    │        └──────────────┬──────────────┘            │          │
    │                       ↓                            │          │
    │        ┌──────────────┼──────────────┐            │          │
    │        ↓              ↓              ↓            │          │
    │  ┌──────────┐  ┌──────────┐  ┌──────────┐        │          │
    │  │notifySvc │  │pdfGenSvc │  │emailWorker│        │          │
    │  │(websock) │  │(pdf gen) │  │(sends     │        │          │
    │  │          │  │          │  │ email+pdf)│        │          │
    │  └──────────┘  └──────────┘  └──────────┘        │          │
    │                                                    │          │
    │  ┌───────────────┐  ┌──────────────┐              │          │
    │  │ s3EventBridge │  │mongoPersister│ ← ONLY DB    │          │
    │  │ (Minio→event  │  │(all results, │   writer     │          │
    │  │  bus bridge)  │  │ completeness │              │          │
    │  └───────────────┘  │ check)       │              │          │
    │                     └──────────────┘              │          │
    │                                                    │          │
    │  cleanupWorker  ← 24h expiry → delete S3 → CANCELLED         │
    │  retryQueue     ← manual RetryCommand                        │
    │  deadLetter     ← OperationFailed → BullMQ DLQ + DB persist  │
    │                                                    │          │
    │  infra: withRetry(3, 1s→2s→4s) +                   │          │
    │         CircuitBreaker(5/120s, open=30s) on all 3 stage procs │
    └────────────────────────────────────────────────────┴──────────┘
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
- `index.ts` — Hapi API Gateway on `localhost:3000`, registers CSRF + Logging + Quote + Admin + S3Hook + Health plugins
- `worker.ts` — Creates event bus, registers all 14 workers, starts cleanup interval

### Deployment Adapters (swappable presentation layer)
The ports & adapters pattern makes the API Gateway swappable without touching core logic:
- **Local dev**: Hapi server (`index.ts`, `plugins/`) — handles HTTP, CSRF, routing
- **AWS managed**: API Gateway + Lambda (`serverless/handlers/`) — same core services, different entry
- What stays identical: `core/` (events, ports, infra), `adapters/` (Mongo, S3, email, event bus), `workers/` (all 14)
- What changes: HTTP layer — Hapi plugins vs Lambda handlers; CSRF moves to AWS WAF

### ID Format
- Quote IDs: `q-<12 hex>` (e.g., `q-a1b2c3d4e5f6`) — generated via `core/ids.ts` using `crypto.randomBytes(6)`
- Part IDs: `p-<12 hex>` (e.g., `p-f7e8d9c0b1a2`) — same generator
- Joi validation uses pattern `/^q-[a-f0-9]{12}$/` and `/^p-[a-f0-9]{12}$/` instead of `.uuid()`
- Trace/Span IDs and CSRF tokens retain standard UUIDs (internal use)

### Quote Flow
1. POST /quote/create { parts[] } → QUOTE_INIT, generates presigned PUT URLs (2D+3D per part)
2. Client uploads files directly to S3/Minio via presigned URLs
3. Minio bucket notification → Redis → s3EventBridge worker → FileUploaded event published automatically
4. Or, manual fallback: POST /quote/{qid}/part/{pid}/confirm { type } → FileUploaded event (idempotent: skips if file2DUploaded/file3DUploaded already true)
5. POST /quote/{qid}/form { formData, email } → FormUploaded event (idempotent: skips if formSubmitted already true)
6. mongoPersister persists each upload, then checks DB for completeness (formSubmitted + all parts file2DUploaded + file3DUploaded)
7. When complete → mongoPersister updates status to QUOTE_DATA_NORMALIZATION_BEGIN, publishes quote_data_normalization_begin + quote_all_mandatory_data_receipt → quoteCompletion starts 25s timer
8. Workers process each part in 3 parallel stages (form, 2D, 3D) — all with CircuitBreaker + withRetry(3)
9. When all parts+stages done within 25s → quote_data_normalization_complete → quoteGenerator
10. If timer expires → quote_data_normalization_timed_out → quoteGenerator (partial data); pending parts pushed to retry queue as error_operation_fail events
11. quote_ready → notificationService (websocket) + pdfGenerator → quote_pdf_complete → emailWorker
12. error_operation_fail events flow to both MongoDB RetryQueue (data reliability) and BullMQ DLQ (monitoring + retry processing)
13. Transparency report flows through entire chain: any missing/errored data is documented with assumptions

### Quote States
QUOTE_INIT → QUOTE_FORM_UPLOAD_SUCCESS → QUOTE_DATA_NORMALIZATION_BEGIN → QUOTE_INFO_COMPLETE | QUOTE_TIMED_OUT → QUOTE_DATA_READY | CANCELLED

### Key Events
- `quote_all_mandatory_data_receipt` — published by mongoPersister after completeness check confirms form + all 2D + all 3D are present; starts 25s processing timer in quoteCompletion
- `quote_data_normalization_begin` — published by mongoPersister (before all_mandatory_data_receipt); mongoPersister persists status QUOTE_DATA_NORMALIZATION_BEGIN
- Timer only starts at `quote_all_mandatory_data_receipt`, not at `init_quote_creation_request`
- `quoteCompletion` queries DB on timeout for accurate pending parts (DB is source of truth)

### Workers (14 total)
- formProcessor, twoDProcessor, threeDProcessor — per-part, per-stage processing, all with CircuitBreaker
- partCompletion — aggregates 3 stages per part → PartProcessingComplete
- quoteCompletion — subscribes to quote_all_mandatory_data_receipt, starts 25s timer; aggregates all parts → quote_data_normalization_complete or quote_data_normalization_timed_out
- quoteGenerator — calls external quote generation service, publishes quote_ready
- notificationService — websocket push to notify user on quote_ready
- pdfGenerator — generates PDF from generated quote data, publishes quote_pdf_complete
- emailWorker — sends email with PDF attachment (subscribes to quote_pdf_complete)
- mongoPersister — ONLY DB writer; persists ALL result events; runs completeness check after upload flushes; publishes quote_data_normalization_begin + quote_all_mandatory_data_receipt
- s3EventBridge — subscribes to Minio Redis notification channel `minio-events`, translates S3 events into FileUploaded on the event bus
- cleanupWorker — 24h expiry: deletes S3 files → CANCELLED
- retryQueue — processes manual RetryCommand
- deadLetter — subscribes to error_operation_fail, enqueues to BullMQ DLQ (Redis) for monitoring + retry

### Reliability
- `core/infra/retry.ts` — withRetry, maxAttempts=3, backoff 1s→2s→4s
- `core/infra/circuitBreaker.ts` — 5 failures / 120s sliding window, OPEN for 30s; applied to all 3 stage processors (form, 2D, 3D)
- Idempotency: every worker checks DB cache before processing (skip if output already exists)
- Upload idempotency: API handlers check formSubmitted/file2DUploaded/file3DUploaded before publishing events; mongoPersister tracks flushed uploads in-memory to skip duplicates
- Mongoose models use `try { model() } catch { model(name, schema) }` guard against hot-reload re-registration
- On failure: publishes output with `output: null, error: "..."` — processing continues
- Completion statuses: COMPLETE, COMPLETE_WITH_ERRORS, PARTIAL
- Transparency: quoteGenerator documents every assumption when data is missing/errored; report flows through notification → PDF → email

### Shared Events Library
- `core/events/types.ts` — single source of truth with `EventType` string constants + discriminated union
- All `publish()` and `subscribe()` calls use `EventType.*` — no magic strings in code

### Deployment (AWS)
- **Hapi**: ECS Fargate task behind Application Load Balancer (or API Gateway + Lambda swap)
- **Workers**: Each of the 14 workers runs as its own lightweight ECS Fargate task (or Lambda)
- **Event Bus**: SQS queues (prod) / InMemoryEventBus (dev)
- **Database**: MongoDB Atlas or DocumentDB
- **Storage**: S3 bucket with lifecycle policies and Minio Redis event notifications
- **Infrastructure as Code**: CloudFormation template (`deployment/cloudformation.yaml`)
- **Containers**: Lightweight Docker images per worker (`deployment/docker/`), base: `oven/bun:alpine`

### API Endpoints
- POST /quote/create, POST /quote/{qid}/part/{pid}/confirm, POST /quote/{qid}/form
- GET /quote/{qid}, POST /quote/{qid}/regenerate-url
- POST /internal/s3-event — Minio/AWS S3 webhook endpoint (CSRF-exempt, internal only)
- GET /admin/retry-queue, POST /admin/retry/{qid}
- GET /admin/queues — Bull Board DLQ monitor (embedded in API Gateway)

### Dependencies
- mongodb driver: mongoose
- s3/minio: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
- email: nodemailer
- ids: crypto.randomBytes (core/ids.ts) — no uuid package needed for resource IDs
- event bus (prod): ioredis (Redis pub/sub)
- event bus (dev): InMemoryEventBus (no Redis required)
- Minio notifications: ioredis (Minio publishes to Redis channel `minio-events`, s3EventBridge subscribes)
- DLQ: bullmq (Redis-based dead letter queue) + @bull-board/hapi (embedded monitoring UI)

## Testing
- `bun test` — framework; tests in `tests/unit/` (14 files) and `tests/integration/` (1 file)
- Unit tests mock all ports (IDataService, IEventBus, etc.)
- Integration test spins full Hapi server + all workers with InMemoryEventBus
