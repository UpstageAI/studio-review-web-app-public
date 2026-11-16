"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ApiError, isAbortError } from "@/lib/review-api/review-screen";
import {
  getJobRevision,
  listJobRevisions,
  revisionErrorKind,
  type JobRevisionErrorKind,
} from "@/lib/review-api/revisions";
import type { JobRevision, JobRevisionsQuery } from "@/lib/review-api/types";
import { machineTargetKey, type MachineTarget } from "@/lib/revision-history";
import {
  BLOCK_LIMIT,
  IDLE_KEY,
  initialRevisionList,
  pageView,
  pendingRequest,
  queryKeyOf,
  retryAtOf,
  retrySecondsOf,
  revisionListReducer,
  type HistoryFilter,
} from "./revision-list-state";

/** 받기 실패. 행 내용 · 기계 출력 · 저장 묶음이 같은 모양을 쓴다. */
export interface DetailFailure {
  status: "error";
  error: unknown;
  kind: JobRevisionErrorKind;
  /** 429 면 다시 요청할 수 있는 시각(ms). */
  retryAt: number | null;
  /** 오류를 받은 시각(ms). 남은 대기 초를 보일 때 쓴다. */
  failedAt: number;
}

/** 행 하나의 내용(단건 GET) 또는 기계 출력 대상의 첫 행. */
export type RevisionDetail =
  | { status: "loading" }
  | { status: "ready"; revision: JobRevision }
  | DetailFailure;

/** 같은 저장(operation)으로 바뀐 행 전체(`include=content`). */
export type OperationDetail =
  | { status: "loading" }
  | { status: "ready"; rows: readonly JobRevision[] }
  | DetailFailure;

/** 429 대기 시계. 목록 · 행 내용 · 최초 원본 오류가 함께 쓴다. */
export interface RetryClock {
  /** `retryAt` 이 지났는가(대기가 없으면 true). */
  readyAt(retryAt: number | null): boolean;
  /** 남은 대기 초(최소 1). 1 초마다 줄어든다. */
  secondsUntil(retryAt: number, failedAt: number): number;
}

export interface JobRevisionsInput {
  collectionId: string;
  jobId: string;
  /** 목록을 받는가(시트가 열려 있음). false 면 받은 행을 비우고 진행 중 요청을 취소한다. */
  enabled: boolean;
  filter: HistoryFilter;
  /**
   * 바뀌면 목록을 처음부터 다시 받아 보던 페이지로 돌아간다(저장이 반영된 세션의 base). `null` 이면
   * 진행 중 요청을 취소하고 받은 행을 그대로 둔다(저장 중).
   */
  refreshKey: unknown;
}

export interface JobRevisions {
  phase: "idle" | "loading" | "ready" | "error";
  /** 첫 페이지 오류 또는 다음 블록 오류. */
  error: unknown;
  errorKind: JobRevisionErrorKind | null;
  retryAt: number | null;
  /** 목록 오류를 받은 시각(ms). */
  failedAt: number | null;
  /** 429 대기가 끝났다(또는 대기할 필요가 없다). */
  retryReady: boolean;
  /** 받은 행 전체(서버 순서). */
  rows: readonly JobRevision[];
  /** 지금 페이지의 행(≤ 20). */
  pageItems: readonly JobRevision[];
  page: number;
  pageNumbers: number[];
  canGoBack: boolean;
  hasMore: boolean;
  /** 서버에 더 남은 행이 있다(받은 범위 밖). */
  hasCursor: boolean;
  blockLoading: boolean;
  blockError: boolean;
  /** 마지막으로 목록을 받은 시각(ms). 상대 시각의 기준. */
  fetchedAt: number | null;
  nextPage: () => void;
  previousPage: () => void;
  goToPage: (page: number) => void;
  retry: () => void;
  details: ReadonlyMap<string, RevisionDetail>;
  loadDetail: (revisionId: string) => void;
  machine: ReadonlyMap<string, RevisionDetail>;
  loadMachine: (
    target: MachineTarget,
    onReady?: (revision: JobRevision) => void,
  ) => void;
  /** 저장 묶음(operation.id) 별 행. */
  operations: ReadonlyMap<string, OperationDetail>;
  /**
   * 그 저장의 행을 모두 받는다. 새로 받아 끝나면 `onReady` 를 부른다(이미 받았거나 받는 중이면 부르지
   * 않는다).
   */
  loadOperation: (
    operationId: string,
    onReady?: (rows: readonly JobRevision[]) => void,
  ) => void;
  retryClock: RetryClock;
}

/** 저장 묶음 한 페이지의 행 수. `include=content` 100 행은 응답 파서 한도를 넘길 수 있다. */
export const OPERATION_PAGE_LIMIT = 20;
/** 저장 묶음을 따라가는 최대 페이지 수. */
export const OPERATION_PAGE_MAX = 50;

function queryOf(
  filter: HistoryFilter,
  after: string | null,
): JobRevisionsQuery {
  return {
    limit: BLOCK_LIMIT,
    after: after ?? undefined,
    type: filter.type ?? undefined,
    occurrence_id: filter.occurrenceId ?? undefined,
    order: filter.order,
  };
}

function detailError(err: unknown, now: number): DetailFailure {
  return {
    status: "error",
    error: err,
    kind: revisionErrorKind(err),
    retryAt: retryAtOf(err, now),
    failedAt: now,
  };
}

/**
 * 기다리는 429 대기 시각이 남아 있는 동안 1 초마다(마지막은 그 시각에 맞춰) `passed` 를 지금
 * 시각으로 올린다. 렌더 중 `Date.now()` 를 쓰지 않으려고 "지났다" · 남은 초는 이 시계가 정한다.
 */
function useRetryClock(retryAts: readonly number[]): RetryClock {
  const [passed, setPassed] = useState(0);
  const next = retryAts.reduce<number | null>(
    (min, at) => (at > passed && (min === null || at < min) ? at : min),
    null,
  );
  useEffect(() => {
    if (next === null) return;
    const now = Date.now();
    const at = Math.min(next, now + 1000);
    const timer = setTimeout(
      () => setPassed(Math.max(at, Date.now())),
      Math.max(0, at - now),
    );
    return () => clearTimeout(timer);
  }, [next, passed]);
  return useMemo(
    () => ({
      readyAt: retryAt => retryAt === null || retryAt <= passed,
      secondsUntil: (retryAt, failedAt) =>
        retrySecondsOf(retryAt, failedAt, passed),
    }),
    [passed],
  );
}

/**
 * 대상의 처음(가장 오래된) 행. 오래된 순 1 행을 `include=content` 로 한 번 받는다. 그 행이 기계 출력
 * 바로 다음(`base_version` 0)인지는 불러오기 판정(`loadAvailability`)이 본다.
 */
export async function firstRevisionOf(
  collectionId: string,
  jobId: string,
  target: MachineTarget,
  signal: AbortSignal,
  list: typeof listJobRevisions = listJobRevisions,
): Promise<JobRevision | null> {
  const filter: JobRevisionsQuery =
    target.type === "result"
      ? { occurrence_id: target.occurrenceId }
      : { type: "structure" };
  const first = await list(
    collectionId,
    jobId,
    { ...filter, order: "asc", limit: 1, include: "content" },
    { signal },
  );
  return first.data[0] ?? null;
}

/**
 * 같은 저장(operation)으로 바뀐 행 전체를 내용과 함께 받는다. `has_more` 가 false 가 될 때까지
 * 따라가되, 커서가 나아가지 않거나 `OPERATION_PAGE_MAX` 페이지를 넘으면 받은 데까지만 돌려준다.
 */
export async function operationRowsOf(
  collectionId: string,
  jobId: string,
  operationId: string,
  signal: AbortSignal,
  list: typeof listJobRevisions = listJobRevisions,
): Promise<readonly JobRevision[]> {
  const out: JobRevision[] = [];
  let after: string | undefined;
  for (let page = 0; page < OPERATION_PAGE_MAX; page++) {
    const result = await list(
      collectionId,
      jobId,
      {
        operation_id: operationId,
        include: "content",
        limit: OPERATION_PAGE_LIMIT,
        after,
      },
      { signal },
    );
    out.push(...result.data);
    if (!result.has_more || !result.last_id || result.last_id === after) break;
    after = result.last_id;
  }
  return out;
}

/**
 * Job 변경 이력 목록(100 행 블록 · 20 행 번호 페이지)과 행 내용 · 기계 출력 내용을 받는다.
 *
 * - 필터·정렬이 바뀌면(목록 key) 렌더 중에 비우고 1 페이지부터 다시 받는다. `order` 도 key 에 들어 있다.
 * - 목록 요청은 effect 하나가 맡고 직전 요청을 취소한다. 다른 key 의 응답은 상태 모듈이 버린다.
 * - 429 는 자동으로 다시 부르지 않는다. `retryClock` 이 남은 초를 1 초마다 줄이고, `retryAt` 이 지나면
 *   `retryReady` 가 true 가 된다.
 * - 저장이 반영되면 처음부터 다시 받고 보던 페이지로 돌아간다(그 페이지까지 블록을 이어 받는다).
 * - 행 내용 · 기계 출력 · 저장 묶음은 행(대상 · 묶음)마다 한 번 받아 같은 Job 안에서 두고, 언마운트 때 진행 중 요청을 취소한다.
 */
export function useJobRevisions({
  collectionId,
  jobId,
  enabled,
  filter,
  refreshKey,
}: JobRevisionsInput): JobRevisions {
  const key = enabled ? queryKeyOf(collectionId, jobId, filter) : IDLE_KEY;
  const [state, dispatch] = useReducer(
    revisionListReducer,
    key,
    initialRevisionList,
  );
  const [seenRefresh, setSeenRefresh] = useState(refreshKey);

  // key 가 바뀌거나 새 base 가 오면 렌더 중에 맞춘다(effect 에서 비우면 이전 목록이 한 번 더 그려진다).
  const refreshed = refreshKey !== null && refreshKey !== seenRefresh;
  if (refreshed) setSeenRefresh(refreshKey);
  if (state.key !== key) {
    dispatch({ type: "RESET", key });
  } else if (refreshed && key !== IDLE_KEY) {
    // 저장이 반영됐다 — 처음부터 다시 받되 보던 페이지로 돌아간다.
    dispatch({
      type: "RESET",
      key,
      restorePage:
        pageView(state.rows.length, state.pageIndex, state.cursor).page - 1,
    });
  }

  const paused = refreshKey === null;
  const pending = pendingRequest(state);
  const requestKey = state.key;
  const requestSeq = state.seq;
  const requestAfter = pending ? pending.after : undefined;

  const fetchPage = useEffectEvent(
    (after: string | null, signal: AbortSignal) => {
      const listKey = requestKey;
      listJobRevisions(collectionId, jobId, queryOf(filter, after), {
        signal,
      }).then(
        page => {
          if (signal.aborted) return;
          dispatch({
            type: "PAGE_LOADED",
            key: listKey,
            after,
            page,
            now: Date.now(),
          });
        },
        (err: unknown) => {
          if (signal.aborted || isAbortError(err)) return;
          dispatch({
            type: "PAGE_FAILED",
            key: listKey,
            after,
            error: err,
            now: Date.now(),
          });
        },
      );
    },
  );

  useEffect(() => {
    if (paused || requestAfter === undefined) return;
    const controller = new AbortController();
    fetchPage(requestAfter, controller.signal);
    return () => controller.abort();
  }, [requestKey, requestSeq, requestAfter, paused]);

  // 행 내용 · 기계 출력 캐시. 같은 Job 안에서만 쓴다(행 내용은 바뀌지 않는다).
  const jobKey = `${collectionId}\u0000${jobId}`;
  const [cache, setCache] = useState<{
    jobKey: string;
    details: ReadonlyMap<string, RevisionDetail>;
    machine: ReadonlyMap<string, RevisionDetail>;
    operations: ReadonlyMap<string, OperationDetail>;
  }>(() => ({
    jobKey,
    details: new Map(),
    machine: new Map(),
    operations: new Map(),
  }));
  if (cache.jobKey !== jobKey) {
    setCache({
      jobKey,
      details: new Map(),
      machine: new Map(),
      operations: new Map(),
    });
  }
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const running = controllers.current;
    return () => {
      for (const controller of running.values()) controller.abort();
      running.clear();
    };
  }, [jobKey]);

  const put = useCallback(
    (
      slot: "details" | "machine",
      id: string,
      detail: RevisionDetail,
      forJob: string,
    ) => {
      setCache(prev => {
        if (prev.jobKey !== forJob) return prev;
        const next = new Map(prev[slot]);
        next.set(id, detail);
        return { ...prev, [slot]: next };
      });
    },
    [],
  );
  const putOperation = useCallback(
    (id: string, detail: OperationDetail, forJob: string) => {
      setCache(prev => {
        if (prev.jobKey !== forJob) return prev;
        const next = new Map(prev.operations);
        next.set(id, detail);
        return { ...prev, operations: next };
      });
    },
    [],
  );

  const cacheRef = useRef(cache);
  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  const start = useCallback(
    (
      slot: "details" | "machine",
      id: string,
      run: (signal: AbortSignal) => Promise<JobRevision | null>,
      onReady?: (revision: JobRevision) => void,
    ) => {
      const controllerKey = `${slot}:${id}`;
      // 진행 중이면 다시 보내지 않는다. 캐시는 다음 렌더에야 "loading" 이 되므로 같은 tick 에 겹친
      // 호출은 controller 로 막는다(먼저 보낸 요청의 `onReady` 가 그대로 불린다).
      if (controllers.current.has(controllerKey)) return;
      const current = cacheRef.current[slot].get(id);
      if (current?.status === "loading" || current?.status === "ready") return;
      const controller = new AbortController();
      controllers.current.set(controllerKey, controller);
      const forJob = jobKey;
      put(slot, id, { status: "loading" }, forJob);
      run(controller.signal).then(
        revision => {
          if (controller.signal.aborted) return;
          controllers.current.delete(controllerKey);
          put(
            slot,
            id,
            revision
              ? { status: "ready", revision }
              : detailError(
                  new ApiError(404, "revision_not_found", "No revision"),
                  Date.now(),
                ),
            forJob,
          );
          if (revision) onReady?.(revision);
        },
        (err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          controllers.current.delete(controllerKey);
          put(slot, id, detailError(err, Date.now()), forJob);
        },
      );
    },
    [jobKey, put],
  );

  // 저장 묶음은 결과 모양이 달라 따로 받되, 진행 중 가드 · 취소(controllers) · Job 전환 리셋은 같다.
  const startOperation = useCallback(
    (operationId: string, onReady?: (rows: readonly JobRevision[]) => void) => {
      const controllerKey = `operations:${operationId}`;
      if (controllers.current.has(controllerKey)) return;
      const current = cacheRef.current.operations.get(operationId);
      if (current?.status === "loading" || current?.status === "ready") return;
      const controller = new AbortController();
      controllers.current.set(controllerKey, controller);
      const forJob = jobKey;
      putOperation(operationId, { status: "loading" }, forJob);
      operationRowsOf(collectionId, jobId, operationId, controller.signal).then(
        rows => {
          if (controller.signal.aborted) return;
          controllers.current.delete(controllerKey);
          putOperation(operationId, { status: "ready", rows }, forJob);
          onReady?.(rows);
        },
        (err: unknown) => {
          if (controller.signal.aborted || isAbortError(err)) return;
          controllers.current.delete(controllerKey);
          putOperation(operationId, detailError(err, Date.now()), forJob);
        },
      );
    },
    [jobKey, putOperation, collectionId, jobId],
  );

  const loadDetail = useCallback(
    (revisionId: string) =>
      start("details", revisionId, signal =>
        getJobRevision(collectionId, jobId, revisionId, { signal }),
      ),
    [start, collectionId, jobId],
  );

  /** 대상의 기계 출력을 받는다. 새로 받아 끝나면 `onReady` 를 부른다(이미 받았거나 받는 중이면 부르지 않는다). */
  const loadMachine = useCallback(
    (target: MachineTarget, onReady?: (revision: JobRevision) => void) =>
      start(
        "machine",
        machineTargetKey(target),
        signal => firstRevisionOf(collectionId, jobId, target, signal),
        onReady,
      ),
    [start, collectionId, jobId],
  );

  const retryAts = useMemo(() => {
    const out: number[] = [];
    if (state.retryAt !== null) out.push(state.retryAt);
    for (const slot of [cache.details, cache.machine, cache.operations]) {
      for (const detail of slot.values()) {
        if (detail.status === "error" && detail.retryAt !== null) {
          out.push(detail.retryAt);
        }
      }
    }
    return out;
  }, [state.retryAt, cache.details, cache.machine, cache.operations]);
  const retryClock = useRetryClock(retryAts);

  const view = pageView(state.rows.length, state.pageIndex, state.cursor);
  const rows = state.rows;
  const pageItems = useMemo(
    () => rows.slice(view.start, view.end),
    [rows, view.start, view.end],
  );

  const nextPage = useCallback(() => dispatch({ type: "NEXT_PAGE" }), []);
  const previousPage = useCallback(
    () => dispatch({ type: "PREVIOUS_PAGE" }),
    [],
  );
  const goToPage = useCallback(
    (page: number) => dispatch({ type: "GO_TO_PAGE", page }),
    [],
  );
  const retry = useCallback(() => dispatch({ type: "RETRY" }), []);

  const error =
    state.phase === "error"
      ? state.error
      : state.block === "error"
        ? state.blockError
        : null;

  return {
    phase: state.phase,
    error,
    errorKind: error === null ? null : revisionErrorKind(error),
    retryAt: state.retryAt,
    failedAt: state.failedAt,
    retryReady: retryClock.readyAt(state.retryAt),
    rows,
    pageItems,
    page: view.page,
    pageNumbers: view.pageNumbers,
    canGoBack: view.canGoBack,
    hasMore: view.hasMore,
    hasCursor: state.cursor !== null,
    blockLoading: state.block === "loading",
    blockError: state.block === "error",
    fetchedAt: state.fetchedAt,
    nextPage,
    previousPage,
    goToPage,
    retry,
    details: cache.details,
    loadDetail,
    machine: cache.machine,
    loadMachine,
    operations: cache.operations,
    loadOperation: startOperation,
    retryClock,
  };
}
