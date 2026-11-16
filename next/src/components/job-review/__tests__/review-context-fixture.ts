import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import {
  addChange,
  createSession,
  readReviewDocument,
  type ReviewSession,
  type ValidationIssue,
} from "@/lib/review-model";
import type { JobReviewContextValue } from "../job-review-context";
import {
  initialState,
  isSaving,
  jobOf,
  type JobReviewState,
} from "../job-review-state";

// jsdom 에서는 `import.meta.url` 이 파일 경로가 아니라서 모델 fixture 모듈 대신 같은 파일을 직접 읽는다.
const SINGLE_JOB = readFileSync(
  join(
    process.cwd(),
    "src/lib/review-model/__tests__/fixtures/single-job.json",
  ),
  "utf8",
);

/** 값 칸을 바꿔 변경 항목을 만드는 키(fixture `occ_extract_1` 의 숫자 칸). */
const VALUE_KEYS = ["amount", "rate", "scale", "delta"] as const;

/** fixture 검수 문서에서 시작해 숫자 칸 `count` 개를 바꾼 세션(변경 항목 `count` 개). */
export function sessionWith(count: number): ReviewSession {
  let session = createSession(readReviewDocument(SINGLE_JOB));
  for (let index = 0; index < count; index += 1) {
    const outcome = addChange(session, {
      kind: "set_value",
      jobId: "job_A",
      resultId: "occ_extract_1",
      path: [VALUE_KEYS[index]!],
      value: 7000 + index,
    });
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
  }
  return session;
}

/** 저장을 막는 검증 항목(값이 스키마에 맞지 않음). */
export const BLOCKING_ISSUE: ValidationIssue = {
  code: "schema_violation",
  severity: "error",
  jobId: "job_A",
  where: { kind: "field", resultId: "occ_extract_1", pointer: "/amount" },
};

export interface ContextOptions {
  /** 변경 항목 수(0 이면 세션은 있고 변경 없음). */
  changes?: number;
  state?: Partial<JobReviewState>;
  reviewStatus?: Partial<JobReviewState["reviewStatus"]>;
  issues?: readonly ValidationIssue[];
}

/** 렌더 테스트가 넘기는 검수 화면 Context 값과 호출 기록. */
export function reviewContext({
  changes = 0,
  state: stateOverrides = {},
  reviewStatus = {},
  issues = [],
}: ContextOptions = {}) {
  const session = sessionWith(changes);
  const base = initialState("request-1", "scol_test", "job_A");
  const state: JobReviewState = {
    ...base,
    status: "ready",
    collectionName: "테스트 Collection",
    session,
    ...stateOverrides,
    reviewStatus: {
      ...base.reviewStatus,
      value: "in_progress",
      ...reviewStatus,
    },
  };
  const calls = {
    dispatch: vi.fn<JobReviewContextValue["dispatch"]>(),
    save: vi.fn<() => void>(),
    reload: vi.fn<() => void>(),
    completeReview: vi.fn<() => Promise<boolean>>(async () => true),
    reopenReview: vi.fn<() => Promise<boolean>>(async () => true),
  };
  const value: JobReviewContextValue = {
    state,
    dispatch: calls.dispatch,
    retry: () => {},
    job: state.session ? jobOf(state.session) : null,
    documents: [],
    docChanges: new Map(),
    selected: null,
    docPages: [],
    imageUrls: [],
    highlights: [],
    viewerHighlights: [],
    highlightsStatus: "idle",
    extractHighlights: [],
    pairing: new Map(),
    space: null,
    stepTabs: [],
    allStepTabs: [],
    jobStepTabCount: 0,
    stepsFallback: false,
    activeStepTab: null,
    activeStepId: null,
    unlinkedResults: [],
    parseItems: [],
    instructView: null,
    issues,
    refreshFiles: () => {},
    save: calls.save,
    reload: calls.reload,
    saving: isSaving(state.save),
    completeReview: calls.completeReview,
    reopenReview: calls.reopenReview,
  };
  return { value, calls };
}
