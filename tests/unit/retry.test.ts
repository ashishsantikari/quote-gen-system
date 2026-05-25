import { test, expect, mock } from "bun:test";
import { withRetry } from "../../core/infra/retry";
import { AlreadyProcessedError } from "../../core/errors";

test("succeeds on first attempt", async () => {
  const fn = mock(() => Promise.resolve("success"));

  const result = await withRetry(fn, { maxAttempts: 3 });

  expect(result).toBe("success");
  expect(fn.mock.calls.length).toBe(1);
});

test("retries on failure, succeeds on 2nd attempt", async () => {
  const fn = mock()
    .mockImplementationOnce(() => Promise.reject(new Error("try 1 failed")))
    .mockImplementationOnce(() => Promise.resolve("success on 2nd"));

  const result = await withRetry(fn, { maxAttempts: 3 });

  expect(result).toBe("success on 2nd");
  expect(fn.mock.calls.length).toBe(2);
});

test("exhausts maxAttempts, throws last error", async () => {
  const fn = mock(() => Promise.reject(new Error("always fails")));

  await expect(withRetry(fn, { maxAttempts: 3, baseMs: 10 })).rejects.toThrow("always fails");
  expect(fn.mock.calls.length).toBe(3);
});

test("shouldSkip returns true — throws AlreadyProcessedError", async () => {
  const fn = mock(() => Promise.resolve("success"));
  const shouldSkip = mock(() => Promise.resolve(true));

  await expect(
    withRetry(fn, { shouldSkip, maxAttempts: 3 })
  ).rejects.toThrow("already processed");
  expect(fn.mock.calls.length).toBe(0);
});

test("shouldSkip returns false — proceeds normally", async () => {
  const fn = mock(() => Promise.resolve("success"));
  const shouldSkip = mock(() => Promise.resolve(false));

  const result = await withRetry(fn, { shouldSkip, maxAttempts: 3 });

  expect(result).toBe("success");
  expect(fn.mock.calls.length).toBe(1);
});

test("does not retry on AlreadyProcessedError from function", async () => {
  const fn = mock(() => {
    return Promise.reject(new AlreadyProcessedError("task", "test"));
  });

  await expect(withRetry(fn, { maxAttempts: 3 })).rejects.toThrow("already processed");
  expect(fn.mock.calls.length).toBe(1);
});

test("exponential backoff — retries with increasing delays", async () => {
  const fn = mock()
    .mockImplementationOnce(() => Promise.reject(new Error("fail")))
    .mockImplementationOnce(() => Promise.reject(new Error("fail")))
    .mockImplementationOnce(() => Promise.resolve("ok"));

  await withRetry(fn, { maxAttempts: 3, baseMs: 10 });

  expect(fn.mock.calls.length).toBe(3);
});

test("resolves with value on any successful attempt", async () => {
  const fn = mock()
    .mockImplementationOnce(() => Promise.reject(new Error("fail 1")))
    .mockImplementationOnce(() => Promise.reject(new Error("fail 2")))
    .mockImplementationOnce(() => Promise.resolve("third time's the charm"));

  const result = await withRetry(fn, { maxAttempts: 5, baseMs: 10 });

  expect(result).toBe("third time's the charm");
  expect(fn.mock.calls.length).toBe(3);
});
