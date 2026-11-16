import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createReviewImport,
  getJobResponse,
  getReviewDocumentText,
  getReviewImport,
  type ReviewImportResponse,
} from "@/lib/review-api/client";
import type { FinishedImportOutcome } from "@/lib/review-api/import-polling";
import {
  EMPTY_JOB_RESPONSE,
  readJobResponse,
} from "@/lib/review-api/job-response";
import {
  MAX_INLINE_IMPORT_BYTES,
  buildUploadBody,
  createSession,
  parseImportOutcome,
  readReviewDocument,
  type JsonValue,
} from "@/lib/review-model";

import {
  initialState,
  isSaving,
  jobReviewReducer,
  type JobReviewAction,
  type JobReviewState,
} from "../job-review-state";
import {
  createSaveController,
  type SaveControllerIo,
} from "../save-controller";
import { sha256Hex } from "../save-outcome";

vi.mock("@/lib/review-api/client", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/review-api/client")>()),
  createReviewImport: vi.fn(),
  getReviewImport: vi.fn(),
  getJobResponse: vi.fn(),
  getReviewDocumentText: vi.fn(),
}));

vi.mock("@/lib/review-api/job-response", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/review-api/job-response")>()),
  readJobResponse: vi.fn(),
}));

// 해시는 플랫폼 구현(스레드 풀)을 타지 않게 본문을 그대로 키로 쓴다.
vi.mock("../save-outcome", async importOriginal => ({
  ...(await importOriginal<typeof import("../save-outcome")>()),
  sha256Hex: vi.fn((text: string) => Promise.resolve(text)),
}));

const createMock = vi.mocked(createReviewImport);
const getImportMock = vi.mocked(getReviewImport);
const jobResponseMock = vi.mocked(getJobResponse);
const documentMock = vi.mocked(getReviewDocumentText);
const readJobResponseMock = vi.mocked(readJobResponse);
const hashMock = vi.mocked(sha256Hex);

// 테스트 리터럴만 담으므로 JSON.stringify 로 만들어도 정밀도 손실이 없다.
const DOC_TEXT = JSON.stringify({
  format: "collection-results/11",
  collection_id: "scol_1",
  configs: { cfg_1: { agent_id: null } },
  steps: {
    st_x: { config_id: "cfg_1", name: "Extract", type: "information-extract" },
  },
  jobs: [
    {
      id: "job_1",
      file_groups: {
        base_version: 3,
        groups: [
          {
            group_id: "grp_1",
            layout_step_id: null,
            files: [
              {
                file_ref: "job_1#0",
                file_id: "file_a",
                name: "a.pdf",
                num_pages: 1,
                input_index: 0,
              },
            ],
          },
        ],
      },
      output: [
        {
          step_id: null,
          base_version: 3,
          content: {
            documents: [
              {
                document_id: "doc_1",
                group_id: "grp_1",
                label: null,
                source_files: [{ file_ref: "job_1#0", page_ranges: [[1, 1]] }],
              },
            ],
          },
        },
        {
          id: "occ_1",
          step_id: "st_x",
          base_version: 1,
          content: { amount: 1 },
          document_ids: ["doc_1"],
        },
      ],
    },
  ],
});

const resource = (
  status: string,
  extra: Record<string, unknown> = {},
  retryAfter: string | null = "1",
): ReviewImportResponse => ({
  resource: { id: "rvop_1", status, ...extra },
  retryAfter,
});

const unavailable = () => new ApiError(503, "api_unreachable", "down");

/** 실제 reducer 로 상태를 굴리는 작은 저장소. */
function store() {
  let state = jobReviewReducer(initialState("k", "scol_1", "job_1"), {
    type: "LOADED",
    session: createSession(readReviewDocument(DOC_TEXT)),
    sourceText: DOC_TEXT,
    etag: '"e1"',
    capabilities: null,
    collectionName: "Invoices",
  });
  const actions: JobReviewAction[] = [];
  const dispatch = (action: JobReviewAction) => {
    actions.push(action);
    state = jobReviewReducer(state, action);
  };
  const edit = (value: number) =>
    dispatch({
      type: "APPLY",
      draft: {
        kind: "set_value",
        jobId: "job_1",
        resultId: "occ_1",
        path: ["amount"],
        value,
      },
    });
  return { get: () => state, dispatch, actions, edit };
}

/** 미뤄 둔 Promise. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

const keyOf = (call: number) => createMock.mock.calls[call]![2];

/** 조건이 맞을 때까지 가짜 시간을 조금씩 흘린다(최대 2 분). */
async function until(check: () => void) {
  for (let step = 0; step < 240; step += 1) {
    try {
      check();
      return;
    } catch {
      await vi.advanceTimersByTimeAsync(500);
    }
  }
  check();
}

beforeEach(() => {
  vi.useFakeTimers();
  jobResponseMock.mockResolvedValue({});
  documentMock.mockResolvedValue({ text: DOC_TEXT, etag: '"e2"' });
  readJobResponseMock.mockReturnValue(EMPTY_JOB_RESPONSE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("createSaveController · 멱등 키", () => {
  it("멈춘 저장을 같은 본문으로 다시 보내면 같은 키, 본문이 바뀌면 새 키", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    createMock.mockResolvedValue(resource("preparing"));
    getImportMock.mockRejectedValue(unavailable());

    s.edit(5);
    controller.save();
    await until(() => expect(s.get().save.phase).toBe("stopped"));

    controller.save();
    await until(() => expect(createMock).toHaveBeenCalledTimes(2));
    await until(() => expect(s.get().save.phase).toBe("stopped"));
    expect(keyOf(1)).toBe(keyOf(0));

    s.edit(6);
    controller.save();
    await until(() => expect(createMock).toHaveBeenCalledTimes(3));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });

  it("가져오기가 끝나면 키를 잊어 같은 본문도 새 키로 보낸다", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    createMock.mockResolvedValue(resource("no_change"));

    s.edit(5);
    controller.save();
    await until(() => expect(s.get().save.phase).toBe("no_change"));
    controller.save();
    await until(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(keyOf(1)).not.toBe(keyOf(0));
  });
});

describe("createSaveController · 예외와 잠금", () => {
  it("예기치 않은 예외면 실패로 끝내 편집 잠금을 푼다", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    hashMock.mockRejectedValueOnce(new Error("boom"));

    s.edit(5);
    controller.save();
    expect(isSaving(s.get().save)).toBe(true);
    await until(() => expect(s.get().save.phase).toBe("failed"));
    expect(s.get().save).toMatchObject({ code: "unknown_error" });
    expect(createMock).not.toHaveBeenCalled();

    // 잠금이 풀려 편집과 다시 저장이 된다.
    s.edit(7);
    expect(s.get().session!.entries).toHaveLength(1);
    createMock.mockResolvedValue(resource("no_change"));
    controller.save();
    await until(() => expect(createMock).toHaveBeenCalledTimes(1));
  });

  it("Job 응답을 읽다 예외가 나도 저장은 끝까지 간다", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    createMock.mockResolvedValue(
      resource("applied", {
        units: [{ status: "applied", applied_versions: { "v:occ_1": 2 } }],
      }),
    );
    readJobResponseMock.mockImplementation(() => {
      throw new Error("bad response");
    });

    s.edit(5);
    controller.save();
    await until(() => expect(s.get().save.phase).toBe("saved"));
    expect(s.get().save).toMatchObject({ revision: 2, reloadFailed: null });
    expect(s.actions.some(action => action.type === "RESPONSE_LOADED")).toBe(
      false,
    );
  });

  it("저장 중 두 번째 save 는 상태가 아직 반영되지 않았어도 무시한다", async () => {
    const s = store();
    s.edit(5);
    const stale = s.get();
    // 화면 상태가 갱신되기 전(같은 커밋 사이)을 흉내 내 늘 저장 전 상태를 돌려준다.
    const controller = createSaveController({
      getState: () => stale,
      dispatch: s.dispatch,
    });
    const pending = deferred<ReviewImportResponse>();
    createMock.mockReturnValue(pending.promise);

    controller.save();
    controller.save();
    controller.reload();
    await until(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(
      s.actions.filter(action => action.type === "SAVE_STARTED"),
    ).toHaveLength(1);
    expect(s.actions.some(action => action.type === "RELOAD_STARTED")).toBe(
      false,
    );

    pending.resolve(resource("no_change"));
    await until(() => expect(s.get().save.phase).toBe("no_change"));
    // 끝난 뒤에는 다시 저장할 수 있다.
    createMock.mockResolvedValue(resource("no_change"));
    controller.save();
    await until(() => expect(createMock).toHaveBeenCalledTimes(2));
  });
});

describe("createSaveController · 다시 불러오기", () => {
  it("다시 불러온 문서의 Job id 가 다르면 RELOAD_FAILED invalid_document 로 끝낸다", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    const other = DOC_TEXT.replaceAll('"job_1', '"job_2');
    documentMock.mockResolvedValue({ text: other, etag: '"e2"' });

    controller.reload();
    await until(() =>
      expect(s.actions.some(action => action.type === "RELOAD_FAILED")).toBe(
        true,
      ),
    );
    expect(
      s.actions.filter(action => action.type.startsWith("RELOAD")),
    ).toEqual([
      { type: "RELOAD_STARTED" },
      { type: "RELOAD_FAILED", requestKey: "k", code: "invalid_document" },
    ]);
  });
});

describe("createSaveController · dispose", () => {
  it("polling 중 dispose 하면 요청을 끊고 타이머를 남기지 않는다", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    createMock.mockResolvedValue(resource("preparing", {}, "5"));
    getImportMock.mockResolvedValue(resource("preparing", {}, "5"));

    s.edit(5);
    controller.save();
    await until(() => expect(getImportMock).toHaveBeenCalledTimes(1));
    // 다음 조회를 기다리는 타이머 하나가 걸려 있다.
    await until(() => expect(vi.getTimerCount()).toBe(1));
    const signal = getImportMock.mock.calls[0]![2]!.signal!;
    const before = s.actions.length;

    controller.dispose();
    expect(signal.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getImportMock).toHaveBeenCalledTimes(1);
    expect(s.actions.length).toBe(before);
  });

  it("올리는 중 dispose 하면 요청을 끊고 결과를 버린다", async () => {
    const s = store();
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
    });
    const pending = deferred<ReviewImportResponse>();
    createMock.mockReturnValue(pending.promise);

    s.edit(5);
    controller.save();
    await until(() => expect(createMock).toHaveBeenCalledTimes(1));
    const signal = createMock.mock.calls[0]![3]!.signal!;
    const before = s.actions.length;

    controller.dispose();
    expect(signal.aborted).toBe(true);
    pending.resolve(resource("applied", { units: [] }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.actions.length).toBe(before);
    expect(getImportMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("createSaveController · io", () => {
  const applied = () =>
    resource("applied", {
      units: [{ status: "applied", applied_versions: { "v:occ_1": 2 } }],
    });

  it("넘긴 연산만 부르고 기본 연산은 부르지 않는다 — Job 응답을 문서보다 먼저 부른다", async () => {
    const s = store();
    const calls: string[] = [];
    const io: SaveControllerIo = {
      createReviewImport: vi.fn(async () => {
        calls.push("create");
        return resource("preparing");
      }),
      getReviewImport: vi.fn(async () => {
        calls.push("getImport");
        return applied();
      }),
      pollImport: vi.fn(async ({ fetchStatus, signal }) => {
        calls.push("poll");
        const response = await fetchStatus(signal);
        return {
          kind: "finished" as const,
          outcome: parseImportOutcome(
            response.resource,
          ) as FinishedImportOutcome,
        };
      }),
      getJobResponse: vi.fn(async () => {
        calls.push("response");
        return {};
      }),
      getReviewDocumentText: vi.fn(async () => {
        calls.push("document");
        return { text: DOC_TEXT, etag: '"e2"' };
      }),
    };
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
      io,
    });

    s.edit(5);
    controller.save();
    await until(() => expect(s.get().save.phase).toBe("saved"));
    expect(calls).toEqual([
      "create",
      "poll",
      "getImport",
      "response",
      "document",
    ]);
    expect(io.createReviewImport).toHaveBeenCalledWith(
      "scol_1",
      expect.any(String),
      expect.any(String),
      { signal: expect.any(AbortSignal) },
    );
    expect(io.getReviewImport).toHaveBeenCalledWith("scol_1", "rvop_1", {
      signal: expect.any(AbortSignal),
    });
    expect(io.getJobResponse).toHaveBeenCalledWith("scol_1", "job_1", {
      signal: expect.any(AbortSignal),
    });
    expect(createMock).not.toHaveBeenCalled();
    expect(getImportMock).not.toHaveBeenCalled();
    expect(jobResponseMock).not.toHaveBeenCalled();
    expect(documentMock).not.toHaveBeenCalled();
  });

  it("pollImport 는 fetchStatus·signal·initialRetryAfter 만 받고 signal 을 올리기와 함께 쓴다", async () => {
    const s = store();
    const pollImport = vi.fn<SaveControllerIo["pollImport"]>(async () => ({
      kind: "timeout",
      status: "preparing",
    }));
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
      io: { pollImport },
    });
    createMock.mockResolvedValue(resource("preparing", {}, "4"));

    s.edit(5);
    controller.save();
    await until(() => expect(s.get().save.phase).toBe("stopped"));
    expect(pollImport).toHaveBeenCalledTimes(1);
    const args = pollImport.mock.calls[0]![0];
    expect(Object.keys(args).sort()).toEqual([
      "fetchStatus",
      "initialRetryAfter",
      "signal",
    ]);
    expect(args.initialRetryAfter).toBe("4");
    expect(args.signal).toBe(createMock.mock.calls[0]![3]!.signal);
    expect(getImportMock).not.toHaveBeenCalled();
  });

  it("일부만 넘기면 나머지는 기본 연산을 쓴다", async () => {
    const s = store();
    const createReviewImport = vi.fn<SaveControllerIo["createReviewImport"]>(
      async () => resource("no_change"),
    );
    const controller = createSaveController({
      getState: s.get,
      dispatch: s.dispatch,
      io: { createReviewImport },
    });
    createMock.mockResolvedValue(resource("no_change"));

    s.edit(5);
    controller.save();
    await until(() => expect(s.get().save.phase).toBe("no_change"));
    expect(createReviewImport).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();

    controller.reload();
    await until(() => expect(documentMock).toHaveBeenCalledTimes(1));
    expect(jobResponseMock).toHaveBeenCalledTimes(1);
  });
});

describe("createSaveController · 저장 전 판정", () => {
  /** `amount` 가 숫자여야 하는 schema 를 Step 에 붙인 문서. */
  const SCHEMA_DOC_TEXT = (() => {
    const doc = JSON.parse(DOC_TEXT) as {
      steps: { st_x: Record<string, unknown> };
    };
    doc.steps.st_x.schema = {
      type: "object",
      properties: { amount: { type: "number" } },
    };
    return JSON.stringify(doc);
  })();

  /** 판정만 보도록 올리기 연산을 주입한 저장 컨트롤러. */
  function setup(
    options: {
      docText?: string;
      capabilities?: { max_inline_import_bytes?: number } | null;
    } = {},
  ) {
    const docText = options.docText ?? DOC_TEXT;
    let state = jobReviewReducer(initialState("k", "scol_1", "job_1"), {
      type: "LOADED",
      session: createSession(readReviewDocument(docText)),
      sourceText: docText,
      etag: '"e1"',
      capabilities: (options.capabilities ??
        null) as JobReviewState["capabilities"],
      collectionName: "Invoices",
    });
    const actions: JobReviewAction[] = [];
    const dispatch = (action: JobReviewAction) => {
      actions.push(action);
      state = jobReviewReducer(state, action);
    };
    const createReviewImport = vi.fn<SaveControllerIo["createReviewImport"]>(
      async () => resource("no_change"),
    );
    const edit = (value: JsonValue) =>
      dispatch({
        type: "APPLY",
        draft: {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_1",
          path: ["amount"],
          value,
        },
      });
    let override: ((current: JobReviewState) => JobReviewState) | null = null;
    const controller = createSaveController({
      getState: () => (override ? override(state) : state),
      dispatch,
      io: { createReviewImport },
    });
    const finished = () =>
      actions.filter(
        (
          action,
        ): action is Extract<JobReviewAction, { type: "SAVE_FINISHED" }> =>
          action.type === "SAVE_FINISHED",
      );
    return {
      get: () => state,
      actions,
      edit,
      controller,
      createReviewImport,
      finished,
      setOverride: (fn: (current: JobReviewState) => JobReviewState) => {
        override = fn;
      },
    };
  }

  it("(a) 변경 항목이 없으면 no_change 로 끝내고 트레이를 열지 않는다", async () => {
    const s = setup();
    s.controller.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finished()).toEqual([
      {
        type: "SAVE_FINISHED",
        status: { phase: "no_change", importId: null },
      },
    ]);
    expect(s.finished()[0]!.openTray).toBeUndefined();
    expect(s.actions.some(action => action.type === "SAVE_STARTED")).toBe(
      false,
    );
    expect(s.createReviewImport).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(b) 바꾼 값이 schema 를 어기면 blocked/issues 로 끝내고 트레이를 연다", async () => {
    const s = setup({ docText: SCHEMA_DOC_TEXT });
    s.edit("not a number");
    expect(s.get().session!.entries).toHaveLength(1);
    s.controller.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finished()).toEqual([
      {
        type: "SAVE_FINISHED",
        status: { phase: "blocked", reason: "issues" },
        openTray: true,
      },
    ]);
    expect(s.createReviewImport).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("(c) 변경 항목은 있지만 원본과 차이가 없으면 no_change 로 끝내고 트레이를 열지 않는다", async () => {
    const s = setup();
    s.edit(5);
    // 변경 항목을 남긴 채 지금 문서를 원본으로 되돌린 상태(본문을 만들 차이가 없다).
    s.setOverride(current => ({
      ...current,
      session: { ...current.session!, current: current.session!.base },
    }));
    expect(s.get().session!.entries).toHaveLength(1);
    s.controller.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finished()).toEqual([
      {
        type: "SAVE_FINISHED",
        status: { phase: "no_change", importId: null },
      },
    ]);
    expect(s.finished()[0]!.openTray).toBeUndefined();
    expect(s.createReviewImport).not.toHaveBeenCalled();
  });

  it("(d) 본문이 capabilities 의 한도를 넘으면 blocked/package_limit_exceeded 로 bytes·limit 을 담고 트레이를 연다", async () => {
    const s = setup({ capabilities: { max_inline_import_bytes: 10 } });
    s.edit(5);
    s.controller.save();
    await vi.advanceTimersByTimeAsync(0);
    const session = s.get().session!;
    const expected = buildUploadBody(session.base, session.current);
    expect(expected.bytes).toBeGreaterThan(10);
    expect(s.finished()).toEqual([
      {
        type: "SAVE_FINISHED",
        status: {
          phase: "blocked",
          reason: "package_limit_exceeded",
          bytes: expected.bytes,
          limit: 10,
        },
        openTray: true,
      },
    ]);
    expect(s.createReviewImport).not.toHaveBeenCalled();
  });

  it("(e) capabilities 가 없으면 한도는 8 MiB 다", async () => {
    const s = setup({ docText: DOC_TEXT, capabilities: null });
    // 8 MiB 를 넘는 문자열 값(schema 가 없어 검증은 통과한다).
    s.edit("x".repeat(MAX_INLINE_IMPORT_BYTES));
    s.controller.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(MAX_INLINE_IMPORT_BYTES).toBe(8 * 1024 * 1024);
    expect(s.finished()).toHaveLength(1);
    expect(s.finished()[0]).toMatchObject({
      status: {
        phase: "blocked",
        reason: "package_limit_exceeded",
        limit: MAX_INLINE_IMPORT_BYTES,
      },
      openTray: true,
    });
    expect(s.createReviewImport).not.toHaveBeenCalled();

    // 한도 바로 아래 본문은 막지 않는다.
    const t = setup({ capabilities: null });
    t.edit(5);
    t.controller.save();
    await until(() => expect(t.createReviewImport).toHaveBeenCalledTimes(1));
  });

  it("(⑥) 검증 대상 밖의 결과가 원본과 달라 본문 검증에서 막히면 blocked/issues 로 트레이를 연다", async () => {
    const s = setup({ docText: SCHEMA_DOC_TEXT });
    s.edit("not a number");
    // 값 변경 항목이 아닌 항목만 남긴 상태: 변경 항목 기준 검증은 통과하고 본문 검증이 막는다.
    s.setOverride(current => ({
      ...current,
      session: {
        ...current.session!,
        entries: current.session!.entries.map(
          entry =>
            Object.fromEntries(
              Object.entries(entry).filter(([key]) => key !== "resultId"),
            ) as typeof entry,
        ),
      },
    }));
    s.controller.save();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.finished()).toEqual([
      {
        type: "SAVE_FINISHED",
        status: { phase: "blocked", reason: "issues" },
        openTray: true,
      },
    ]);
    expect(s.createReviewImport).not.toHaveBeenCalled();
  });

  it("(f) 막히지 않으면 buildUploadBody 의 text 를 한 번 올린다", async () => {
    const s = setup();
    s.edit(5);
    const session = s.get().session!;
    const expected = buildUploadBody(session.base, session.current, {
      maxBytes: MAX_INLINE_IMPORT_BYTES,
    });
    s.controller.save();
    await until(() => expect(s.get().save.phase).toBe("no_change"));
    expect(s.createReviewImport).toHaveBeenCalledTimes(1);
    expect(s.createReviewImport.mock.calls[0]![1]).toBe(expected.text);
    expect(s.finished().some(action => action.status.phase === "blocked")).toBe(
      false,
    );
    expect(createMock).not.toHaveBeenCalled();
  });
});
