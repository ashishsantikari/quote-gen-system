export class AppError extends Error {
  override name = this.constructor.name;
  code: string;
  statusCode: number;
  details?: Record<string, unknown>;
  override cause?: string;

  constructor(message: string, code: string, statusCode = 500, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    if (details?.cause instanceof Error) {
      this.cause = details.cause.message;
    }
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string, details?: Record<string, unknown>) {
    super(`${resource} not found: ${id}`, `${resource.toUpperCase()}_NOT_FOUND`, 404, { ...details, resource, id });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(service: string, details?: Record<string, unknown>) {
    super(`${service} is unavailable`, "SERVICE_UNAVAILABLE", 503, { ...details, service });
  }
}

export class DatabaseError extends AppError {
  constructor(operation: string, cause: Error, details?: Record<string, unknown>) {
    super(`Database operation '${operation}' failed: ${cause.message}`, "DATABASE_ERROR", 500, { ...details, operation, cause });
  }
}

export class StorageError extends AppError {
  constructor(operation: string, cause: Error, details?: Record<string, unknown>) {
    super(`Storage operation '${operation}' failed: ${cause.message}`, "STORAGE_ERROR", 500, { ...details, operation, cause });
  }
}

export class EventBusError extends AppError {
  constructor(operation: string, cause: Error, details?: Record<string, unknown>) {
    super(`Event bus '${operation}' failed: ${cause.message}`, "EVENT_BUS_ERROR", 500, { ...details, operation, cause });
  }
}

export class CircuitBreakerOpenError extends AppError {
  constructor(name: string, timeRemainingMs: number, failureCount: number) {
    super(`Circuit breaker '${name}' is OPEN (${timeRemainingMs}ms remaining, ${failureCount} failures)`, "CIRCUIT_BREAKER_OPEN", 503, { name, timeRemainingMs, failureCount });
  }
}

export class AlreadyProcessedError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} '${id}' already processed`, "ALREADY_PROCESSED", 409, { resource, id });
  }
}

export class TimeoutError extends AppError {
  constructor(operation: string, timeoutMs: number) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, "TIMEOUT", 408, { operation, timeoutMs });
  }
}

export class EmailError extends AppError {
  constructor(cause: Error, details?: Record<string, unknown>) {
    super(`Email sending failed: ${cause.message}`, "EMAIL_ERROR", 500, { ...details, cause });
  }
}

export function httpErrorResponse(error: unknown, traceId?: string): {
  statusCode: number;
  body: { error: { code: string; message: string; traceId?: string; details?: Record<string, unknown> } };
} {
  if (error instanceof AppError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          traceId,
          details: error.details,
        },
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    statusCode: 500,
    body: {
      error: {
        code: "INTERNAL_ERROR",
        message,
        traceId,
      },
    },
  };
}
