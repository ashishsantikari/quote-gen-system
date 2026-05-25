# ARCHITECTURE.md

## Overview

Quote Generation System — users create quotes with multiple parts, upload 2D/3D files, and receive a generated quote via email. Built on an event-driven, hexagonal (ports & adapters) architecture with a Hapi API Gateway and ephemeral workers.

## High-Level Flow

```
User                   API Gateway              Event Bus              Workers                MongoDB / S3
 │                         │                        │                     │                       │
 ├─ POST /quote/create ──→│                        │                     │                       │
 │   { parts: [...] }     │──→ QuoteCreated ──────→│                     │                       │
 │                         │                        │                     │                       │
 │   ← presigned PUT URLs  │←────── IFileStorage ── S3 (presigned)        │                       │
 │                         │                        │                     │                       │
 ├─ upload 2D/3D files ──→│ (direct to S3) ──────────────────────────────────────────────────────→ S3
 │                         │                        │                     │                       │
 ├─ POST /{qid}/part/{pid}/confirm ─→│              │                     │                       │
 │   { type: "2d" }       │──→ FileUploaded{2d} ──→│                     │                       │
 │                         │                        │──→ twoDProcessor ──→│                       │
 │                         │                        │   (withRetry+CB)   │                       │
 │                         │                        │──→ Part2DProcessed →│──→ mongoPersister ──→ MongoDB
 │                         │                        │                     │                       │
 ├─ POST /{qid}/form       │──→ FormUploaded ──────→│──→ formProcessor ──→│──→ mongoPersister ──→ MongoDB
 │   { formData, email }   │                        │                     │                       │
 │                         │                        │──→ partCompletion ←─┤                       │
 │                         │                        │   (all 3 stages)   │                       │
 │                         │                        │──→ PartProcessingComplete ──→ mongoPersister │
 │                         │                        │                     │                       │
  │                         │                        │──→ quoteCompletion ←┤                       │
  │                         │                        │   (25s timer)      │                       │
  │                         │                        │──→ QuoteInfoComplete│                       │
  │                         │                        │    or QuoteTimedOut │                       │
  │                         │                        │                     │                       │
  │                         │                        │──→ quoteGenerator ─┤ (external service)    │
  │                         │                        │                     │                       │
  │                         │                        │──→ QuoteGenerated ─→│──→ mongoPersister ──→ MongoDB
  │                         │                        │                     │                       │
  │                         │                        │──→ notifySvc(websock) user notified       │
  │                         │                        │──→ pdfGenerator ───→│                       │
  │                         │                        │──→ PdfGenerated ───→│──→ mongoPersister ──→ MongoDB
  │                         │                        │                     │                       │
  │                         │                        │──→ emailWorker ────→│                       │
  │   ← email + PDF         │                        │   (sends email+pdf)                       │
  │   ← websocket notified  │                        │                     │                       │
  │                         │                        │                     │                       │
  │  (after 24h inactivity) │                        │──→ cleanupWorker ──→│                       │
  │                         │                        │   delete S3 → CANCELLED                     │
```

## Architecture Layers

```
┌──────────────────────────────────────────────────────────────┐
│                     PRESENTATION LAYER                        │
│                                                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  CSRF Plugin │  │Quote Plugin │  │Admin Plugin │          │
│  │  (security)  │  │ (business)  │  │ (retry ops) │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│                                                              │
│              Hapi API Gateway (index.ts)                     │
│                  localhost:3000                              │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│                     DOMAIN LAYER (core/)                      │
│                                                              │
│  ┌────────────┐  ┌──────────────────────────────────┐       │
│  │  Events    │  │  Ports (Interfaces)               │       │
│  │  types.ts  │  │  IEventBus | IFileStorage         │       │
│  │            │  │  IEmailService | IDataService     │       │
│  │            │  │  INotificationService             │       │
│  └────────────┘  └──────────────────────────────────┘       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Infrastructure                                     │     │
│  │  retry.ts (max 3, 1s→2s→4s)                        │     │
│  │  circuitBreaker.ts (5 failures / 120s sliding,     │     │
│  │                      OPEN for 30s)                  │     │
│  └────────────────────────────────────────────────────┘     │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│                    ADAPTER LAYER (adapters/)                  │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │InMemoryEvent │  │S3FileStorage │  │SmtpEmail     │       │
│  │     Bus      │  │(presigned PUT│  │   Service    │       │
│  │              │  │ + batch del) │  │              │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌──────────────────────────────────────────────────┐       │
│  │  MongoDataService                                 │       │
│  │  (Mongoose — Quote + RetryQueue collections)     │       │
│  │  - createQuote, getQuote, submitForm,             │       │
│  │  - updatePartStage, updateQuoteStatus,            │       │
│  │  - findExpiredQuotes, addToRetryQueue, ...        │       │
│  └──────────────────────────────────────────────────┘       │
└──────────────────────────┬───────────────────────────────────┘
                           │
┌──────────────────────────┼───────────────────────────────────┐
│                    WORKER LAYER (workers/)                    │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐             │
│  │ 3 stage    │  │ 2 aggregate│  │ quote      │             │
│  │ processors │  │ processors │  │ generator  │             │
│  │            │  │            │  │ (ext svc)  │             │
│  │ formProc   │  │partComple  │  │            │             │
│  │ 2dProc+CB  │  │ tion       │  └─────┬──────┘             │
│  │ 3dProc+CB  │  │quoteComple │        │                    │
│  │            │  │ tion (25s) │        ↓                    │
│  └────────────┘  └────────────┘  ┌──────────────────┐       │
│                                   │ notifySvc(ws)   │       │
│  ┌────────────┐  ┌────────────┐  │ pdfGenerator     │       │
│  │mongo       │  │cleanup     │  │ emailWorker      │       │
│  │Persister   │  │Worker      │  └──────────────────┘       │
│  │(ONLY DB w) │  │(24h exp)   │                             │
│  └────────────┘  └────────────┘                             │
│                                                              │
│  ┌────────────┐  ┌────────────┐                             │
│  │retryQueue  │  │deadLetter  │                             │
│  │(manual)    │  │(failure→DL)│                             │
│  └────────────┘  └────────────┘                             │
└──────────────────────────────────────────────────────────────┘
```

## Event-Driven Processing

### Event Types

| Event | Publisher | Subscribers | Carries |
|---|---|---|---|
| `QuoteCreated` | API Gateway | mongoPersister, quoteCompletion | quoteId, parts[] |
| `FormUploaded` | API Gateway | formProcessor, mongoPersister | quoteId, formData, email |
| `FileUploaded` | API Gateway | 2d/3dProcessor, mongoPersister | quoteId, partId, fileType, fileKey |
| `PartFormProcessed` | formProcessor | partCompletion, mongoPersister | quoteId, partId, output, error? |
| `Part2DProcessed` | twoDProcessor | partCompletion, mongoPersister | quoteId, partId, output, error? |
| `Part3DProcessed` | threeDProcessor | partCompletion, mongoPersister | quoteId, partId, output, error? |
| `PartProcessingComplete` | partCompletion | quoteCompletion, mongoPersister | quoteId, partId |
| `QuoteInfoComplete` | quoteCompletion | quoteGenerator, mongoPersister | quoteId, completionStatus |
| `QuoteTimedOut` | quoteCompletion | quoteGenerator, mongoPersister | quoteId, completedParts, pendingParts |
| `QuoteGenerated` | quoteGenerator | notificationService, pdfGenerator, mongoPersister | quoteId, generatedData |
| `PdfGenerated` | pdfGenerator | emailWorker, mongoPersister | quoteId, pdfKey, pdfUrl |
| `EmailSent` | emailWorker | mongoPersister | quoteId, sentAt |
| `NotificationSent` | notificationService | mongoPersister | quoteId, channel |
| `OperationFailed` | any worker | deadLetter | quoteId, partId, stage, error, attempts |
| `RetryCommand` | Admin API | retryQueue | quoteId |
| `QuoteCancelled` | cleanupWorker | mongoPersister | quoteId |

### Processing a Single Part (3 parallel stages)

```
                   FormUploaded        FileUploaded{2d}       FileUploaded{3d}
                       │                     │                     │
                       ↓                     ↓                     ↓
                 ┌──────────┐          ┌──────────┐          ┌──────────┐
                 │  form    │          │  2D      │          │  3D      │
                 │Processor │          │Processor │          │Processor │
                 │          │          │ +CB      │          │ +CB      │
                 └────┬─────┘          └────┬─────┘          └────┬─────┘
                      │                     │                     │
                      ↓                     ↓                     ↓
               PartFormProcessed     Part2DProcessed       Part3DProcessed
                      │                     │                     │
                      └─────────────────────┼─────────────────────┘
                                            ↓
                                    ┌──────────────┐
                                    │partCompletion│
                                    │ (waits for   │
                                    │  all 3)      │
                                    └──────┬───────┘
                                           ↓
                                  PartProcessingComplete
```

## Reliability

### Retry Policy

```
Attempt 1: immediate
  ↓ failure
Attempt 2: wait 1s
  ↓ failure
Attempt 3: wait 2s
  ↓ failure
Attempt 4: wait 4s — maxAttempts=3 exhausted
  ↓
Publish OperationFailed → deadLetter → retry queue collection
Publish result with output: null, error: "message"
```

### Circuit Breaker (5 failures / 120s window, OPEN for 30s) — 2D and 3D processors only

```
CLOSED (normal) ──(5 failures in 120s window)──→ OPEN
OPEN ──(30s elapsed)──→ HALF_OPEN
HALF_OPEN ──(1 success)──→ CLOSED
HALF_OPEN ──(1 failure)──→ OPEN
```

### Idempotency

Every stage processor checks MongoDB before executing:
```
if part.formOutput exists → skip form processing
if part.file2DOutput exists → skip 2D processing
if part.file3DOutput exists → skip 3D processing
```

Retries are safe — cached outputs prevent duplicate work and duplicate S3 costs.

### 25-Second Timer

`quoteCompletion` starts a 25s timer on `QuoteCreated`. If all parts complete within the window → `QuoteInfoComplete`. If timer fires first → `QuoteTimedOut` with null values for pending stages, `completionStatus: PARTIAL`.

## Transparency Flow

```
quoteGenerator receives QuoteInfoComplete / QuoteTimedOut
  │
  ├─ 1. Reads all part data from IDataService
  │
  ├─ 2. Builds Transparency Report:
  │     For each part × each stage (form/2d/3d):
  │       ✓ output exists → include in generation payload
  │       ✗ error → log: "Part #3 (Bracket) 2D: S3 timeout → used default"
  │       ⏳ timed out → log: "Part #5 (Panel) 3D: not in time → used estimate"
  │
  ├─ 3. Sends to external service:
  │     { data: { parts: [...] }, transparency: { assumptions: [...] } }
  │
  └─ 4. Publishes QuoteGenerated with transparency:
        {
          quoteId,
          generatedData,
          transparency: {
            totalStages, successful, errored, timedOut,
            dataCompleteness, assumptions[]
          }
        }
          │
          ├──→ notificationService (websocket: shows assumptions to user)
          ├──→ pdfGenerator (PDF includes transparency section)
          └──→ emailWorker (email body + PDF show all assumptions)
```

### Full Transparency Chain

```
QuoteInfoComplete/QuoteTimedOut (with partErrors)
  → quoteGenerator (external service, includes transparency report)
    → QuoteGenerated (with transparency)
      → mongoPersister (stores transparency in DB)
      → notificationService →
      → pdfGenerator → PdfGenerated →
        → emailWorker (email body + PDF attachment)
```

Every downstream service reads `transparency` from the `QuoteGenerated` event — no need to re-query MongoDB.

```
QUOTE_INIT ────────────────────────── (just created, presigned URLs ready)
    │
    ├── form submitted?
    │       ↓
    │   QUOTE_FORM_UPLOAD_SUCCESS ── (email + form data received)
    │       │
    │       ├── all parts processed within 25s?
    │       │       ↓
    │       │   QUOTE_INFO_COMPLETE ──→ quoteGenerator (external svc) → QuoteGenerated
    │       │       ↓
    │       │   notificationService (websocket) | pdfGenerator → PdfGenerated → emailWorker
    │       │
    │       ├── 25s timer expired?
    │       │       ↓
    │       │   QUOTE_TIMED_OUT ──→ quoteGenerator (partial data) → same chain
    │       │
    │       └── 24h elapsed without completion?
    │               ↓
    │           CANCELLED ──→ S3 files deleted
    │
    └── 24h elapsed without form submission?
            ↓
        CANCELLED ──→ S3 files deleted
```

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/quote/create` | CSRF | Create quote with parts list, get presigned URLs |
| POST | `/quote/{quoteId}/part/{partId}/confirm` | CSRF | Mark a file as uploaded |
| POST | `/quote/{quoteId}/form` | CSRF | Submit form data and email |
| GET | `/quote/{quoteId}` | CSRF | Get quote status, parts, and processing outputs |
| POST | `/quote/{quoteId}/regenerate-url` | CSRF | Regenerate expired presigned URL |
| GET | `/admin/retry-queue` | — | List pending retry entries |
| POST | `/admin/retry/{quoteId}` | — | Manually re-process a failed quote |

## Data Model

### Quote Collection (Mongoose)
```
{
  quoteId: string (uuid, unique index)
  email: string | null
  formData: object | null
  formSubmitted: boolean
  status: "QUOTE_INIT" | "QUOTE_FORM_UPLOAD_SUCCESS" |
          "QUOTE_INFO_COMPLETE" | "QUOTE_TIMED_OUT" | "CANCELLED"
  completionStatus: "COMPLETE" | "COMPLETE_WITH_ERRORS" | "PARTIAL" | null
  emailSent: boolean
  emailSentAt: Date | null
  createdAt, updatedAt (auto)
  parts: [{
    partId: string
    name: string
    file2DKey: string
    file3DKey: string
    presignedUrl2D: string
    presignedUrl3D: string
    presignedUrlExpiry: Date
    file2DUploaded: boolean
    file3DUploaded: boolean
    formProcessed: boolean
    file2DProcessed: boolean
    file3DProcessed: boolean
    formOutput: object | null
    file2DOutput: object | null
    file3DOutput: object | null
    formError: string | null
    file2DError: string | null
    file3DError: string | null
    formRetries: number
    file2DRetries: number
    file3DRetries: number
  }]
}
```

### RetryQueue Collection (Mongoose)
```
{
  quoteId: string
  partId: string
  stage: "form" | "2d" | "3d"
  error: string
  attempts: number
  status: "PENDING" | "RETRIED" | "ACKNOWLEDGED"
  createdAt, retriedAt
}
```

## S3 Key Structure

```
quotes/{quoteId}/parts/{partId}/2d/{originalFilename}
quotes/{quoteId}/parts/{partId}/3d/{originalFilename}
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MONGODB_URI` | `mongodb://localhost:27017/quote-gen` | MongoDB connection string |
| `S3_ENDPOINT` | — | S3/Minio endpoint URL |
| `S3_REGION` | `us-east-1` | S3 region |
| `S3_ACCESS_KEY` | — | S3 access key |
| `S3_SECRET_KEY` | — | S3 secret key |
| `S3_BUCKET` | `quote-files` | S3 bucket name |
| `S3_PRESIGNED_EXPIRY` | `3600` | Presigned URL TTL in seconds |
| `SMTP_HOST` | `localhost` | SMTP server |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASS` | — | SMTP password |
| `QUOTE_EXPIRY_HOURS` | `24` | Hours before quote auto-cancels |
| `QUOTE_TIMEOUT_SECONDS` | `25` | Max processing time per quote |

## Entry Points

| File | Command | Role |
|---|---|---|
| `index.ts` | `bun run dev` / `bun run start` | Hapi API Gateway, Mongoose connection, CSRF + Quote + Admin plugins |
| `worker.ts` | `bun run worker` / `bun run start:worker` | All 13 workers, InMemoryEventBus, cleanup interval |

## Deployment Adapters (Swappable Presentation Layer)

The ports & adapters pattern makes the API Gateway swappable without touching core logic:

```
┌────────────────────────────────────────────────────────────┐
│              PRESENTATION ADAPTERS (swappable)              │
│                                                            │
│  ┌──────────────────────┐   ┌──────────────────────┐      │
│  │   Hapi API Gateway   │   │   AWS API Gateway    │      │
│  │   (local dev)        │   │   + Lambda (prod)    │      │
│  │                      │   │                      │      │
│  │  index.ts            │   │  serverless/         │      │
│  │  plugins/quote/*.ts  │   │  handlers/*.ts       │      │
│  │  plugins/csrf/*.ts   │   │  (CSRF at AWS WAF)   │      │
│  └──────────┬───────────┘   └──────────┬───────────┘      │
│             │                          │                   │
│             └────────────┬─────────────┘                   │
│                          ↓                                 │
│       ┌─────────────────────────────────────┐             │
│       │  core/ + adapters/ + workers/       │             │
│       │  (IDENTICAL code, both deployments)  │             │
│       └─────────────────────────────────────┘             │
└────────────────────────────────────────────────────────────┘
```

| Concern | Local (Hapi) | AWS Managed |
|---|---|---|
| HTTP serving | Hapi on `:3000` | API Gateway routes → Lambda |
| Request handling | Hapi route handlers | Lambda function handlers |
| CSRF | Hapi CSRF plugin | AWS WAF rules |
| Routing | Hapi route table | API Gateway route config |
| Core services | IDataService, IFileStorage, IEventBus | Same instances |
| Workers | Bun process (`worker.ts`) | Lambda functions / ECS tasks |
| Event bus | InMemoryEventBus | SQS / EventBridge |

### What stays identical across deployments
- `core/` — events, ports, infrastructure (retry, circuit breaker)
- `adapters/` — MongoDataService, S3FileStorage, SmtpEmailService, event bus
- `workers/` — all 13 workers, subscribed to the same events

## Testing Strategy

- **Unit tests** (`tests/unit/`, 13 files): Each worker and handler tested in isolation with mocked ports
- **Integration test** (`tests/integration/fullFlow.test.ts`): Full Hapi server + all workers with InMemoryEventBus, end-to-end flow: create → process → generation → notification → PDF → email
- Framework: `bun test`

## AWS Deployment Architecture

### Container Strategy
```
Each worker → own lightweight Docker image (oven/bun:alpine base)
API Gateway → own Docker image (Hapi server)
All images → ECR → ECS Fargate tasks
```

### Infrastructure Components

| Component | AWS Service | Purpose |
|---|---|---|
| API Gateway | ALB + ECS Fargate | HTTP ingress, CSRF, route handling |
| Workers (×13) | ECS Fargate tasks | Event processing, one task per worker |
| Event Bus | SQS queues | Decouple gateway from workers |
| Database | DocumentDB / MongoDB Atlas | Quote + retry queue storage |
| File Storage | S3 bucket | Uploaded 2D/3D files |
| Generated PDFs | S3 bucket | Output PDFs with lifecycle policy |
| DNS | Route 53 | Domain routing |
| Security | AWS WAF | CSRF, DDoS protection |
| Logging | CloudWatch | Centralized logs per service |

### CloudFormation Template (`deployment/cloudformation.yaml`)
- VPC with public/private subnets
- ECS cluster with Fargate task definitions (one per worker + API Gateway)
- Application Load Balancer + target groups
- S3 buckets (uploads + generated PDFs) with lifecycle policies
- SQS queues (one per event type or topic-based)
- DocumentDB cluster
- IAM roles for ECS tasks, S3 access, SQS access
- Parameter Store entries for secrets and config
- Auto Scaling based on queue depth

### Docker Images (`deployment/docker/`)
- `base.Dockerfile` — `oven/bun:alpine`, shared layers
- `api.Dockerfile` — Hapi API Gateway
- `worker.Dockerfile` — generic worker image (CMD overridden per worker)
- All images: ~50-80 MB uncompressed
