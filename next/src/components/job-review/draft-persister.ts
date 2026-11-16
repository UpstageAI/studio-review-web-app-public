import type { ReviewSession } from "@/lib/review-model";
import type { DraftStorage } from "./draft-storage";
import { buildStoredDraft, serializeStoredDraft } from "./draft-store";
import type { DraftState, JobReviewAction } from "./job-review-state";

// 임시 저장의 쓰기 시점·실패 처리(React 밖). `use-draft-persistence.ts` 가 화면 상태가 바뀔 때마다
// `update` 를, 탭을 숨기거나 떠날 때 `flush` 를, 언마운트 때 `dispose` 를 부른다. 타이머·저장소·
// dispatch 를 받아 가짜 타이머로 테스트한다.

/** 편집이 멎은 뒤 임시 저장까지 기다리는 시간. */
export const DRAFT_SAVE_DELAY_MS = 500;

export type DraftPersisterInput = {
  /** 쓸 세션. 불러오지 않았거나 다시 불러오는 중이면 `null`. */
  readonly session: ReviewSession | null;
  readonly draftStatus: DraftState["status"];
  readonly key: string;
};

export type DraftPersister = {
  /** 화면 상태가 바뀌었다 — 기다리던 쓰기를 마치거나, 지우거나, 새 쓰기를 기다리게 둔다. */
  update(input: DraftPersisterInput): void;
  /** 기다리던 쓰기를 그 자리에서 마친다(탭 숨김·이동). */
  flush(): void;
  /** 언마운트. 기다리던 쓰기를 마치고 타이머를 남기지 않는다. */
  dispose(): void;
};

export type DraftPersisterOptions = {
  readonly storage: DraftStorage;
  readonly dispatch: (action: JobReviewAction) => void;
  readonly setTimer: (callback: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
  /** 저장 시각(ISO 8601). 기본은 지금. */
  readonly now?: () => string;
};

type PendingWrite = {
  readonly session: ReviewSession;
  readonly draftStatus: DraftState["status"];
  readonly key: string;
};

/**
 * - `unchecked`·`found` 동안은 쓰지도 지우지도 않는다(배너를 결정하기 전에 지난 임시 저장을 덮어쓰지
 *   않도록).
 * - 항목이 없으면 바로 지우고, 있으면 쓸 세션을 기다리게 두고 편집이 500 ms 멎은 뒤 한 번 쓴다(편집이
 *   이어지면 타이머만 다시 건다). 다른 Job 으로 옮기거나 쓸 수 없게 되면 기다리던 쓰기를 제 키로 마친다.
 * - 쓰기 결과: 상한 초과(`too_large`)·저장소 거부(`failed`)면 지난 임시 저장을 지우고(다시 열었을 때
 *   낡은 변경을 복원하지 않도록) `DRAFT_WRITE_FAILED` 로 사유를 알린다. 저장소가 없으면(`unavailable`)
 *   지우지도 알리지도 않는다 — 임시 저장이 조용히 꺼진다.
 */
export function createDraftPersister({
  storage,
  dispatch,
  setTimer,
  clearTimer,
  now = () => new Date().toISOString(),
}: DraftPersisterOptions): DraftPersister {
  let pending: PendingWrite | null = null;
  let timer: { handle: unknown } | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer.handle);
      timer = null;
    }
  };

  const flush = () => {
    cancelTimer();
    const write = pending;
    pending = null;
    if (!write || !writable(write.draftStatus)) return;
    try {
      const serialized = serializeStoredDraft(
        buildStoredDraft(write.session, now()),
      );
      if (!serialized.ok) {
        storage.clear(write.key);
        dispatch({
          type: "DRAFT_WRITE_FAILED",
          reason: "too_large",
          bytes: serialized.bytes,
        });
        return;
      }
      const result = storage.write(write.key, serialized.text);
      if (result === "ok") {
        if (write.draftStatus === "write_failed") {
          dispatch({ type: "DRAFT_WRITTEN" });
        }
      } else if (result === "failed") {
        storage.clear(write.key);
        dispatch({
          type: "DRAFT_WRITE_FAILED",
          reason: "storage_full",
          bytes: serialized.bytes,
        });
      }
    } catch {
      // 직렬화 예외는 임시 저장만 건너뛴다(편집은 계속된다).
    }
  };

  return {
    update({ session, draftStatus, key }) {
      const active = session !== null && writable(draftStatus);
      // 쓸 수 없게 됐거나(다시 불러오는 중 등) 다른 Job 으로 옮겼으면 기다리던 쓰기를 제 키로 마친다.
      if (pending && (!active || pending.key !== key)) flush();
      if (!active) return;
      if (session.entries.length === 0) {
        pending = null;
        cancelTimer();
        storage.clear(key);
        if (draftStatus === "write_failed") dispatch({ type: "DRAFT_WRITTEN" });
        return;
      }
      pending = { session, draftStatus, key };
      cancelTimer();
      timer = {
        handle: setTimer(() => {
          timer = null;
          flush();
        }, DRAFT_SAVE_DELAY_MS),
      };
    },
    flush,
    dispose: flush,
  };
}

/** 배너를 결정하기 전(`unchecked`)·배너가 떠 있는 동안(`found`)에는 쓰지 않는다. */
function writable(status: DraftState["status"]): boolean {
  return status !== "unchecked" && status !== "found";
}
