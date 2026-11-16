"use client";

import { createContext, useContext, type Dispatch } from "react";
import type {
  DocumentChange,
  ExtractItem,
  HighlightLike,
  LocatedDocument,
  PageRef,
  PageSpace,
  PairedHighlight,
  Result,
  ReviewJob,
  ValidationIssue,
} from "@/lib/review-model";
import type { HighlightsStatus } from "./highlight-window";
import type { JobReviewAction, JobReviewState } from "./job-review-state";
import type { InstructView, ParseListItem } from "./step-outputs";
import type { StepTab } from "./step-tabs-model";

export type JobReviewContextValue = {
  state: JobReviewState;
  dispatch: Dispatch<JobReviewAction>;
  retry: () => void;
  /** 현재 편집 중인 Job(`session.current.jobs[0]`). */
  job: ReviewJob | null;
  documents: readonly LocatedDocument[];
  /** 문서 주소(`documentKey`) → base 와 비교한 변화. */
  docChanges: ReadonlyMap<string, DocumentChange>;
  selected: LocatedDocument | null;
  docPages: readonly PageRef[];
  imageUrls: string[];
  /** 현재 문서에서 그릴 수 있는 하이라이트 전체(탭에 따라 추출값·Parse·인용). 객체 정체성을 지키기 위해 memo 한다. */
  highlights: HighlightLike[];
  /** 뷰어에 실제로 넘기는 것: `highlights` 중 현재 페이지 ± `HIGHLIGHT_WINDOW` 쪽과 선택·호버된 것. */
  viewerHighlights: HighlightLike[];
  /** 현재 페이지 주변 파일 Parse 하이라이트 묶음의 로딩 상태. Parse 탭이 아니면 `idle`. */
  highlightsStatus: HighlightsStatus;
  /** 선택 문서의 추출값 하이라이트(id `{결과 id}#{pointer}`). 값 패널이 행과 잇는 데 쓴다. */
  extractHighlights: readonly PairedHighlight[];
  /** 결과 id → 짝지은 Job 응답 항목. 없으면 그 결과는 하이라이트가 없다. */
  pairing: ReadonlyMap<string, ExtractItem>;
  /** 병합 페이지 공간(Job 응답 좌표 → 파일 페이지). 파일 페이지 수를 모르면 `null`. */
  space: PageSpace | null;
  /** 상단 Step 탭(보여 줄 것이 있는 Step 중 선택 문서에 해당하는 것만). */
  stepTabs: readonly StepTab[];
  /** Job 의 Step 탭 전부(문서로 거르기 전, 설정에서 숨긴 단계는 뺀 것). */
  allStepTabs: readonly StepTab[];
  /**
   * 설정으로 숨기기 전 Job 의 Step 탭 수. 탭 줄을 보일지는 이것으로 정한다(단계를 하나만 남겨도 어느
   * 단계를 보고 있는지 탭 줄로 알 수 있게).
   */
  jobStepTabCount: number;
  /** 설정에서 켠 단계가 이 Job 에 하나도 없어 모든 단계를 보이는 중. */
  stepsFallback: boolean;
  /** 지금 보이는 Step 탭. `state.stepTab` 이 목록에 없으면 첫 편집 가능 탭(없으면 첫 탭). */
  activeStepTab: StepTab | null;
  /** 값·Parse·Instruct 탭의 Step id(그 Step 의 결과·출력만 보인다). 구성 탭이면 `null`. */
  activeStepId: string | null;
  /** 어느 문서에도 연결되지 않은 결과. */
  unlinkedResults: readonly Result[];
  /** 선택 문서의 Parse 요소 목록(Parse 탭). */
  parseItems: readonly ParseListItem[];
  /** 열린 Instruct 탭의 선택 문서 출력. Instruct 탭이 아니면 `null`. */
  instructView: InstructView | null;
  /** 저장 전 검증(구성 모드이거나 트레이가 열려 있을 때만 계산, 그 밖에서는 빈 배열). */
  issues: readonly ValidationIssue[];
  refreshFiles: (fileRefs: readonly string[]) => void;
  /** 검증 → 업로드 → 반영까지 기다린 뒤 다시 불러온다. */
  save: () => void;
  /** 로컬 변경을 버리고 최신 검수 문서를 다시 불러온다(확인은 호출하는 쪽에서). */
  reload: () => void;
  /** 업로드·반영 대기·다시 불러오기 중. 편집·Step 탭 전환·저장을 막는다. */
  saving: boolean;
  /** 검수 완료로 표시한다. 성공하면 `true`(실패는 상태 줄 안내). */
  completeReview: () => Promise<boolean>;
  /** 검수 중으로 되돌린다. */
  reopenReview: () => Promise<boolean>;
};

export const JobReviewContext = createContext<JobReviewContextValue | null>(
  null,
);

export function useJobReview(): JobReviewContextValue {
  const value = useContext(JobReviewContext);
  if (!value) throw new Error("useJobReview must be used in JobReviewProvider");
  return value;
}
