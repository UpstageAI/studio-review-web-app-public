import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addChange,
  createSession,
  readReviewDocument,
  type ChangeDraft,
  type ReviewSession,
} from "@/lib/review-model";
import { SINGLE_JOB } from "@/lib/review-model/__tests__/fixtures/fixtures";

import {
  DRAFT_SAVE_DELAY_MS,
  createDraftPersister,
  type DraftPersister,
} from "../draft-persister";
import type { DraftStorage, DraftWriteResult } from "../draft-storage";
import { DRAFT_MAX_BYTES, parseStoredDraft } from "../draft-store";
import type { DraftState, JobReviewAction } from "../job-review-state";

const JOB = "job_A";
const KEY = "review-draft:scol_1:job_A";

function apply(session: ReviewSession, draft: ChangeDraft): ReviewSession {
  const outcome = addChange(session, draft);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.session;
}

const setValue = (key: string, value: number | string): ChangeDraft => ({
  kind: "set_value",
  jobId: JOB,
  resultId: "occ_extract_1",
  path: [key],
  value,
});

const base = (): ReviewSession => createSession(readReviewDocument(SINGLE_JOB));

/** 메모리 저장소. `result` 를 바꿔 쓰기 실패·저장소 없음을 흉내 낸다. */
function memoryStorage() {
  const map = new Map<string, string>();
  const state = { result: "ok" as DraftWriteResult };
  const storage: DraftStorage = {
    read: key => map.get(key) ?? null,
    write: vi.fn((key: string, text: string) => {
      if (state.result === "ok") map.set(key, text);
      return state.result;
    }),
    clear: vi.fn((key: string) => void map.delete(key)),
  };
  return { map, state, storage };
}

let dispatch: ReturnType<typeof vi.fn<(action: JobReviewAction) => void>>;
let mem: ReturnType<typeof memoryStorage>;
let persister: DraftPersister;

beforeEach(() => {
  vi.useFakeTimers();
  dispatch = vi.fn<(action: JobReviewAction) => void>();
  mem = memoryStorage();
  persister = createDraftPersister({
    storage: mem.storage,
    dispatch,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    now: () => "2026-11-05T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const update = (
  session: ReviewSession | null,
  draftStatus: DraftState["status"] = "none",
  key = KEY,
) => persister.update({ session, draftStatus, key });

const storedCount = (key = KEY) => {
  const text = mem.map.get(key);
  return text === undefined ? null : parseStoredDraft(text)?.drafts.length;
};

describe("createDraftPersister", () => {
  it("편집이 멎고 500 ms 뒤에 한 번 쓴다", () => {
    update(apply(base(), setValue("amount", 5)));
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS - 1);
    expect(mem.storage.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(mem.storage.write).toHaveBeenCalledTimes(1);
    expect(storedCount()).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("연속 편집은 타이머를 다시 걸고 마지막 세션만 쓴다", () => {
    const one = apply(base(), setValue("amount", 5));
    update(one);
    vi.advanceTimersByTime(300);
    const two = apply(one, setValue("amount", 6));
    update(two);
    vi.advanceTimersByTime(300);
    expect(mem.storage.write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS);
    expect(mem.storage.write).toHaveBeenCalledTimes(1);
    const stored = parseStoredDraft(mem.map.get(KEY) ?? "");
    expect(stored?.drafts).toEqual([setValue("amount", 6)]);
  });

  it("flush 는 기다리던 쓰기를 바로 마치고 타이머를 남기지 않는다", () => {
    update(apply(base(), setValue("amount", 5)));
    persister.flush();
    expect(storedCount()).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    persister.flush();
    expect(mem.storage.write).toHaveBeenCalledTimes(1);
  });

  it("dispose 는 기다리던 쓰기를 마치고 타이머를 남기지 않는다", () => {
    update(apply(base(), setValue("amount", 5)));
    expect(vi.getTimerCount()).toBe(1);
    persister.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(storedCount()).toBe(1);
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS * 2);
    expect(mem.storage.write).toHaveBeenCalledTimes(1);
  });

  it("항목이 0 이면 바로 지우고, 쓰기 실패 안내 중이었으면 DRAFT_WRITTEN 으로 거둔다", () => {
    mem.map.set(KEY, "old");
    update(base());
    expect(mem.map.has(KEY)).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    update(base(), "write_failed");
    expect(dispatch).toHaveBeenCalledWith({ type: "DRAFT_WRITTEN" });
  });

  it("unchecked·found 동안과 세션이 없을 때는 쓰지도 지우지도 않는다", () => {
    mem.map.set(KEY, "old");
    const edited = apply(base(), setValue("amount", 5));
    update(edited, "unchecked");
    update(base(), "found");
    update(null);
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS * 2);
    expect(mem.storage.write).not.toHaveBeenCalled();
    expect(mem.map.get(KEY)).toBe("old");
  });

  it("다른 키로 옮기거나 쓸 수 없게 되면 기다리던 쓰기를 제 키로 마친다", () => {
    update(apply(base(), setValue("amount", 5)));
    update(base(), "none", "review-draft:scol_1:job_B");
    expect(storedCount()).toBe(1);
    update(apply(base(), setValue("amount", 7)));
    update(null);
    expect(parseStoredDraft(mem.map.get(KEY) ?? "")?.drafts).toEqual([
      setValue("amount", 7),
    ]);
  });

  it("상한을 넘으면 지난 임시 저장을 지우고 too_large 로 알린다", () => {
    mem.map.set(KEY, "old");
    update(apply(base(), setValue("memo", "x".repeat(DRAFT_MAX_BYTES))));
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS);
    expect(mem.storage.write).not.toHaveBeenCalled();
    expect(mem.map.has(KEY)).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0]![0];
    expect(action).toMatchObject({
      type: "DRAFT_WRITE_FAILED",
      reason: "too_large",
    });
    expect(
      action.type === "DRAFT_WRITE_FAILED" && action.bytes,
    ).toBeGreaterThan(DRAFT_MAX_BYTES);
  });

  it("저장소가 쓰기를 거부하면 지난 임시 저장을 지우고 storage_full 로 알린다", () => {
    mem.map.set(KEY, "old");
    mem.state.result = "failed";
    update(apply(base(), setValue("amount", 5)));
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS);
    expect(mem.map.has(KEY)).toBe(false);
    expect(mem.storage.clear).toHaveBeenCalledWith(KEY);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "DRAFT_WRITE_FAILED",
        reason: "storage_full",
      }),
    );
  });

  it("저장소가 없으면 지우지도 알리지도 않는다", () => {
    mem.state.result = "unavailable";
    update(apply(base(), setValue("amount", 5)));
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS);
    expect(mem.storage.write).toHaveBeenCalledTimes(1);
    expect(mem.storage.clear).not.toHaveBeenCalled();
    expect(mem.map.has(KEY)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("쓰기 실패 안내 중에 쓰기가 성공하면 DRAFT_WRITTEN 으로 거둔다", () => {
    update(apply(base(), setValue("amount", 5)), "write_failed");
    vi.advanceTimersByTime(DRAFT_SAVE_DELAY_MS);
    expect(storedCount()).toBe(1);
    expect(dispatch).toHaveBeenCalledWith({ type: "DRAFT_WRITTEN" });
  });
});
