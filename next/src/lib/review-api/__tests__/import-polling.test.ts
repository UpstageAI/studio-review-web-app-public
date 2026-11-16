import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type ReviewImportResponse } from "../client";
import {
  abortableSleep,
  pollImport,
  type PollImportResult,
} from "../import-polling";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

function status(
  value: string,
  retryAfter: string | null = null,
  extra: Record<string, unknown> = {},
): ReviewImportResponse {
  return { resource: { id: "rvop_1", status: value, ...extra }, retryAfter };
}

/** 응답을 차례로 돌려주고, 각 조회 시각(ms)을 기록한다. */
function sequence(responses: (ReviewImportResponse | Error)[]) {
  const calls: number[] = [];
  const fetchStatus = vi.fn(async (signal: AbortSignal) => {
    calls.push(Date.now());
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchStatus, calls };
}

async function run(promise: Promise<PollImportResult>) {
  let settled: PollImportResult | undefined;
  void promise.then(value => {
    settled = value;
  });
  for (let i = 0; i < 200 && settled === undefined; i += 1) {
    await vi.advanceTimersByTimeAsync(1000);
  }
  return settled;
}

describe("pollImport", () => {
  it("Retry-After 간격으로 조회하고 종료 상태에서 멈춘다", async () => {
    const { fetchStatus, calls } = sequence([
      status("pending", "3"),
      status("applying", "1"),
      status("applied", null, {
        units: [{ status: "applied", applied_versions: { "s:job_1": 2 } }],
      }),
    ]);
    const pending: string[] = [];
    const result = await run(
      pollImport({
        fetchStatus,
        signal: new AbortController().signal,
        initialRetryAfter: "2",
        onPending: value => pending.push(value),
      }),
    );
    expect(result).toMatchObject({
      kind: "finished",
      outcome: { kind: "applied" },
    });
    expect(calls).toEqual([2000, 5000, 6000]);
    expect(pending).toEqual(["pending", "applying"]);
  });

  it("간격은 10 초를 넘지 않고 1 초보다 짧지 않다", async () => {
    const { fetchStatus, calls } = sequence([
      status("pending", "60"),
      status("pending", "0"),
      status("no_change"),
    ]);
    const result = await run(
      pollImport({
        fetchStatus,
        signal: new AbortController().signal,
        initialRetryAfter: null,
      }),
    );
    expect(result).toMatchObject({ outcome: { kind: "no_change" } });
    // 첫 대기는 기본 2 초, 다음은 cap 10 초, 그다음은 하한 1 초.
    expect(calls).toEqual([2000, 12000, 13000]);
  });

  it("base_version_conflict 는 conflict 결과로 끝난다", async () => {
    const { fetchStatus } = sequence([
      status("failed", null, {
        error: {
          code: "base_version_conflict",
          details: {
            conflicts: [
              {
                target: { kind: "value", job_id: "job_1", occurrence_id: "r1" },
                base: 1,
                current: 2,
              },
            ],
          },
        },
      }),
    ]);
    const result = await run(
      pollImport({ fetchStatus, signal: new AbortController().signal }),
    );
    expect(result).toMatchObject({
      kind: "finished",
      outcome: {
        kind: "conflict",
        conflicts: [{ target: { occurrence_id: "r1" } }],
      },
    });
  });

  it("제한 시간을 넘기면 마지막 상태와 함께 멈춘다", async () => {
    const { fetchStatus, calls } = sequence([status("preparing", "10")]);
    const result = await run(
      pollImport({
        fetchStatus,
        signal: new AbortController().signal,
        timeoutMs: 25_000,
      }),
    );
    expect(result).toEqual({ kind: "timeout", status: "preparing" });
    expect(calls).toEqual([2000, 12000, 22000]);
  });

  it("취소하면 더 조회하지 않는다", async () => {
    const { fetchStatus } = sequence([status("pending", "2")]);
    const controller = new AbortController();
    const promise = pollImport({ fetchStatus, signal: controller.signal });
    await vi.advanceTimersByTimeAsync(2500);
    controller.abort();
    const result = await run(promise);
    expect(result).toEqual({ kind: "aborted" });
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("연속 오류 3 회에서 멈추고, 사이에 성공하면 횟수를 다시 센다", async () => {
    const network = new ApiError(0, "network_error", "down");
    const { fetchStatus } = sequence([
      network,
      network,
      status("pending"),
      network,
      network,
      network,
    ]);
    const result = await run(
      pollImport({ fetchStatus, signal: new AbortController().signal }),
    );
    expect(result).toEqual({ kind: "error", error: network });
    expect(fetchStatus).toHaveBeenCalledTimes(6);
  });

  it("다시 시도해도 같은 오류(404)는 바로 멈춘다", async () => {
    const notFound = new ApiError(404, "review_import_not_found", "gone");
    const { fetchStatus } = sequence([notFound]);
    const result = await run(
      pollImport({ fetchStatus, signal: new AbortController().signal }),
    );
    expect(result).toEqual({ kind: "error", error: notFound });
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("알 수 없는 상태는 failed 로 끝나 polling 이 이어지지 않는다", async () => {
    const { fetchStatus } = sequence([status("mystery")]);
    const result = await run(
      pollImport({ fetchStatus, signal: new AbortController().signal }),
    );
    expect(result).toMatchObject({
      outcome: { kind: "failed", code: "unknown_import_status" },
    });
  });
});

describe("abortableSleep", () => {
  it("취소하면 타이머를 지우고 바로 끝난다", async () => {
    const controller = new AbortController();
    let done = false;
    void abortableSleep(5000, controller.signal).then(() => {
      done = true;
    });
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
