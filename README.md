# Quote Generation System

Event-driven, multi-part quote generation system. Users create quotes with multiple parts, upload 2D and 3D files, submit form data, and receive a generated quote via email. Built on a hexagonal (ports & adapters) architecture with a Hapi API Gateway and ephemeral workers.

## Quick Start

### Prerequisites
- **Bun** ≥ 1.3 — runtime, package manager, test runner
- **Docker** — for local services (MongoDB, Minio, Redis, Mailpit)

### Setup
```bash
# Clone and install
git clone <repo-url>
cd quote-gen-system
bun install

# Start infrastructure
docker compose up -d

# Copy default env
cp .env.example .env

# Start API Gateway (port 3000)
bun run dev

# In another terminal, start workers
bun run worker
```

The API Gateway startup log will show all available URLs:

```
API Gateway running on http://localhost:3000
Swagger UI:   http://localhost:3000/docs
ReDoc:        http://localhost:3000/redoc
Bull Board:   http://localhost:3000/admin/queues
Minio Console:http://localhost:3000/console
Mailpit:      http://localhost:3000/mailpit
RedisInsight: http://localhost:3000/redis
```

### Verify

All services are proxied through the API Gateway on port 3000:

| Service | Proxy URL | Direct URL |
|---------|-----------|------------|
| API Gateway | http://localhost:3000 | — |
| Swagger Docs | http://localhost:3000/docs | — |
| Bull Board (DLQ) | http://localhost:3000/admin/queues | — |
| Minio Console | http://localhost:3000/console | http://localhost:9001 |
| Mailpit (email) | http://localhost:3000/mailpit | http://localhost:8025 |
| RedisInsight | http://localhost:3000/redis | http://localhost:5540 |
| Health Check | http://localhost:3000/health | — |
| Metrics | http://localhost:3000/metrics | — |

> **Note**: Minio Console and RedisInsight are SPAs that reference root-relative assets. Through the proxy, some styles or scripts may not load. Use the direct URLs for full functionality.

## Architecture

```
User  →  Hapi API Gateway (:3000)
              │
    ┌─────────┼─────────┐
    ↓         ↓         ↓
 MongoDB   S3/Minio   Event Bus (Redis pub/sub)
                              │
              ┌───────────────┼───────────────┐
              ↓               ↓               ↓
         formProcessor   twoDProcessor   threeDProcessor
         (+CB+retry)     (+CB+retry)     (+CB+retry)
              │               │               │
              └───────┬───────┘               │
                      ↓                       ↓
              partCompletion          quoteCompletion
                      ↓                       ↓
              quoteGenerator (external service)
                      ↓
         ┌────────────┼────────────┐
         ↓            ↓            ↓
   notification   pdfGenerator   emailWorker
   (websocket)    (PDF gen)      (email+PDF)
                                          
   mongoPersister ← ONLY DB writer
   s3EventBridge  ← Minio → event bus bridge
   deadLetter     → BullMQ DLQ (Redis)
   cleanupWorker  ← 24h expiry
   retryQueue     ← manual admin retry
```

### Pattern: Ports & Adapters (Hexagonal)
- **`core/ports/`** — interfaces (IEventBus, IFileStorage, IEmailService, IDataService, INotificationService)
- **`adapters/`** — implementations (RedisEventBus, S3FileStorage, SmtpEmailService, MongoDataService, BullQueue)
- **`workers/`** — event-driven worker functions (14 total)
- **`plugins/`** — Hapi plugins for API Gateway routes

All DB access goes through `IDataService`. `mongoPersister` is the ONLY worker that writes to MongoDB.

### Quote States
```
QUOTE_INIT → QUOTE_FORM_UPLOAD_SUCCESS → QUOTE_DATA_NORMALIZATION_BEGIN
  → QUOTE_INFO_COMPLETE | QUOTE_TIMED_OUT → QUOTE_DATA_READY | CANCELLED
```

### Key Events (19 types)
All events use snake_case naming. Defined in `core/events/types.ts`:
- `init_quote_creation_request`, `init_quote_form_upload`, `init_quote_part_2d_file_upload`, `init_quote_part_3d_file_upload`
- `part_form_complete`, `part_2d_complete`, `part_3d_complete`, `part_processing_complete`
- `quote_data_normalization_begin`, `quote_data_normalization_complete`, `quote_data_normalization_timed_out`
- `quote_all_mandatory_data_receipt`, `quote_ready`, `quote_pdf_complete`
- `quote_email_send`, `quote_notification_send`, `quote_cancel`
- `error_operation_fail`, `admin_retry_command`

### Reliability
- **withRetry**: 3 attempts, exponential backoff (1s → 2s → 4s)
- **CircuitBreaker**: 5 failures / 120s window → OPEN for 30s; applied to all 3 stage processors
- **Idempotency**: API handlers reject duplicate uploads; processors skip already-processed stages; mongoPersister tracks flushed uploads in-memory
- **DB-backed timer**: quoteCompletion queries DB for accurate part status on timeout
- **Dual DLQ**: `error_operation_fail` events flow to both MongoDB RetryQueue (reliability) and BullMQ (monitoring)

## Project Structure

```
├── index.ts              # API Gateway entry point (Hapi, port 3000)
├── worker.ts             # Worker entry point (all 14 workers)
├── core/
│   ├── events/types.ts   # Single source of truth — event types + payloads
│   ├── ports/            # Interfaces (IDataService, IEventBus, IFileStorage, ...)
│   ├── infra/            # retry.ts, circuitBreaker.ts
│   ├── models/Quote.ts   # Mongoose schemas (Quote, RetryQueue)
│   └── ids.ts            # Quote/Part ID generation (q-<12hex>, p-<12hex>)
├── adapters/
│   ├── database/         # MongoDataService — Mongoose CRUD
│   ├── storage/          # S3FileStorage — presigned URLs, file ops
│   ├── eventbus/         # RedisEventBus, InMemoryEventBus
│   ├── email/            # SmtpEmailService — nodemailer
│   ├── notification/     # WebSocketNotificationService
│   └── queue/BullQueue.ts# BullMQ DLQ factory
├── plugins/
│   ├── quote/            # Quote CRUD + confirm + form handlers
│   ├── admin/            # Retry queue management
│   ├── bullboard/        # Bull Board monitoring UI
│   ├── proxy/             # Reverse proxy to Minio, Mailpit, RedisInsight
│   ├── s3hook/           # Minio S3 event webhook
│   ├── csrf/             # CSRF protection
│   └── health/           # Health check endpoint
├── workers/
│   ├── formProcessor.ts  # Form data processing (+CB)
│   ├── twoDProcessor.ts  # 2D file processing (+CB)
│   ├── threeDProcessor.ts# 3D file processing (+CB)
│   ├── partCompletion.ts # Aggregates 3 stages per part
│   ├── quoteCompletion.ts# 25s timer + part aggregation
│   ├── quoteGenerator.ts # External quote generation
│   ├── pdfGenerator.ts   # PDF generation
│   ├── emailWorker.ts    # Email delivery
│   ├── notificationService.ts
│   ├── mongoPersister.ts # ONLY DB writer + completeness check
│   ├── s3EventBridge.ts  # Minio → event bus bridge
│   ├── deadLetter.ts     # BullMQ DLQ enqueue
│   ├── retryQueue.ts     # Admin retry command handler
│   └── cleanupWorker.ts  # 24h expiry → cancel + delete S3
└── tests/
    ├── unit/             # 14 worker test files (mocked ports)
    ├── contract/         # Event contract tests
    └── integration/      # Full Hapi + all workers end-to-end
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/quote/create` | Create quote with parts, get presigned upload URLs |
| POST | `/quote/{qid}/part/{pid}/confirm` | Confirm file upload (2d/3d) |
| POST | `/quote/{qid}/form` | Submit form data + email |
| GET | `/quote/{qid}` | Get quote status, parts, processing |
| POST | `/quote/{qid}/regenerate-url` | Regenerate expired presigned URL |
| POST | `/internal/s3-event` | Minio S3 webhook (internal) |
| GET | `/admin/retry-queue` | List pending retry entries |
| POST | `/admin/retry/{qid}` | Manually retry a failed quote |
| GET | `/admin/queues` | Bull Board DLQ monitor |
| GET | `/health` | Health check |
| GET | `/docs` | Swagger API docs |
| GET | `/metrics` | Prometheus metrics |

## Testing

```bash
bun test                    # All tests (112 tests, 16 files)
bun test tests/unit         # Unit tests only (mocked ports)
bun test tests/integration  # Integration test (full flow)
```

## Local Services (docker compose up -d)

| Service | Port | Purpose |
|---------|------|---------|
| MongoDB 7 | 27017 | Database |
| Minio (S3) | 9000, 9001 | File storage |
| Redis 7 | 6379 | Event bus + DLQ |
| Mailpit | 1025, 8025 | Email catcher (SMTP + web UI) |
| RedisInsight | 5540 | Redis browser |

## Circuit Breaker Testing

Set `CB_OPEN_FOREVER=true` in `.env` to make circuit breakers open on the 1st failure and stay open indefinitely. Useful for testing failure scenarios. Remove or set to `false` for normal operation.

## ID Format

- Quote IDs: `q-<12 hex>` (e.g., `q-a1b2c3d4e5f6`)
- Part IDs: `p-<12 hex>` (e.g., `p-f7e8d9c0b1a2`)
- Generated via `crypto.randomBytes(6)` in `core/ids.ts`
