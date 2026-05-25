import { test, expect } from "bun:test";
import { CircuitBreaker } from "../../core/infra/circuitBreaker";

test("starts CLOSED", () => {
  const cb = new CircuitBreaker();
  expect(cb.getState()).toBe("CLOSED");
});

test("5 failures transition to OPEN", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 5 });
  const failingFn = () => Promise.reject(new Error("fail"));

  for (let i = 0; i < 5; i++) {
    await expect(cb.execute(failingFn)).rejects.toThrow("fail");
  }

  expect(cb.getState()).toBe("OPEN");
});

test("after 30s transitions to HALF_OPEN", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, openTimeoutMs: 10 });
  const failingFn = () => Promise.reject(new Error("fail"));

  await expect(cb.execute(failingFn)).rejects.toThrow("fail");
  expect(cb.getState()).toBe("OPEN");

  await new Promise((resolve) => setTimeout(resolve, 20));

  const successFn = () => Promise.resolve("ok");
  const result = await cb.execute(successFn);
  expect(result).toBe("ok");
  expect(cb.getState()).toBe("CLOSED");
});

test("HALF_OPEN success transitions to CLOSED", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, openTimeoutMs: 10 });
  const failingFn = () => Promise.reject(new Error("fail"));

  await expect(cb.execute(failingFn)).rejects.toThrow("fail");
  expect(cb.getState()).toBe("OPEN");

  await new Promise((resolve) => setTimeout(resolve, 20));

  const successFn = () => Promise.resolve("ok");
  await cb.execute(successFn);
  expect(cb.getState()).toBe("CLOSED");
});

test("HALF_OPEN failure goes back to OPEN", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, openTimeoutMs: 10 });
  const failingFn = () => Promise.reject(new Error("fail"));

  await expect(cb.execute(failingFn)).rejects.toThrow("fail");
  expect(cb.getState()).toBe("OPEN");

  await new Promise((resolve) => setTimeout(resolve, 20));

  await expect(cb.execute(failingFn)).rejects.toThrow("fail");
  expect(cb.getState()).toBe("OPEN");
});

test("throws when OPEN and timeout not elapsed", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 1, openTimeoutMs: 30000 });
  const failingFn = () => Promise.reject(new Error("fail"));

  await expect(cb.execute(failingFn)).rejects.toThrow("fail");
  expect(cb.getState()).toBe("OPEN");

  await expect(cb.execute(() => Promise.resolve("ok"))).rejects.toThrow("Circuit breaker is OPEN");
});

test("sliding window — failures older than 120s don't count", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2, windowMs: 50, openTimeoutMs: 30000 });

  await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
  expect(cb.getState()).toBe("CLOSED");

  await new Promise((resolve) => setTimeout(resolve, 60));

  await expect(cb.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
  expect(cb.getState()).toBe("CLOSED");
});

test("with custom threshold values", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 3 });

  await expect(cb.execute(() => Promise.reject(new Error("f1")))).rejects.toThrow();
  await expect(cb.execute(() => Promise.reject(new Error("f2")))).rejects.toThrow();
  expect(cb.getState()).toBe("CLOSED");

  await expect(cb.execute(() => Promise.reject(new Error("f3")))).rejects.toThrow();
  expect(cb.getState()).toBe("OPEN");
});

test("successes do not increment failure count", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2 });

  await cb.execute(() => Promise.resolve("ok"));
  await cb.execute(() => Promise.resolve("ok"));
  await cb.execute(() => Promise.resolve("ok"));

  expect(cb.getState()).toBe("CLOSED");
});

test("successes do not reset failure count when CLOSED", async () => {
  const cb = new CircuitBreaker({ failureThreshold: 2 });

  await expect(cb.execute(() => Promise.reject(new Error("f1")))).rejects.toThrow();
  await cb.execute(() => Promise.resolve("ok"));
  await expect(cb.execute(() => Promise.reject(new Error("f2")))).rejects.toThrow();
  expect(cb.getState()).toBe("OPEN");
});
