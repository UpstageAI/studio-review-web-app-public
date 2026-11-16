import { filePagesReady } from "@/lib/review-api/file-pages";
import {
  EMPTY_JOB_RESPONSE,
  type JobResponseData,
} from "@/lib/review-api/job-response";
import type {
  FileHighlightsPage,
  FilePagesResponse,
  ReviewCapabilities,
  ReviewStatusAction,
  ReviewStatusRecord,
  ReviewStatusValue,
} from "@/lib/review-api/types";
import {
  addChange,
  documentsOf,
  findResult,
  flattenPages,
  resetSession,
  revertChange,
  type ChangeDraft,
  type DropReason,
  type HighlightLike,
  type LocatedDocument,
  type PageRef,
  type ReviewDocumentEntry,
  type ReviewJob,
  type ReviewSession,
} from "@/lib/review-model";
import type { StoredDraft } from "./draft-store";
import { HIGHLIGHT_CHUNK } from "./large-job";
import type { StepTab } from "./step-tabs-model";

// Job 검수 화면의 상태 모델(useReducer)과 화면이 파생값을 만들 때 쓰는 순수 함수.

/** Job 의 입력 파일 하나. */
export type JobFile = {
  fileRef: string;
  fileId: string;
  name: string;
  numPages: number | null;
};

/** Parse 하이라이트 묶음(`HIGHLIGHT_CHUNK` 쪽, 시작 페이지가 키) 하나의 로딩 상태. */
export type HighlightChunkStatus = "loading" | "ready" | "error";

/** 파일 하나의 페이지 이미지·Parse 하이라이트 로딩 상태. */
export type FileEntry = {
  fileId: string;
  name: string;
  status: "loading" | "ready" | "not_ready" | "error";
  numPages: number | null;
  /** 파일 로컬 page - 1 위치의 이미지 URL. */
  imageUrls: (string | null)[];
  /**
   * 파일 로컬 page → Parse 하이라이트(`page` 는 파일 로컬). 받은 묶음의 페이지만 있다(요소가 없는
   * 페이지는 빈 배열). 없는 페이지는 아직 받지 않은 것이다.
   */
  parse: Readonly<Record<number, HighlightLike[]>>;
  /** 묶음 시작 페이지 → 상태. 없는 묶음은 아직 요청하지 않은 것이다. */
  parseChunks: Readonly<Record<number, HighlightChunkStatus>>;
  errorCode?: string;
};

/** 문서 주소. 멀티 layout Job 에서는 문서 id 가 layout 사이에 겹칠 수 있다. */
export type DocumentSelection = {
  stepId: string | null;
  documentId: string;
};

/** Step 탭에서 파생된 화면 모드: 구성 탭 → `structure`, 그 밖의 탭 → `values`. */
export type ReviewMode = "structure" | "values";

/**
 * Step 탭에서 파생된 패널 내용: 값 탭은 결과(값 편집), Parse·Instruct 탭은 그 Step 출력(Step id 를 담는다).
 * 구성 탭은 `"results"` 로 둔다.
 */
export type PanelTab = "results" | `parse:${string}` | `instruct:${string}`;

/**
 * Job 응답(추출값 좌표·Parse 요소) 로딩 상태. 실패해도 화면은 동작한다(하이라이트만 없다).
 * `parse` 의 `page` 는 병합 페이지다.
 */
export type ResponseEntry = {
  status: "loading" | "ready" | "error";
} & JobResponseData;

/** 충돌한 대상: 트레이 항목·값 결과·문서 구성. */
export type SaveConflict = {
  entryIds: readonly string[];
  resultIds: readonly string[];
  structure: boolean;
  /** 서버가 알린 충돌 대상 수. */
  count: number;
};

/**
 * 저장 진행과 마지막 결과. `uploading`·`polling`·`reloading` 동안은 편집·모드 전환·저장을 막는다.
 * `revision` 은 반영된 version 중 가장 큰 값이다.
 */
export type SaveStatus =
  | { phase: "idle" }
  | { phase: "uploading" }
  | { phase: "polling"; importId: string }
  | {
      phase: "reloading";
      /** 저장 뒤 다시 불러오기면 그 가져오기 id, 변경을 버리고 다시 불러오기면 `null`. */
      importId: string | null;
      revision: number | null;
      partial: boolean;
    }
  | {
      phase: "saved";
      importId: string;
      revision: number | null;
      partial: boolean;
      /** 저장은 됐지만 다시 불러오지 못했을 때 오류 코드. */
      reloadFailed: string | null;
    }
  | { phase: "reloaded" }
  | { phase: "no_change"; importId: string | null }
  | {
      phase: "blocked";
      reason: "issues" | "package_limit_exceeded";
      bytes?: number;
      limit?: number;
    }
  | { phase: "conflict"; importId: string; conflict: SaveConflict }
  | {
      phase: "failed";
      code: string;
      importId: string | null;
      message: string | null;
      /** 서버 오류 위치가 가리키는 결과·필드(있으면 그 행에 표시). */
      resultId: string | null;
      fieldPointer: string | null;
      entryIds: readonly string[];
    }
  | {
      phase: "stopped";
      reason: "timeout" | "cancelled" | "unreachable";
      importId: string;
      code: string | null;
    };

export function isSaving(status: SaveStatus): boolean {
  return (
    status.phase === "uploading" ||
    status.phase === "polling" ||
    status.phase === "reloading"
  );
}

/** 하이라이트를 누가 골랐는지. 뷰어에서 골랐을 때만 패널이 그 행으로 스크롤한다. */
export type HighlightSource = "viewer" | "panel";

/**
 * 브라우저 임시 저장(저장하지 않은 변경)의 상태. 불러온 직후 `unchecked` 로 시작해 저장소를 읽은 뒤
 * `none`(없음) 또는 `found`(복원 배너) 가 되고, 쓰기가 실패하면 `write_failed`(사유별 안내) 가 된다.
 * `unchecked`·`found` 동안은 저장소에 쓰지 않는다(배너를 결정하기 전에 덮어쓰지 않도록).
 */
export type DraftState =
  | { status: "unchecked" }
  | { status: "none" }
  | {
      status: "found";
      stored: StoredDraft;
      /** 복원(`APPLY_MANY source "draft"`)이 실패한 항목(몇 번째·이유). 배너 전용. */
      restoreError?: { index: number; reason: DropReason };
    }
  | { status: "write_failed"; reason: DraftWriteFailure; bytes: number };

/**
 * 임시 저장을 쓰지 못한 사유. `too_large` = 상한(`DRAFT_MAX_BYTES`)을 넘었다,
 * `storage_full` = 브라우저 저장소가 쓰기를 거부했다(가득 참 등). 저장소가 아예 없는 환경은 사유가
 * 아니다(알리지 않고 꺼진다).
 */
export type DraftWriteFailure = "too_large" | "storage_full";

/**
 * 복원 배너가 떠 있는 채 편집이 성공하면 지난 임시 저장을 버린다(`found` → `none`). 그 뒤로는
 * 새 편집이 임시 저장된다. 다른 상태는 그대로.
 */
function dismissDraftOnEdit(draft: DraftState): DraftState {
  return draft.status === "found" ? { status: "none" } : draft;
}

/**
 * 임시 저장에서 복원한 draft 적용. 임시 저장은 브라우저 저장소에서 오므로 모양이 깨져 있을 수
 * 있고, 리듀서가 던지면 화면 전체가 오류 경계 없이 내려간다 — 예외는 적용 실패로 바꿔 배너에 보인다.
 * JSON 시트 출처는 불러오기 전에 모양을 검증하므로 감싸지 않는다.
 */
function addRestoredChange(
  session: ReviewSession,
  draft: ChangeDraft,
): ReturnType<typeof addChange> {
  try {
    return addChange(session, draft);
  } catch {
    return { ok: false, reason: "target_missing" };
  }
}

/** 검수 상태 줄(`aria-live`)에 알릴 마지막 사건. */
export type ReviewStatusNotice =
  "completed" | "reopened" | "reverted_by_save" | "failed";

/** Job 검수 상태(앱 DB). 불러오기에 성공하면 `start` 를 보내 그 응답으로 현재 상태를 안다. */
export type ReviewStatusState = {
  /** `unknown` = 서버 응답 전 */
  value: "unknown" | ReviewStatusValue;
  completedAt: string | null;
  /** 진행 중인 요청(중복 방지·버튼 비활성) */
  updating: ReviewStatusAction | null;
  /** 검수 완료 상태에서 저장이 반영됐다 — 검수 중으로 되돌리는 요청을 보내야 한다. */
  revertRequested: boolean;
  /**
   * `start` 요청 중에 저장이 반영됐다. 응답이 검수 완료로 오면 되돌리기를 요청한다
   * (`start` 응답에서 한 번 쓰고 지운다).
   */
  committedDuringStart: boolean;
  /** `start` 요청이 실패했다. 다시 보내지 않는다(실패 뒤 재시도가 이어지지 않게). */
  startFailed: boolean;
  notice: ReviewStatusNotice | null;
};

const INITIAL_REVIEW_STATUS: ReviewStatusState = {
  value: "unknown",
  completedAt: null,
  updating: null,
  revertRequested: false,
  committedDuringStart: false,
  startFailed: false,
  notice: null,
};

/** `APPLY_MANY` 의 출처: 전체 JSON 시트 또는 브라우저 임시 저장 복원. */
export type ImportSource = "json" | "draft";

export type JobReviewState = {
  requestKey: string;
  status: "loading" | "ready" | "error";
  error: unknown;
  collectionId: string;
  jobId: string;
  collectionName: string | null;
  session: ReviewSession | null;
  etag: string | null;
  capabilities: ReviewCapabilities | null;
  files: Record<string, FileEntry>;
  response: ResponseEntry;
  mode: ReviewMode;
  /** 고른 Step 탭 id. `null` 이면 아직 고르지 않았다(화면이 기본 탭으로 해석한다). */
  stepTab: string | null;
  selectedDocument: DocumentSelection | null;
  selectedPageIndex: number;
  selectedHighlightId: string | null;
  highlightSource: HighlightSource | null;
  hoveredHighlightId: string | null;
  panelTab: PanelTab;
  /** 마지막 편집이 적용되지 않은 이유(다음 편집이 성공하면 지운다). */
  editError: DropReason | null;
  /**
   * 마지막 JSON 가져오기(`APPLY_MANY source "json"`)에서 적용되지 않은 항목(몇 번째·이유). 성공하면
   * 지운다. 임시 저장 복원 실패는 `draft.restoreError` 에 따로 둔다.
   */
  importError: { index: number; reason: DropReason } | null;
  /** 불러온 검수 JSON 응답 텍스트 그대로(원본 다운로드용). 다시 불러오면 바꾼다. */
  sourceText: string | null;
  /** 전체 JSON 편집 시트가 열려 있는가. */
  jsonSheetOpen: boolean;
  trayOpen: boolean;
  /**
   * 변경 이력 시트. `resultId` 는 결과 하나의 이력으로 열었을 때 그 결과 id(전체 이력이면 `null`).
   * 열고 닫을 때 `editError` 를 비운다 — 열린 동안 생긴 `editError` 는 시트 안 불러오기 실패뿐이다.
   */
  history: HistorySheetState;
  save: SaveStatus;
  /** 마지막 되돌리기에 함께 빠진 뒤 항목 수(없으면 `null`). */
  revertNotice: number | null;
  /** 마지막 `APPLY_MANY` 로 더한 항목 수와 출처(없으면 `null`). 다음 편집·되돌리기·트레이 닫기에서 지운다. */
  importNotice: { count: number; source: ImportSource } | null;
  /** 마지막 "모두 되돌리기" 로 버린 항목 수(없으면 `null`). `revertNotice` 와 같은 때 지운다. */
  revertAllNotice: number | null;
  /** 브라우저 임시 저장 상태. 불러올 때마다 `unchecked` 로 돌아간다. */
  draft: DraftState;
  reviewStatus: ReviewStatusState;
};

export type HistorySheetState = { open: boolean; resultId: string | null };

export const CLOSED_HISTORY: HistorySheetState = {
  open: false,
  resultId: null,
};

export type JobReviewAction =
  | {
      type: "RESET";
      requestKey: string;
      collectionId: string;
      jobId: string;
    }
  | {
      type: "LOADED";
      session: ReviewSession;
      sourceText: string;
      etag: string | null;
      capabilities: ReviewCapabilities | null;
      collectionName: string | null;
      /**
       * 처음 고를 문서·페이지(주소창 쿼리). 문서 id 가 같은 첫 문서를 고르고 페이지는 그 문서의
       * 범위 안으로 줄인다. 모르는 문서면 첫 문서·첫 페이지.
       */
      initialSelection?: {
        documentId: string | null;
        pageIndex: number | null;
      } | null;
    }
  | { type: "LOAD_FAILED"; error: unknown }
  | { type: "FILE_LOADING"; fileRef: string }
  | { type: "FILE_LOADED"; fileRef: string; response: FilePagesResponse }
  | { type: "FILE_FAILED"; fileRef: string; code: string }
  /** 묶음(`chunk` 시작 페이지) 요청을 보냈다. `fileId` 가 지금 파일과 다르면 무시한다. */
  | {
      type: "FILE_HIGHLIGHTS_LOADING";
      fileRef: string;
      fileId: string;
      chunk: number;
    }
  /** 묶음을 받았다. 묶음 범위 안인데 응답에 없는 페이지는 빈 배열로 채운다. */
  | {
      type: "FILE_HIGHLIGHTS_LOADED";
      fileRef: string;
      fileId: string;
      chunk: number;
      pages: readonly FileHighlightsPage[];
    }
  | {
      type: "FILE_HIGHLIGHTS_FAILED";
      fileRef: string;
      fileId: string;
      chunk: number;
      code: string;
    }
  /** 실패한 묶음 상태만 지워 다음 렌더에서 다시 요청되게 한다(받은 묶음·받는 중인 묶음은 그대로). */
  | { type: "FILE_HIGHLIGHTS_RETRY"; fileRef: string }
  | { type: "RESPONSE_LOADED"; data: JobResponseData }
  | { type: "RESPONSE_FAILED" }
  | { type: "SELECT_DOCUMENT"; document: DocumentSelection }
  | { type: "SELECT_PAGE"; index: number }
  | {
      type: "SELECT_HIGHLIGHT";
      id: string | null;
      source?: HighlightSource;
      /** 함께 옮길 뷰어 페이지(0-based). */
      pageIndex?: number;
    }
  | { type: "HOVER_HIGHLIGHT"; id: string | null }
  | { type: "APPLY"; draft: ChangeDraft }
  /**
   * 여러 변경을 한 편집으로(전부 적용되거나 하나도 적용되지 않는다). 부작용은 `APPLY` 와 같고
   * 트레이·가져오기 알림은 건드리지 않는다(`APPLY_MANY` 와 다른 점).
   */
  | { type: "APPLY_BATCH"; drafts: readonly ChangeDraft[] }
  /**
   * 여러 변경을 한 번에(전부 적용되거나 하나도 적용되지 않는다). 성공하면 트레이를 연다.
   * `source` 가 `draft`(임시 저장 복원)면 성공할 때 임시 저장 상태도 `none` 으로 돌린다.
   */
  | {
      type: "APPLY_MANY";
      drafts: readonly ChangeDraft[];
      source?: ImportSource;
    }
  | { type: "OPEN_JSON" }
  | { type: "CLOSE_JSON" }
  | { type: "REVERT"; entryIds: readonly string[] }
  /** 모든 변경 항목을 버린다(저장하지 않은 수정이 모두 사라진다). */
  | { type: "REVERT_ALL" }
  /** Step 탭을 고른다. 탭 종류에 따라 모드·패널 탭을 맞춘다. */
  | { type: "SET_STEP_TAB"; tab: StepTab }
  | { type: "OPEN_TRAY" }
  | { type: "CLOSE_TRAY" }
  /** 변경 이력 시트를 연다. `resultId` 가 있으면 그 결과의 이력으로 연다. JSON 시트는 닫는다. */
  | { type: "OPEN_HISTORY"; resultId?: string | null }
  | { type: "CLOSE_HISTORY" }
  | { type: "SAVE_STARTED" }
  | { type: "SAVE_POLLING"; importId: string }
  /** 저장이 끝났다(반영 제외). `openTray` 면 트레이를 연다. */
  | { type: "SAVE_FINISHED"; status: SaveStatus; openTray?: boolean }
  /** 반영됐다: 받은 version 을 채택한 세션으로 바꾸고 다시 불러오기를 시작한다. */
  | {
      type: "SAVE_COMMITTED";
      session: ReviewSession;
      importId: string;
      revision: number | null;
      partial: boolean;
    }
  /** 로컬 변경을 버리고 다시 불러오기 시작. */
  | { type: "RELOAD_STARTED" }
  | {
      type: "RELOADED";
      requestKey: string;
      session: ReviewSession;
      sourceText: string;
      etag: string | null;
    }
  | { type: "RELOAD_FAILED"; requestKey: string; code: string }
  /** 불러온 뒤 브라우저 저장소를 읽었다(`stored` 가 없으면 임시 저장 없음). `unchecked` 일 때만 받는다. */
  | { type: "DRAFT_CHECKED"; stored: StoredDraft | null }
  /** 복원 배너를 닫았다(임시 저장을 버린다). 복원 실패 표시도 지운다. */
  | { type: "DRAFT_DISMISSED" }
  /** 임시 저장을 쓰지 못했다(상한 초과·저장소 거부). 같은 사유·크기면 상태 그대로. */
  | { type: "DRAFT_WRITE_FAILED"; reason: DraftWriteFailure; bytes: number }
  /** 임시 저장을 썼거나 지웠다(`write_failed` 안내를 거둔다). */
  | { type: "DRAFT_WRITTEN" }
  /** 검수 상태 요청을 보냈다. 다른 요청(`requestKey`)의 것이면 무시한다. */
  | {
      type: "REVIEW_STATUS_UPDATING";
      requestKey: string;
      action: ReviewStatusAction;
    }
  | {
      type: "REVIEW_STATUS_UPDATED";
      requestKey: string;
      action: ReviewStatusAction;
      status: ReviewStatusRecord;
    }
  | {
      type: "REVIEW_STATUS_FAILED";
      requestKey: string;
      action: ReviewStatusAction;
    };

/** Parse 하이라이트 id 접두사. 추출값 하이라이트(`{결과 id}#{pointer}`)와 구분한다. */
export const PARSE_HIGHLIGHT_PREFIX = "parse:";

/**
 * 화면 Parse id `parse:{file_ref}:{key}`. `key` 는 파일 로컬 번호의 `p{page}-{elementId}`
 * (`parseElementKey`) — 뷰어 하이라이트(`parseHighlightsFor`)와 목록(`parseItemsFor`)이 함께 쓴다.
 */
export function parseHighlightId(fileRef: string, key: string): string {
  return `${PARSE_HIGHLIGHT_PREFIX}${fileRef}:${key}`;
}

export function isParseHighlightId(id: string | null): boolean {
  return id?.startsWith(PARSE_HIGHLIGHT_PREFIX) ?? false;
}

/** Instruct 인용 하이라이트 id 접두사(`instruct:{stepId}:{출력 index}:{인용 n}`). */
export const INSTRUCT_HIGHLIGHT_PREFIX = "instruct:";

export function isInstructHighlightId(id: string | null): boolean {
  return id?.startsWith(INSTRUCT_HIGHLIGHT_PREFIX) ?? false;
}

export function instructHighlightId(
  stepId: string,
  outputIndex: number,
  citation: number,
): string {
  return `${INSTRUCT_HIGHLIGHT_PREFIX}${stepId}:${outputIndex}:${citation}`;
}

/** Parse 하이라이트를 그리는가: Parse 탭이 열려 있을 때만. */
export function parseVisible(state: Pick<JobReviewState, "panelTab">): boolean {
  return state.panelTab.startsWith("parse:");
}

export function documentKey(selection: DocumentSelection): string {
  return `${selection.stepId ?? ""}\u0000${selection.documentId}`;
}

export function initialState(
  requestKey: string,
  collectionId: string,
  jobId: string,
): JobReviewState {
  return {
    requestKey,
    status: "loading",
    error: null,
    collectionId,
    jobId,
    collectionName: null,
    session: null,
    etag: null,
    capabilities: null,
    files: {},
    response: { status: "loading", ...EMPTY_JOB_RESPONSE },
    mode: "values",
    stepTab: null,
    selectedDocument: null,
    selectedPageIndex: 0,
    selectedHighlightId: null,
    highlightSource: null,
    hoveredHighlightId: null,
    panelTab: "results",
    editError: null,
    importError: null,
    sourceText: null,
    jsonSheetOpen: false,
    trayOpen: false,
    history: CLOSED_HISTORY,
    save: { phase: "idle" },
    revertNotice: null,
    importNotice: null,
    revertAllNotice: null,
    draft: { status: "unchecked" },
    reviewStatus: INITIAL_REVIEW_STATUS,
  };
}

export function jobOf(session: ReviewSession | null): ReviewJob | null {
  return session?.current.jobs[0] ?? null;
}

/** Job 의 입력 파일을 `input_index` 순으로(없으면 그룹·파일 순). */
export function jobFiles(job: ReviewJob | null): JobFile[] {
  const files = (job?.file_groups?.groups ?? []).flatMap(group => group.files);
  const sortKey = (index: number) => {
    const inputIndex = files[index]?.input_index;
    return Number.isInteger(inputIndex)
      ? (inputIndex as number)
      : files.length + index;
  };
  return files
    .map((file, index) => ({ file, key: sortKey(index) }))
    .sort((a, b) => a.key - b.key)
    .map(({ file }) => ({
      fileRef: file.file_ref,
      fileId: file.file_id,
      name: file.name,
      numPages: file.num_pages ?? null,
    }));
}

function updateFile(
  state: JobReviewState,
  fileRef: string,
  update: (entry: FileEntry) => FileEntry,
): JobReviewState {
  const entry = Object.hasOwn(state.files, fileRef)
    ? state.files[fileRef]
    : undefined;
  if (!entry) return state;
  return { ...state, files: { ...state.files, [fileRef]: update(entry) } };
}

/** 묶음 응답은 그 파일(`fileId`)의 것일 때만 받는다(다시 불러와 파일이 바뀐 뒤 늦게 온 응답 무시). */
function updateFileHighlights(
  state: JobReviewState,
  action: { fileRef: string; fileId: string },
  update: (entry: FileEntry) => FileEntry,
): JobReviewState {
  const entry = Object.hasOwn(state.files, action.fileRef)
    ? state.files[action.fileRef]
    : undefined;
  if (!entry || entry.fileId !== action.fileId) return state;
  return {
    ...state,
    files: { ...state.files, [action.fileRef]: update(entry) },
  };
}

/** 묶음 `chunk` 가 덮는 파일 로컬 페이지 범위(끝은 파일 쪽수를 넘지 않는다). */
function chunkRange(chunk: number, numPages: number | null): [number, number] {
  const last = chunk + HIGHLIGHT_CHUNK - 1;
  return [chunk, numPages === null ? last : Math.min(last, numPages)];
}

export function jobReviewReducer(
  state: JobReviewState,
  action: JobReviewAction,
): JobReviewState {
  switch (action.type) {
    case "RESET":
      return initialState(action.requestKey, action.collectionId, action.jobId);
    case "LOADED": {
      const job = jobOf(action.session);
      const files = fileEntries(job, {});
      const { first, pageIndex } = initialSelectionOf(
        job,
        action.initialSelection ?? null,
      );
      return {
        ...state,
        status: "ready",
        error: null,
        session: action.session,
        sourceText: action.sourceText,
        etag: action.etag,
        capabilities: action.capabilities,
        collectionName: action.collectionName,
        files,
        stepTab: null,
        selectedDocument: first
          ? { stepId: first.stepId, documentId: first.document.document_id }
          : null,
        selectedPageIndex: pageIndex,
        selectedHighlightId: null,
        highlightSource: null,
        hoveredHighlightId: null,
        // 새로 불러왔으니 임시 저장을 다시 읽는다(읽기 전에는 쓰지 않는다).
        draft: { status: "unchecked" },
      };
    }
    case "LOAD_FAILED":
      return { ...state, status: "error", error: action.error };
    case "FILE_LOADING":
      return updateFile(state, action.fileRef, entry => ({
        ...entry,
        status: "loading",
        errorCode: undefined,
      }));
    case "FILE_LOADED": {
      const { response } = action;
      return updateFile(state, action.fileRef, entry => ({
        ...entry,
        status: filePagesReady(response) ? "ready" : "not_ready",
        numPages:
          response.num_pages ??
          (response.pages.length > 0 ? response.pages.length : entry.numPages),
        imageUrls: response.pages.map(page => page.image_url),
        // 파일을 (다시) 받으면 하이라이트 묶음은 처음부터 다시 받는다.
        parse: {},
        parseChunks: {},
        errorCode: undefined,
      }));
    }
    case "FILE_FAILED":
      return updateFile(state, action.fileRef, entry => ({
        ...entry,
        status: "error",
        errorCode: action.code,
      }));
    case "FILE_HIGHLIGHTS_LOADING":
      return updateFileHighlights(state, action, entry => ({
        ...entry,
        parseChunks: { ...entry.parseChunks, [action.chunk]: "loading" },
      }));
    case "FILE_HIGHLIGHTS_LOADED":
      return updateFileHighlights(state, action, entry => {
        const parse: Record<number, HighlightLike[]> = { ...entry.parse };
        const [from, to] = chunkRange(action.chunk, entry.numPages);
        for (let page = from; page <= to; page += 1) parse[page] = [];
        for (const item of action.pages) {
          if (item.page >= from && item.page <= to) {
            parse[item.page] = item.highlights;
          }
        }
        return {
          ...entry,
          parse,
          parseChunks: { ...entry.parseChunks, [action.chunk]: "ready" },
        };
      });
    case "FILE_HIGHLIGHTS_FAILED":
      return updateFileHighlights(state, action, entry => ({
        ...entry,
        parseChunks: { ...entry.parseChunks, [action.chunk]: "error" },
      }));
    case "FILE_HIGHLIGHTS_RETRY": {
      const entry = Object.hasOwn(state.files, action.fileRef)
        ? state.files[action.fileRef]
        : undefined;
      if (!entry) return state;
      const kept = Object.entries(entry.parseChunks).filter(
        ([, status]) => status !== "error",
      );
      if (kept.length === Object.keys(entry.parseChunks).length) return state;
      return updateFile(state, action.fileRef, current => ({
        ...current,
        parseChunks: Object.fromEntries(kept),
      }));
    }
    case "RESPONSE_LOADED":
      return { ...state, response: { status: "ready", ...action.data } };
    case "RESPONSE_FAILED":
      return {
        ...state,
        response: { status: "error", ...EMPTY_JOB_RESPONSE },
      };
    case "SELECT_DOCUMENT":
      return {
        ...state,
        selectedDocument: action.document,
        selectedPageIndex: 0,
        selectedHighlightId: null,
        highlightSource: null,
        hoveredHighlightId: null,
      };
    case "SELECT_PAGE":
      return action.index === state.selectedPageIndex
        ? state
        : { ...state, selectedPageIndex: action.index };
    case "SELECT_HIGHLIGHT":
      return {
        ...state,
        selectedHighlightId: action.id,
        highlightSource: action.id === null ? null : (action.source ?? null),
        selectedPageIndex:
          action.pageIndex !== undefined && action.pageIndex >= 0
            ? action.pageIndex
            : state.selectedPageIndex,
      };
    case "HOVER_HIGHLIGHT":
      return action.id === state.hoveredHighlightId
        ? state
        : { ...state, hoveredHighlightId: action.id };
    case "APPLY": {
      if (!state.session || isSaving(state.save)) return state;
      const outcome = addChange(state.session, action.draft);
      // 지금 값과 같은 입력은 편집이 아니다 — 저장 상태·안내는 그대로 두고, 남아 있던 편집 오류만 지운다.
      if (outcome.ok && outcome.session === state.session) {
        return clearEditError(state);
      }
      return outcome.ok
        ? {
            ...withSession(state, outcome.session),
            save: afterEdit(state.save),
            revertNotice: null,
            importNotice: null,
            revertAllNotice: null,
            draft: dismissDraftOnEdit(state.draft),
          }
        : { ...state, editError: outcome.reason };
    }
    case "APPLY_BATCH": {
      if (
        !state.session ||
        isSaving(state.save) ||
        action.drafts.length === 0
      ) {
        return state;
      }
      let session = state.session;
      for (const draft of action.drafts) {
        const outcome = addChange(session, draft);
        if (!outcome.ok) return { ...state, editError: outcome.reason };
        session = outcome.session;
      }
      // 세션이 그대로면(모두 지금 값과 같으면) APPLY 와 같은 규칙으로 다룬다.
      if (session === state.session) return clearEditError(state);
      return {
        ...withSession(state, session),
        save: afterEdit(state.save),
        revertNotice: null,
        importNotice: null,
        revertAllNotice: null,
        draft: dismissDraftOnEdit(state.draft),
      };
    }
    case "APPLY_MANY": {
      if (
        !state.session ||
        isSaving(state.save) ||
        action.drafts.length === 0
      ) {
        return state;
      }
      const source = action.source ?? "json";
      let session = state.session;
      // 실제로 세션을 바꾼 draft 수. 합쳐지거나 처음 값으로 돌아가 지워진 것도 세고, 지금 값과 같은 것만 뺀다.
      let applied = 0;
      for (const [index, draft] of action.drafts.entries()) {
        const outcome =
          source === "draft"
            ? addRestoredChange(session, draft)
            : addChange(session, draft);
        if (!outcome.ok) {
          const failure = { index, reason: outcome.reason };
          if (source === "draft") {
            // 복원 실패는 배너 전용 — JSON 시트의 오류(importError)와 섞지 않는다.
            return {
              ...state,
              editError: outcome.reason,
              draft:
                state.draft.status === "found"
                  ? { ...state.draft, restoreError: failure }
                  : state.draft,
            };
          }
          return { ...state, editError: outcome.reason, importError: failure };
        }
        if (outcome.session !== session) applied += 1;
        session = outcome.session;
      }
      if (applied === 0) {
        // 모두 이미 반영돼 있다 — 세션·되돌리기 안내는 그대로 두고 0 건 안내만 보인다. 안내는 저장 상태가
        // idle 일 때만 보이므로 지난 "저장됨" 문구는 거둔다(afterEdit 는 idle·conflict 를 바꾸지 않아
        // 저장할 것이 생긴 것처럼 되지 않는다).
        return {
          ...state,
          editError: null,
          importError: null,
          importNotice: { count: 0, source },
          save: afterEdit(state.save),
          jsonSheetOpen: false,
          trayOpen: true,
          history: CLOSED_HISTORY,
          draft: source === "draft" ? { status: "none" } : state.draft,
        };
      }
      return {
        ...withSession(state, session),
        importError: null,
        save: afterEdit(state.save),
        revertNotice: null,
        revertAllNotice: null,
        importNotice: { count: applied, source },
        jsonSheetOpen: false,
        trayOpen: true,
        history: CLOSED_HISTORY,
        // 복원했으면 배너를 거두고 쓰기를 시작한다(복원한 항목이 다시 임시 저장된다). JSON 가져오기도
        // 편집이므로 배너가 떠 있었다면 지난 임시 저장을 버린다.
        draft:
          source === "draft"
            ? { status: "none" }
            : dismissDraftOnEdit(state.draft),
      };
    }
    case "OPEN_JSON":
      return state.jsonSheetOpen
        ? state
        : {
            ...state,
            jsonSheetOpen: true,
            importError: null,
            history: CLOSED_HISTORY,
          };
    case "CLOSE_JSON":
      return state.jsonSheetOpen
        ? { ...state, jsonSheetOpen: false, importError: null }
        : state;
    case "REVERT": {
      let session = state.session;
      if (!session || isSaving(state.save)) return state;
      // 함께 되돌림은 요청하지 않은 항목만 센다 — 묶음 안 뒤 항목이 앞 항목 되돌리기로 먼저
      // 빠져도 요청한 것이므로 알리지 않는다.
      const requested = new Set(action.entryIds);
      let alsoReverted = 0;
      for (const id of action.entryIds) {
        const outcome = revertChange(session, id);
        session = outcome.session;
        alsoReverted += outcome.alsoReverted.filter(
          item => !requested.has(item.entry.id),
        ).length;
      }
      return session === state.session
        ? state
        : {
            ...withSession(state, session),
            save: afterEdit(state.save),
            revertNotice: alsoReverted > 0 ? alsoReverted : null,
            importNotice: null,
            revertAllNotice: null,
          };
    }
    case "SET_STEP_TAB":
      return isSaving(state.save) ? state : withStepTab(state, action.tab);
    case "REVERT_ALL": {
      const session = state.session;
      if (!session || isSaving(state.save) || session.entries.length === 0) {
        return state;
      }
      return {
        ...withSession(state, resetSession(session)),
        // 충돌은 서버 version 문제라 로컬 변경을 버려도 풀리지 않는다(afterEdit 가 남긴다).
        save: afterEdit(state.save),
        revertNotice: null,
        importNotice: null,
        importError: null,
        revertAllNotice: session.entries.length,
      };
    }
    case "OPEN_TRAY":
      return state.trayOpen
        ? state
        : { ...state, trayOpen: true, history: CLOSED_HISTORY };
    case "CLOSE_TRAY":
      return state.trayOpen
        ? {
            ...state,
            trayOpen: false,
            revertNotice: null,
            importNotice: null,
            revertAllNotice: null,
          }
        : state;
    case "OPEN_HISTORY": {
      const resultId = action.resultId ?? null;
      if (state.history.open && state.history.resultId === resultId) {
        return state;
      }
      return {
        ...state,
        history: { open: true, resultId },
        jsonSheetOpen: false,
        editError: null,
      };
    }
    case "CLOSE_HISTORY":
      return state.history.open
        ? { ...state, history: CLOSED_HISTORY, editError: null }
        : state;
    case "SAVE_STARTED":
      return {
        ...state,
        save: { phase: "uploading" },
        revertNotice: null,
        importNotice: null,
        revertAllNotice: null,
      };
    case "SAVE_POLLING":
      return {
        ...state,
        save: { phase: "polling", importId: action.importId },
      };
    case "SAVE_FINISHED":
      return {
        ...state,
        save: action.status,
        trayOpen: state.trayOpen || action.openTray === true,
        // 충돌로 트레이를 열면 이력 시트는 닫는다(두 시트를 함께 띄우지 않는다).
        history: action.openTray === true ? CLOSED_HISTORY : state.history,
      };
    case "SAVE_COMMITTED": {
      // 검수 완료한 Job 을 고쳐 저장하면 검수 중으로 되돌린다(완료 요청이 아직 진행 중이어도).
      // `start` 요청 중이면 아직 상태를 모르므로 표식만 남기고 응답에서 판단한다.
      const { reviewStatus } = state;
      const revert =
        reviewStatus.value === "done" || reviewStatus.updating === "complete";
      const duringStart = reviewStatus.updating === "start";
      return {
        ...withSession(state, action.session),
        save: {
          phase: "reloading",
          importId: action.importId,
          revision: action.revision,
          partial: action.partial,
        },
        reviewStatus: revert
          ? { ...reviewStatus, revertRequested: true }
          : duringStart
            ? { ...reviewStatus, committedDuringStart: true }
            : reviewStatus,
      };
    }
    case "RELOAD_STARTED":
      return {
        ...state,
        save: {
          phase: "reloading",
          importId: null,
          revision: null,
          partial: false,
        },
        revertNotice: null,
        importNotice: null,
        revertAllNotice: null,
      };
    case "RELOADED": {
      if (action.requestKey !== state.requestKey) return state;
      const next = withSession(state, action.session);
      const previous = state.save;
      return {
        ...next,
        sourceText: action.sourceText,
        etag: action.etag,
        files: fileEntries(jobOf(action.session), state.files),
        save:
          previous.phase === "reloading" && previous.importId !== null
            ? {
                phase: "saved",
                importId: previous.importId,
                revision: previous.revision,
                partial: previous.partial,
                reloadFailed: null,
              }
            : { phase: "reloaded" },
      };
    }
    case "RELOAD_FAILED": {
      if (action.requestKey !== state.requestKey) return state;
      const previous = state.save;
      return {
        ...state,
        save:
          previous.phase === "reloading" && previous.importId !== null
            ? {
                phase: "saved",
                importId: previous.importId,
                revision: previous.revision,
                partial: previous.partial,
                reloadFailed: action.code,
              }
            : {
                phase: "failed",
                code: action.code,
                importId: null,
                message: null,
                resultId: null,
                fieldPointer: null,
                entryIds: [],
              },
      };
    }
    case "DRAFT_CHECKED":
      if (state.draft.status !== "unchecked") return state;
      return {
        ...state,
        draft: action.stored
          ? { status: "found", stored: action.stored }
          : { status: "none" },
      };
    case "DRAFT_DISMISSED":
      return state.draft.status === "found"
        ? { ...state, draft: { status: "none" } }
        : state;
    case "DRAFT_WRITE_FAILED":
      // 읽기 전·배너 결정 전에는 쓰기가 없으므로 늦게 온 실패는 무시한다. 같은 사유·크기는 같은 상태.
      if (
        state.draft.status === "unchecked" ||
        state.draft.status === "found" ||
        (state.draft.status === "write_failed" &&
          state.draft.reason === action.reason &&
          state.draft.bytes === action.bytes)
      ) {
        return state;
      }
      return {
        ...state,
        draft: {
          status: "write_failed",
          reason: action.reason,
          bytes: action.bytes,
        },
      };
    case "DRAFT_WRITTEN":
      return state.draft.status === "write_failed"
        ? { ...state, draft: { status: "none" } }
        : state;
    case "REVIEW_STATUS_UPDATING":
      if (action.requestKey !== state.requestKey) return state;
      return {
        ...state,
        reviewStatus: {
          ...state.reviewStatus,
          updating: action.action,
          // 같은 안내가 다시 나와도 읽히도록 사용자가 누른 요청은 지난 안내를 거둔다.
          notice: action.action === "start" ? state.reviewStatus.notice : null,
        },
      };
    case "REVIEW_STATUS_UPDATED": {
      if (action.requestKey !== state.requestKey) return state;
      const previous = state.reviewStatus;
      const notice: ReviewStatusNotice | null =
        action.action === "complete"
          ? "completed"
          : action.action === "reopen"
            ? previous.revertRequested
              ? "reverted_by_save"
              : "reopened"
            : previous.notice;
      return {
        ...state,
        reviewStatus: {
          ...previous,
          value: action.status.review_status,
          completedAt: action.status.review_completed_at,
          updating: null,
          // 완료·시작 요청 중에 저장이 반영됐고 응답이 완료면 되돌린다.
          revertRequested:
            action.action === "reopen"
              ? false
              : previous.revertRequested ||
                (action.action === "start" &&
                  previous.committedDuringStart &&
                  action.status.review_status === "done"),
          committedDuringStart:
            action.action === "start" ? false : previous.committedDuringStart,
          notice,
        },
      };
    }
    case "REVIEW_STATUS_FAILED": {
      if (action.requestKey !== state.requestKey) return state;
      const previous = state.reviewStatus;
      return {
        ...state,
        reviewStatus:
          action.action === "start"
            ? {
                ...previous,
                value: "pending",
                updating: null,
                revertRequested: false,
                committedDuringStart: false,
                startFailed: true,
              }
            : {
                ...previous,
                updating: null,
                revertRequested: false,
                notice: "failed",
              },
      };
    }
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

/** 모드 전환(`withStepTab` 이 쓴다). 같은 모드면 그대로. 저장 중 여부는 호출하는 쪽이 본다. */
function withMode(state: JobReviewState, mode: ReviewMode): JobReviewState {
  if (mode === state.mode) return state;
  // 구성 모드는 하이라이트를 그리지 않는다. 값 모드는 결과 탭으로 돌아가므로 추출값
  // 하이라이트만 남고 Parse·Instruct 인용(그 탭에서만 그린다)은 숨는다.
  const keep = (id: string | null) =>
    id !== null &&
    mode === "values" &&
    !isParseHighlightId(id) &&
    !isInstructHighlightId(id)
      ? id
      : null;
  const selectedHighlightId = keep(state.selectedHighlightId);
  return {
    ...state,
    mode,
    panelTab: "results",
    selectedHighlightId,
    highlightSource: selectedHighlightId ? state.highlightSource : null,
    hoveredHighlightId: keep(state.hoveredHighlightId),
    editError: null,
  };
}

/** 패널 내용 전환(`withStepTab` 이 쓴다). 같은 탭이거나 구성 모드면 그대로. */
function withPanelTab(state: JobReviewState, tab: PanelTab): JobReviewState {
  if (tab === state.panelTab || state.mode !== "values") return state;
  // 탭을 떠나면 그 탭만 그리던 하이라이트(Parse·Instruct 인용)의 선택·호버를 지운다.
  const next = { ...state, panelTab: tab };
  // 인용 하이라이트는 그 Instruct 탭에서만 그리므로 탭이 바뀌면 언제나 지운다.
  const showsParse = parseVisible(next);
  const keep = (id: string | null) => {
    if (id === null || isInstructHighlightId(id)) return null;
    if (isParseHighlightId(id)) return showsParse ? id : null;
    return id;
  };
  const selectedHighlightId = keep(state.selectedHighlightId);
  return {
    ...next,
    selectedHighlightId,
    highlightSource: selectedHighlightId ? state.highlightSource : null,
    hoveredHighlightId: keep(state.hoveredHighlightId),
  };
}

/**
 * Step 탭 전환: 구성 탭 → 구성 모드, 값 탭 → 값 모드 + 결과, Parse·Instruct 탭 → 값 모드 + 그 출력 탭.
 * 값 탭은 그 Step 결과만 보이므로 다른 Step 결과의 추출값 하이라이트 선택·호버를 지운다.
 */
function withStepTab(state: JobReviewState, tab: StepTab): JobReviewState {
  const panelTab: PanelTab | null =
    tab.kind === "values"
      ? "results"
      : tab.kind === "parse" && tab.stepId !== null
        ? `parse:${tab.stepId}`
        : tab.kind === "instruct" && tab.stepId !== null
          ? `instruct:${tab.stepId}`
          : null;
  let next = withMode(state, tab.kind === "structure" ? "structure" : "values");
  if (panelTab !== null) next = withPanelTab(next, panelTab);
  if (tab.kind === "structure") next = withLayoutSelection(next, tab.stepId);
  if (tab.kind === "values" && tab.stepId !== null) {
    const job = jobOf(next.session);
    const stepId = tab.stepId;
    const keep = (id: string | null) => {
      if (id === null || isParseHighlightId(id) || isInstructHighlightId(id)) {
        return id;
      }
      const resultId = id.slice(0, Math.max(id.indexOf("#"), 0));
      const result = job && resultId ? findResult(job, resultId) : null;
      return result && result.step_id !== stepId ? null : id;
    };
    const selectedHighlightId = keep(next.selectedHighlightId);
    const hoveredHighlightId = keep(next.hoveredHighlightId);
    if (
      selectedHighlightId !== next.selectedHighlightId ||
      hoveredHighlightId !== next.hoveredHighlightId
    ) {
      next = {
        ...next,
        selectedHighlightId,
        highlightSource: selectedHighlightId ? next.highlightSource : null,
        hoveredHighlightId,
      };
    }
  }
  return next === state && state.stepTab === tab.id
    ? state
    : { ...next, stepTab: tab.id };
}

/**
 * 구성 탭은 그 문서 배치 보기의 문서만 보인다. 선택 문서가 다른 보기에 있으면 그 보기의 첫 문서를
 * 고른다(보기가 하나인 Job 에서는 언제나 그대로).
 */
function withLayoutSelection(
  state: JobReviewState,
  stepId: string | null,
): JobReviewState {
  if (state.selectedDocument?.stepId === stepId) return state;
  const job = jobOf(state.session);
  const first = (job ? documentsOf(job) : []).find(
    item => item.stepId === stepId,
  );
  if (!first) return state;
  return {
    ...state,
    selectedDocument: { stepId, documentId: first.document.document_id },
    selectedPageIndex: 0,
    selectedHighlightId: null,
    highlightSource: null,
    hoveredHighlightId: null,
  };
}

/** 편집 오류만 지운다. 오류가 없으면 같은 state 를 돌려준다. */
function clearEditError(state: JobReviewState): JobReviewState {
  return state.editError === null ? state : { ...state, editError: null };
}

/** 편집하면 지난 저장 결과 안내는 지운다. 충돌은 다시 불러올 때까지 남긴다. */
function afterEdit(save: SaveStatus): SaveStatus {
  return save.phase === "conflict" || save.phase === "idle"
    ? save
    : { phase: "idle" };
}

/** Job 의 파일마다 로딩 상태. 같은 파일(`file_ref`·`file_id`)은 기존 상태를 그대로 쓴다. */
function fileEntries(
  job: ReviewJob | null,
  previous: Readonly<Record<string, FileEntry>>,
): Record<string, FileEntry> {
  const files: Record<string, FileEntry> = {};
  for (const file of jobFiles(job)) {
    const kept = Object.hasOwn(previous, file.fileRef)
      ? previous[file.fileRef]
      : undefined;
    files[file.fileRef] =
      kept && kept.fileId === file.fileId
        ? kept
        : {
            fileId: file.fileId,
            name: file.name,
            status: "loading",
            numPages: file.numPages,
            imageUrls: [],
            parse: {},
            parseChunks: {},
          };
  }
  return files;
}

/**
 * 편집 뒤 세션을 바꾸고 선택을 유지한다. 선택 문서가 사라졌으면 같은 보기에서 그 자리에 있는
 * 문서(없으면 마지막, 보기가 비면 첫 문서)를 고르고, 페이지 위치는 문서의 페이지 수 안으로 줄인다.
 * 이 "그 자리 문서" 와 위치 줄이기는 페이지가 간 곳을 모르는 경우(되돌리기·다시 읽기·임시 저장
 * 복원·JSON 가져오기)의 fallback 이다. 나누기·페이지 옮기기·합치기·제외처럼 대상을 아는 편집은
 * `useStructureActions` 가 APPLY 뒤 보던 페이지가 있는 문서와 위치를 고른다(선택은 보던 페이지를
 * 따라간다). APPLY 와 그 SELECT_* 는 한 이벤트 핸들러 안에서 보내므로 React 가 묶어 처리해 중간의
 * 줄인 위치는 그려지지 않는다.
 */
function withSession(
  state: JobReviewState,
  session: ReviewSession,
): JobReviewState {
  const job = jobOf(session);
  const documents = job ? documentsOf(job) : [];
  const current = state.selectedDocument;
  const found = current
    ? documents.find(
        item =>
          item.stepId === current.stepId &&
          item.document.document_id === current.documentId,
      )
    : undefined;
  const next =
    found ??
    (current
      ? nearestDocument(jobOf(state.session), documents, current)
      : undefined) ??
    documents[0];
  const changedDocument = next !== found;
  const pageCount = next ? safePageCount(next.document) : 0;
  return {
    ...state,
    session,
    editError: null,
    selectedDocument: next
      ? { stepId: next.stepId, documentId: next.document.document_id }
      : null,
    selectedPageIndex: changedDocument
      ? 0
      : Math.min(state.selectedPageIndex, Math.max(pageCount - 1, 0)),
    selectedHighlightId: changedDocument ? null : state.selectedHighlightId,
    highlightSource: changedDocument ? null : state.highlightSource,
    hoveredHighlightId: changedDocument ? null : state.hoveredHighlightId,
  };
}

/**
 * 사라진 선택 문서 대신 고를 문서: 이전 Job 의 같은 보기 안 위치에 지금 있는 문서(그 위치가
 * 없어졌으면 그 보기의 마지막 문서). 이전 위치를 모르거나 보기가 비었으면 `undefined`.
 */
function nearestDocument(
  previousJob: ReviewJob | null,
  documents: readonly LocatedDocument[],
  current: DocumentSelection,
): LocatedDocument | undefined {
  const previous = previousJob
    ? documentsOf(previousJob).filter(item => item.stepId === current.stepId)
    : [];
  const previousIndex = previous.findIndex(
    item => item.document.document_id === current.documentId,
  );
  if (previousIndex < 0) return undefined;
  const sameLayout = documents.filter(item => item.stepId === current.stepId);
  return sameLayout[Math.min(previousIndex, sameLayout.length - 1)];
}

function safePageCount(document: ReviewDocumentEntry): number {
  try {
    return flattenPages(document).length;
  } catch {
    return 0;
  }
}

/**
 * 불러온 직후 고를 문서·페이지. 요청한 문서 id 와 같은 첫 문서(보기 순서)를 고르고 페이지를 그
 * 문서의 범위 안으로 줄인다. 문서를 지정하지 않았으면 첫 문서에 페이지만 적용하고, 모르는 문서면
 * 첫 문서·첫 페이지로 돌아간다.
 */
function initialSelectionOf(
  job: ReviewJob | null,
  initial: { documentId: string | null; pageIndex: number | null } | null,
): { first: LocatedDocument | undefined; pageIndex: number } {
  const documents = job ? documentsOf(job) : [];
  const wanted = initial?.documentId ?? null;
  const found =
    wanted === null
      ? undefined
      : documents.find(item => item.document.document_id === wanted);
  const first = found ?? documents[0];
  const applyPage = first !== undefined && (found !== undefined || !wanted);
  const requested = initial?.pageIndex ?? null;
  if (!applyPage || requested === null || !Number.isInteger(requested)) {
    return { first, pageIndex: 0 };
  }
  const pageCount = safePageCount(first.document);
  return {
    first,
    pageIndex: Math.min(Math.max(requested, 0), Math.max(pageCount - 1, 0)),
  };
}

/**
 * Parse 하이라이트를 현재 문서의 뷰어 페이지로 옮긴다. id 는 `parseHighlightId(file_ref, p{로컬 page}-{elementId})`
 * (파일 사이 충돌을 막고 추출값 하이라이트와 구분한다).
 * 페이지 단위로, 그 페이지의 파일 하이라이트를 받았고 하나 이상이면 그것을, 아니면 Job 응답의 Parse
 * 출력(`fromResponse`, `parseHighlightsByFile` 이 파일 로컬 page·id 로 나눈 것)을 쓴다 — 파일 응답에
 * Parse 요소가 없는 파일(Collection 이 복사해 둔 파일)과 아직 받지 않은 묶음을 같은 규칙으로 메운다.
 * 두 경로 모두 키가 파일 로컬 번호라 같은 요소면 같은 id 이고, 목록(`parseItemsFor`)도 같은 id 를 낸다.
 */
export function parseHighlightsFor(
  docPages: readonly PageRef[],
  files: Readonly<Record<string, FileEntry>>,
  fromResponse: Readonly<Record<string, HighlightLike[][]>> = {},
): HighlightLike[] {
  return docPages.flatMap((ref, index) => {
    const entry = Object.hasOwn(files, ref.file_ref)
      ? files[ref.file_ref]
      : undefined;
    const own = entry?.parse[ref.page];
    const list =
      own && own.length > 0
        ? own
        : Object.hasOwn(fromResponse, ref.file_ref)
          ? (fromResponse[ref.file_ref]?.[ref.page - 1] ?? [])
          : [];
    return list.map(highlight => ({
      ...highlight,
      id: parseHighlightId(ref.file_ref, highlight.id),
      page: index + 1,
    }));
  });
}

/** 페이지 이미지 로딩 진행. `pending` 은 아직 받는 중인 파일이 있는가. */
export type FileProgress = {
  /** 이미지 URL 을 받은 파일 수(준비 중인 파일 포함). */
  files: number;
  totalFiles: number;
  /** 이미지 URL 을 받은 페이지 수. */
  pages: number;
  /** 파일 쪽수의 합(모르는 파일은 받은 페이지 수로 센다). */
  totalPages: number;
  pending: boolean;
};

export function fileProgress(
  files: Readonly<Record<string, FileEntry>>,
): FileProgress {
  const progress: FileProgress = {
    files: 0,
    totalFiles: 0,
    pages: 0,
    totalPages: 0,
    pending: false,
  };
  for (const entry of Object.values(files)) {
    progress.totalFiles += 1;
    progress.totalPages += entry.numPages ?? entry.imageUrls.length;
    if (entry.status === "loading") {
      progress.pending = true;
      continue;
    }
    if (entry.status === "error") continue;
    progress.files += 1;
    progress.pages += entry.imageUrls.filter(url => url !== null).length;
  }
  return progress;
}

/** 현재 문서의 뷰어 이미지 URL. 아직 없는 페이지는 빈 문자열(뷰어가 페이지 번호를 밀지 않는다). */
export function imageUrlsFor(
  docPages: readonly PageRef[],
  files: Readonly<Record<string, FileEntry>>,
): string[] {
  return docPages.map(ref => {
    const entry = Object.hasOwn(files, ref.file_ref)
      ? files[ref.file_ref]
      : undefined;
    return entry?.imageUrls[ref.page - 1] ?? "";
  });
}
