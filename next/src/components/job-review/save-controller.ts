import type { Dispatch } from "react";
import {
  createReviewImport,
  getJobResponse,
  getReviewDocumentText,
  getReviewImport,
  isAbortError,
} from "@/lib/review-api/review-screen";
import { pollImport } from "@/lib/review-api/import-polling";
import { readJobResponse } from "@/lib/review-api/job-response";
import {
  MAX_INLINE_IMPORT_BYTES,
  commitSession,
  createSession,
  isValueEntry,
  openJobReview,
  parseImportOutcome,
  planSave,
  type ImportOutcome,
  type JsonObject,
  type ReviewSession,
} from "@/lib/review-model";
import {
  isSaving,
  jobOf,
  type JobReviewAction,
  type JobReviewState,
  type SaveStatus,
} from "./job-review-state";
import { randomUUID } from "./random-uuid";
import { reviewErrorCode } from "./review-error-code";
import {
  conflictTargets,
  failureTarget,
  revisionOf,
  sha256Hex,
} from "./save-outcome";

function importIdOf(resource: unknown): string | null {
  if (typeof resource !== "object" || resource === null) return null;
  const id = (resource as { id?: unknown }).id;
  return typeof id === "string" && id !== "" ? id : null;
}

function failedStatus(
  code: string,
  importId: string | null = null,
): Extract<SaveStatus, { phase: "failed" }> {
  return {
    phase: "failed",
    code,
    importId,
    message: null,
    resultId: null,
    fieldPointer: null,
    entryIds: [],
  };
}

export interface SaveController {
  save: () => void;
  reload: () => void;
  /** 진행 중인 저장·다시 불러오기를 끊고 멱등 키를 잊는다. 그 뒤에도 다시 쓸 수 있다. */
  dispose: () => void;
}

/**
 * 저장(`review-imports` → polling → 반영)과 다시 불러오기. React 밖에 두어 가짜 fetch·타이머로
 * 테스트한다. 같은 본문을 다시 보내면 같은 멱등 키를 쓰고, 가져오기가 끝나면 키를 잊는다.
 * 저장·다시 불러오기는 한 번에 하나만 돈다.
 */
/**
 * 저장·다시 불러오기가 부르는 BFF 연산. 기본값은 `@/lib/review-api/review-screen` 의 함수와
 * `pollImport` 이고, 다른 BFF 를 쓰거나 테스트할 때 일부만 바꿔 넘긴다. 호출 순서·인자는 같다.
 */
export interface SaveControllerIo {
  createReviewImport: typeof createReviewImport;
  getReviewImport: typeof getReviewImport;
  getJobResponse: typeof getJobResponse;
  getReviewDocumentText: typeof getReviewDocumentText;
  pollImport: typeof pollImport;
}

export function createSaveController(options: {
  getState: () => JobReviewState;
  dispatch: Dispatch<JobReviewAction>;
  io?: Partial<SaveControllerIo>;
}): SaveController {
  const { getState, dispatch } = options;
  const io: SaveControllerIo = {
    createReviewImport: options.io?.createReviewImport ?? createReviewImport,
    getReviewImport: options.io?.getReviewImport ?? getReviewImport,
    getJobResponse: options.io?.getJobResponse ?? getJobResponse,
    getReviewDocumentText:
      options.io?.getReviewDocumentText ?? getReviewDocumentText,
    pollImport: options.io?.pollImport ?? pollImport,
  };
  let controller: AbortController | null = null;
  // 상태가 화면에 반영되기 전 두 번째 호출도 막도록 동기적으로 세우는 표시.
  let busy = false;
  const keys = new Map<string, string>();

  /** 새 작업을 시작한다. 끝날 때 이 작업이 아직 현재 작업일 때만 `busy` 를 내린다. */
  const begin = () => {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    busy = true;
    const end = () => {
      if (controller === current) {
        controller = null;
        busy = false;
      }
    };
    return { signal: current.signal, end };
  };

  /** 검수 문서와 Job 응답을 다시 받아 세션을 새로 만든다. 예외를 밖으로 내지 않는다. */
  const fetchLatest = async (signal: AbortSignal) => {
    const { collectionId, jobId, requestKey: key } = getState();
    io.getJobResponse(collectionId, jobId, { signal })
      .then(response => {
        if (signal.aborted) return;
        dispatch({
          type: "RESPONSE_LOADED",
          data: readJobResponse(response),
        });
      })
      // 좌표를 다시 받거나 읽지 못해도 지난 응답의 하이라이트를 그대로 쓴다.
      .catch(() => undefined);
    try {
      const document = await io.getReviewDocumentText(collectionId, jobId, {
        signal,
      });
      if (signal.aborted) return;
      // Job 이 하나가 아니거나 id 가 다르면 아래 catch 에서 `invalid_document` 로 끝난다.
      const doc = openJobReview(document.text, jobId);
      dispatch({
        type: "RELOADED",
        requestKey: key,
        session: createSession(doc),
        sourceText: document.text,
        etag: document.etag,
      });
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return;
      dispatch({
        type: "RELOAD_FAILED",
        requestKey: key,
        code: reviewErrorCode(err),
      });
    }
  };

  const finish = async (
    outcome: Exclude<ImportOutcome, { kind: "pending" }>,
    context: {
      importId: string;
      session: ReviewSession;
      body: JsonObject | null;
      signal: AbortSignal;
    },
  ) => {
    const { importId, session, body, signal } = context;
    switch (outcome.kind) {
      case "applied":
      case "partially_applied": {
        const committed = commitSession(session, outcome.units);
        const job = jobOf(committed.session);
        dispatch({
          type: "SAVE_COMMITTED",
          session: committed.session,
          importId,
          revision: revisionOf(
            outcome.units,
            job?.file_groups?.base_version ?? null,
          ),
          partial: outcome.kind === "partially_applied",
        });
        // 서버가 다시 판정한 상태(결과 연결·`input_changed`·Validate)를 받으려고 늘 다시 불러온다.
        await fetchLatest(signal);
        return;
      }
      case "no_change":
        dispatch({
          type: "SAVE_FINISHED",
          status: { phase: "no_change", importId },
        });
        return;
      case "conflict":
        dispatch({
          type: "SAVE_FINISHED",
          status: {
            phase: "conflict",
            importId,
            conflict: conflictTargets(session.entries, outcome.conflicts),
          },
          openTray: true,
        });
        return;
      case "failed": {
        const target = failureTarget(body, outcome.pointer);
        dispatch({
          type: "SAVE_FINISHED",
          status: {
            ...failedStatus(outcome.code, importId),
            message: outcome.message ?? null,
            resultId: target?.resultId ?? null,
            fieldPointer: target?.fieldPointer ?? null,
            entryIds: target
              ? session.entries
                  .filter(
                    entry =>
                      isValueEntry(entry) && entry.resultId === target.resultId,
                  )
                  .map(entry => entry.id)
              : [],
          },
          openTray: true,
        });
        return;
      }
      case "cancelled":
        dispatch({
          type: "SAVE_FINISHED",
          status: {
            phase: "stopped",
            reason: "cancelled",
            importId,
            code: outcome.code ?? null,
          },
          openTray: true,
        });
        return;
      default: {
        const unreachable: never = outcome;
        return unreachable;
      }
    }
  };

  /** 올릴 본문을 만든다. 막히면 상태를 알리고 `null`. */
  const prepare = (current: JobReviewState, session: ReviewSession) => {
    const plan = planSave(session, {
      maxBytes:
        current.capabilities?.max_inline_import_bytes ??
        MAX_INLINE_IMPORT_BYTES,
    });
    switch (plan.kind) {
      case "no_job":
        return null;
      case "no_change":
        dispatch({
          type: "SAVE_FINISHED",
          status: { phase: "no_change", importId: null },
        });
        return null;
      case "blocked":
        dispatch({
          type: "SAVE_FINISHED",
          status:
            plan.reason === "issues"
              ? { phase: "blocked", reason: "issues" }
              : {
                  phase: "blocked",
                  reason: "package_limit_exceeded",
                  bytes: plan.bytes,
                  limit: plan.limit,
                },
          openTray: true,
        });
        return null;
      case "ready":
        return { text: plan.text, body: plan.body };
      default: {
        const unreachable: never = plan;
        return unreachable;
      }
    }
  };

  const upload = async (
    collectionId: string,
    session: ReviewSession,
    payload: { text: string; body: JsonObject },
    signal: AbortSignal,
  ) => {
    const hash = await sha256Hex(payload.text);
    let key = hash ? keys.get(hash) : undefined;
    if (!key) {
      key = randomUUID();
      if (hash) keys.set(hash, key);
    }
    const forget = () => {
      if (hash) keys.delete(hash);
    };
    if (signal.aborted) return;

    let created;
    try {
      created = await io.createReviewImport(collectionId, payload.text, key, {
        signal,
      });
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return;
      // 같은 키로 다른 본문을 보냈다는 거절은 키를 버려야 다시 보낼 수 있다.
      if (reviewErrorCode(err) === "idempotency_key_reused") forget();
      dispatch({
        type: "SAVE_FINISHED",
        status: failedStatus(reviewErrorCode(err)),
        openTray: true,
      });
      return;
    }
    if (signal.aborted) return;
    const importId = importIdOf(created.resource);
    if (!importId) {
      dispatch({
        type: "SAVE_FINISHED",
        status: failedStatus("invalid_import_resource"),
        openTray: true,
      });
      return;
    }
    dispatch({ type: "SAVE_POLLING", importId });

    const first = parseImportOutcome(created.resource);
    let outcome: Exclude<ImportOutcome, { kind: "pending" }>;
    if (first.kind !== "pending") {
      outcome = first;
    } else {
      const result = await io.pollImport({
        fetchStatus: pollSignal =>
          io.getReviewImport(collectionId, importId, { signal: pollSignal }),
        signal,
        initialRetryAfter: created.retryAfter,
      });
      if (signal.aborted || result.kind === "aborted") return;
      if (result.kind !== "finished") {
        // 서버에서는 계속 진행 중일 수 있다. 같은 본문을 다시 보내면 같은 가져오기를 이어 본다.
        dispatch({
          type: "SAVE_FINISHED",
          status: {
            phase: "stopped",
            reason: result.kind === "timeout" ? "timeout" : "unreachable",
            importId,
            code:
              result.kind === "error" ? reviewErrorCode(result.error) : null,
          },
          openTray: true,
        });
        return;
      }
      outcome = result.outcome;
    }
    forget();
    await finish(outcome, {
      importId,
      session,
      body: payload.body,
      signal,
    });
  };

  const save = () => {
    const current = getState();
    const session = current.session;
    if (busy || !session || isSaving(current.save)) return;
    const payload = prepare(current, session);
    if (!payload) return;

    const { signal, end } = begin();
    dispatch({ type: "SAVE_STARTED" });
    void (async () => {
      try {
        await upload(current.collectionId, session, payload, signal);
      } catch (err) {
        // 예기치 않은 예외로 저장 중 상태에 머물면 편집이 잠긴 채 남는다. 실패로 끝내 잠금을 푼다.
        if (signal.aborted || isAbortError(err)) return;
        dispatch({
          type: "SAVE_FINISHED",
          status: failedStatus(reviewErrorCode(err)),
          openTray: true,
        });
      } finally {
        end();
      }
    })();
  };

  const reload = () => {
    const current = getState();
    if (busy || !current.session || isSaving(current.save)) return;
    const { signal, end } = begin();
    dispatch({ type: "RELOAD_STARTED" });
    void fetchLatest(signal).finally(end);
  };

  const dispose = () => {
    controller?.abort();
    controller = null;
    busy = false;
    keys.clear();
  };

  return { save, reload, dispose };
}
