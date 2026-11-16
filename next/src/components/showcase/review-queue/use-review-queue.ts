"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { jobHref } from "@/components/collections/links";
import {
  appendPage,
  moveTo,
  neighbors,
  positionOf,
  restartWith,
  sourceJobsQueryOf,
  unfinishedVisitedCount,
  type ReviewQueue,
  type ReviewQueueEntry,
} from "@/components/showcase/review-queue/review-queue";
import {
  queueFromText,
  readQueueText,
  writeQueue,
} from "@/components/showcase/review-queue/review-queue-storage";
import { useRouter } from "@/i18n/navigation";
import { isAbortError, listJobRows } from "@/lib/review-api/client";
import type { JobRow, ListPage } from "@/lib/review-api/types";
import { confirmLeave } from "@/lib/leave-confirm";
import { createStoredValue } from "@/lib/browser-storage";

/** "완료하면 다음 Job 열기" 를 기억하는 localStorage 키(`"1"` 켬 · `"0"` 끔, 없으면 켬). */
export const REVIEW_QUEUE_ADVANCE_KEY = "review-queue-advance";

/** 다음 Job 이 없을 때 이어 받는 요청 수 상한(BFF 가 거른 페이지를 몇 장씩 모아 주므로 드물다). */
const MAX_PAGE_REQUESTS = 4;
/** 큐 안내를 보이는 시간(ms). 짧은 결과 안내는 4초, 할 일을 함께 알리는 안내는 읽을 시간을 더 준다. */
const NOTICE_HIDE_MS = { short: 4000, long: 8000 } as const;

/** 큐 바 안내. `revisitable` 은 새 Job 은 없지만 이 큐에서 연 Job 중 검수가 끝나지 않은 것이 있을 때. */
export type ReviewQueueNotice =
  | { kind: "noMore" }
  /** "새 Job 확인" 을 눌렀지만 새로 추가된 Job 이 없다. */
  | { kind: "noNew" }
  | { kind: "loadFailed" }
  | { kind: "revisitable"; count: number };

export type ReviewQueueControls = {
  /** 현재 Job 이 들어 있는 큐. 이 탭의 큐에 없는 Job 이면 `null` — 바를 그리지 않는다. */
  queue: ReviewQueue | null;
  inQueue: boolean;
  previous: ReviewQueueEntry | null;
  next: ReviewQueueEntry | null;
  /** 받아 둔 행 중 현재 위치 뒤에 남은 수 */
  remaining: number;
  /** 이어 받을 페이지가 있다 */
  more: boolean;
  /** 다음 페이지를 받는 중 */
  loading: boolean;
  /** "새로 추가된 Job 확인" 중 */
  refreshing: boolean;
  notice: ReviewQueueNotice | null;
  advance: boolean;
  setAdvance: (value: boolean) => void;
  goPrevious: () => void;
  goNext: () => Promise<void>;
  refresh: () => Promise<void>;
};

// 같은 탭 안에서 큐를 바꾼 뒤 구독자에게 알린다(큐는 탭 저장소라 다른 탭의 이벤트는 없다).
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function notify(): void {
  for (const listener of listeners) listener();
}

/** "완료하면 다음 Job 열기": 같은 탭의 변경과 다른 탭의 `storage` 이벤트를 함께 듣는다. */
const storedAdvance = createStoredValue<boolean>({
  key: REVIEW_QUEUE_ADVANCE_KEY,
  area: "local",
  parse: text => text !== "0",
  serialize: value => (value ? "1" : "0"),
  notify: "tab+storage",
});

/**
 * "완료하면 다음 Job 열기" 설정(기본 켬). 큐 바와 설정 메뉴가 같은 값을 읽고 쓰고, 다른 탭에서 바꿔도
 * 따라간다.
 */
export function useQueueAdvance(): [boolean, (value: boolean) => void] {
  const advance = storedAdvance.useValue();
  const setAdvance = useCallback((value: boolean) => {
    storedAdvance.write(value);
  }, []);
  return [advance, setAdvance];
}

function nextCursorOf(page: ListPage<JobRow>): string | null {
  return page.has_more && page.last_cursor ? page.last_cursor : null;
}

/**
 * Job 화면의 검수 큐(Collection 상세에서 만든 `sessionStorage` 큐). 이동은 라우트 이동이라 이탈 확인·
 * 임시 저장·불러오기 흐름을 그대로 타고, 큐에는 위치만 적는다.
 */
export function useReviewQueue(
  collectionId: string,
  jobId: string,
  { dirty, leaveMessage }: { dirty: boolean; leaveMessage: string },
): ReviewQueueControls {
  const router = useRouter();
  const text = useSyncExternalStore(
    subscribe,
    () => readQueueText(collectionId),
    () => null,
  );
  const stored = useMemo(
    () => queueFromText(collectionId, text),
    [collectionId, text],
  );
  const queue = stored && positionOf(stored, jobId) >= 0 ? stored : null;

  const [advance, setAdvance] = useQueueAdvance();

  // 이 Job 을 연 뒤 한 번 큐의 현재 위치·방문 기록을 맞춘다.
  const syncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!queue || syncedRef.current === jobId) return;
    syncedRef.current = jobId;
    if (
      queue.jobs[queue.index]?.job_id !== jobId ||
      !queue.visited.includes(jobId)
    ) {
      if (writeQueue(moveTo(queue, jobId))) notify();
    }
  }, [queue, jobId]);

  const [pending, setPending] = useState<{
    jobId: string;
    kind: "loading" | "refreshing";
  } | null>(null);
  const [noticeState, setNoticeState] = useState<{
    jobId: string;
    notice: ReviewQueueNotice;
  } | null>(null);
  const loading = pending?.jobId === jobId && pending.kind === "loading";
  const refreshing = pending?.jobId === jobId && pending.kind === "refreshing";
  const notice = noticeState?.jobId === jobId ? noticeState.notice : null;
  // "새 Job 확인" 같은 새로 고침의 결과 안내는 잠시 보이고 사라진다. 불러오기 실패는 다음 동작까지
  // 남긴다.
  useEffect(() => {
    const kind = noticeState?.notice.kind;
    if (!kind || kind === "loadFailed") return;
    const timer = setTimeout(
      () => setNoticeState(null),
      kind === "revisitable" ? NOTICE_HIDE_MS.long : NOTICE_HIDE_MS.short,
    );
    return () => clearTimeout(timer);
  }, [noticeState]);
  // 다른 Job 으로 옮겨 끊긴 요청의 표시는 남지 않는다(Job 별로 가린다).
  const busy = loading || refreshing;

  const controllerRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [collectionId, jobId],
  );

  // 떠날지 묻는 동안의 재진입을 막고, 답을 받은 뒤 그 사이 Job 이 바뀌었거나 화면이 사라졌으면 옮기지
  // 않는다(`null` = 화면이 사라짐).
  const askingRef = useRef(false);
  const currentJobRef = useRef<string | null>(jobId);
  useEffect(() => {
    currentJobRef.current = jobId;
    return () => {
      currentJobRef.current = null;
    };
  }, [jobId]);

  const navigate = useCallback(
    async (from: ReviewQueue, entry: ReviewQueueEntry): Promise<void> => {
      if (askingRef.current) return;
      const askedFor = currentJobRef.current;
      askingRef.current = true;
      let ok: boolean;
      try {
        ok = await confirmLeave(dirty, leaveMessage);
      } finally {
        askingRef.current = false;
      }
      if (!ok || askedFor === null || currentJobRef.current !== askedFor) {
        return;
      }
      // 위치는 다음 화면이 열리며 다시 맞추므로 여기서는 구독자에게 알리지 않는다.
      writeQueue(moveTo(from, entry.job_id));
      router.push(jobHref(collectionId, entry.job_id));
    },
    [collectionId, dirty, leaveMessage, router],
  );

  const near = queue ? neighbors(queue, jobId) : null;

  const goPrevious = useCallback(() => {
    if (!queue || busy) return;
    const previous = neighbors(queue, jobId).previous;
    if (previous) void navigate(queue, previous);
  }, [queue, jobId, busy, navigate]);

  const begin = (kind: "loading" | "refreshing"): AbortSignal => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending({ jobId, kind });
    setNoticeState(null);
    return controller.signal;
  };
  const finish = (signal: AbortSignal, failed: ReviewQueueNotice | null) => {
    if (signal.aborted) return;
    setPending(null);
    if (failed) setNoticeState({ jobId, notice: failed });
  };

  const goNext = async (): Promise<void> => {
    if (!queue || busy) return;
    const ahead = neighbors(queue, jobId).next;
    if (ahead) {
      await navigate(queue, ahead);
      return;
    }
    if (!queue.next_cursor) return;
    const signal = begin("loading");
    let current = queue;
    try {
      for (
        let request = 0;
        request < MAX_PAGE_REQUESTS && current.next_cursor;
        request++
      ) {
        const page = await listJobRows(
          collectionId,
          sourceJobsQueryOf(current, current.next_cursor),
          { signal },
        );
        if (signal.aborted) return;
        current = appendPage(current, page.data, nextCursorOf(page));
        const next = neighbors(current, jobId).next;
        if (next) {
          finish(signal, null);
          // 받은 행을 먼저 적어 두고(이동을 취소해도 남는다) 옮긴다.
          if (writeQueue(current)) notify();
          await navigate(current, next);
          return;
        }
      }
      if (writeQueue(current)) notify();
      finish(signal, { kind: "noMore" });
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return;
      finish(signal, { kind: "loadFailed" });
    }
  };

  const refresh = async (): Promise<void> => {
    if (!queue || busy) return;
    const signal = begin("refreshing");
    const rows: JobRow[] = [];
    let cursor: string | null = null;
    try {
      for (let request = 0; request < MAX_PAGE_REQUESTS; request++) {
        const page: ListPage<JobRow> = await listJobRows(
          collectionId,
          sourceJobsQueryOf(queue, cursor ?? undefined),
          { signal },
        );
        if (signal.aborted) return;
        rows.push(...page.data);
        cursor = nextCursorOf(page);
        const restarted = restartWith(queue, rows, cursor);
        if (restarted) {
          finish(signal, null);
          const first = restarted.jobs[0];
          if (first) await navigate(restarted, first);
          return;
        }
        if (!cursor) break;
      }
      const count = unfinishedVisitedCount(queue, rows, jobId);
      finish(
        signal,
        count > 0 ? { kind: "revisitable", count } : { kind: "noNew" },
      );
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return;
      finish(signal, { kind: "loadFailed" });
    }
  };

  return {
    queue,
    inQueue: near?.inQueue ?? false,
    previous: near?.previous ?? null,
    next: near?.next ?? null,
    remaining: near?.remaining ?? 0,
    more: near?.more ?? false,
    loading,
    refreshing,
    notice,
    advance,
    setAdvance,
    goPrevious,
    goNext,
    refresh,
  };
}
