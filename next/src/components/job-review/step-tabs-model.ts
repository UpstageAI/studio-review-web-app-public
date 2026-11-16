import type { JobResponseData } from "@/lib/review-api/job-response";
import {
  layouts,
  rangesOverlapPages,
  results,
  resultsForDocument,
  stepDisplayName,
  unlinkedResults,
  type ReviewJob,
  type ReviewStep,
} from "@/lib/review-model";

// 검수 화면 상단 Step 탭 목록(순수 함수). 보여 줄 것이 있는 Step 만 탭이 되고,
// 문서를 골랐으면 그 문서에 해당하는 Step 만 남긴다.

/**
 * - `structure`: 문서 배치 보기(Classify Step 또는 분류 없는 보기) — 구성 편집
 * - `values`: 결과가 있는 Step — 값 편집
 * - `parse`·`instruct`: Job 응답의 Step 출력 — 보기 전용
 */
export type StepTabKind = "structure" | "values" | "parse" | "instruct";

/** 분류 없는 문서 배치 보기(`step_id: null`) 탭 id. */
export const NO_LAYOUT_STEP_TAB_ID = "layout:none";

export type StepTab = {
  /** Step id. 분류 없는 보기는 `NO_LAYOUT_STEP_TAB_ID`. */
  id: string;
  /** `structure` 의 `null` = 분류 없는 보기. */
  stepId: string | null;
  kind: StepTabKind;
  /** 배지용 원래 타입(검수 문서 카탈로그 우선, 없으면 응답 `step_type`). 분류 없는 보기는 `""`. */
  type: string;
  /** 표시 이름. `null` 이면 배지만(분류 없는 보기는 화면이 따로 문구를 쓴다). */
  name: string | null;
  /** 이 탭에서 고칠 수 있는가(저장 중 여부는 보지 않는다). */
  editable: boolean;
  /** 같은 타입·같은 이름 탭의 두 번째부터 2, 3, … (화면이 이름 뒤에 붙인다). */
  ordinal?: number;
  /**
   * Job 의 모든 탭 중 몇 번째인가(1부터). 설정에서 일부 단계를 숨겨도 Studio 워크플로우 순서 번호가
   * 바뀌지 않도록 숨기기 전에 매긴다.
   */
  order?: number;
};

type Steps = Readonly<Record<string, ReviewStep>> | undefined;

type TabResponse = Pick<
  JobResponseData,
  "parseElements" | "parseStepId" | "instructOutputs" | "stepOrder"
>;

/** 탭을 거를 선택 문서. */
export type DocumentScope = {
  documentId: string;
  /** 문서 페이지의 병합 페이지 번호. 공간을 몰라 알 수 없으면 `null`(Parse·Instruct 탭을 거르지 않는다). */
  mergedPages: ReadonlySet<number> | null;
};

/**
 * Job 의 Step 탭. 순서: 분류 없는 보기 → 응답 `stepOrder` 순 → 카탈로그 순 → 나머지(만난 순).
 * 한 Step 이 여럿에 해당하면 구성 > 값 > Parse > Instruct 순으로 하나만 고른다.
 */
export function stepTabsFor(
  job: ReviewJob | null,
  steps: Steps,
  response: TabResponse,
): StepTab[] {
  const kinds = new Map<string | null, StepTabKind>();
  const add = (stepId: string | null, kind: StepTabKind) => {
    if (!kinds.has(stepId)) kinds.set(stepId, kind);
  };
  const views = job ? layouts(job) : [];
  for (const view of views) add(view.step_id, "structure");
  for (const result of job ? results(job) : []) add(result.step_id, "values");
  if (response.parseStepId !== null && response.parseElements.length > 0) {
    add(response.parseStepId, "parse");
  }
  for (const output of response.instructOutputs) {
    add(output.stepId, "instruct");
  }

  const structureEditable = Boolean(job?.file_groups) && views.length === 1;
  const responseOrder = new Map(
    response.stepOrder.map((step, index) => [step.stepId, index]),
  );
  const catalogOrder = new Map(
    Object.keys(steps ?? {}).map((stepId, index) => [stepId, index]),
  );
  const rank = (stepId: string | null, seen: number): [number, number] => {
    if (stepId === null) return [0, 0];
    const fromResponse = responseOrder.get(stepId);
    if (fromResponse !== undefined) return [1, fromResponse];
    const fromCatalog = catalogOrder.get(stepId);
    if (fromCatalog !== undefined) return [2, fromCatalog];
    return [3, seen];
  };

  const tabs = [...kinds].map(([stepId, kind], seen) => ({
    tab: makeTab(stepId, kind, steps, response, structureEditable),
    rank: rank(stepId, seen),
  }));
  tabs.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1]);
  return withOrdinals(tabs.map(item => item.tab));
}

const OUTPUT_TYPES: Partial<Record<StepTabKind, string>> = {
  parse: "document-parse",
  instruct: "instruct",
};

function makeTab(
  stepId: string | null,
  kind: StepTabKind,
  steps: Steps,
  response: TabResponse,
  structureEditable: boolean,
): StepTab {
  const editable = kind === "structure" ? structureEditable : kind === "values";
  if (stepId === null) {
    return {
      id: NO_LAYOUT_STEP_TAB_ID,
      stepId,
      kind,
      type: "",
      name: null,
      editable,
    };
  }
  const step =
    steps && Object.hasOwn(steps, stepId) ? steps[stepId] : undefined;
  const fromResponse = response.stepOrder.find(item => item.stepId === stepId);
  const instructName = response.instructOutputs.find(
    output => output.stepId === stepId,
  )?.stepName;
  // 응답 출력만으로 생긴 탭은 타입을 몰라도 출력 종류로 안다.
  const type = step?.type || fromResponse?.stepType || OUTPUT_TYPES[kind] || "";
  const rawName = step?.name || fromResponse?.stepName || instructName || "";
  const name =
    step || fromResponse || instructName
      ? rawName === ""
        ? null
        : stepDisplayName({ name: rawName, type })
      : stepId;
  return { id: stepId, stepId, kind, type, name, editable };
}

function withOrdinals(tabs: StepTab[]): StepTab[] {
  const counts = new Map<string, number>();
  return tabs.map(tab => {
    const key = `${tab.type}\u0000${tab.name ?? "\u0001"}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count > 1 ? { ...tab, ordinal: count } : tab;
  });
}

/**
 * 선택 문서(분류로 나뉜 문서 하나)에 해당하는 탭만 남긴다. 분류 Step 이 `split` 이면 문서마다
 * 다른 Step 이 돌므로, 다른 문서의 Step 탭은 숨긴다.
 *
 * - 구성 탭: 모두(문서 배치 보기는 문서를 고르는 곳이다).
 * - 값 탭: 그 문서에 연결된 결과가 있는 Step. 어느 문서에도 연결되지 않은 결과만 있는 Step 도
 *   남긴다(그 탭에서만 볼 수 있다).
 * - Parse 탭: 그 문서 페이지에 요소가 있을 때.
 * - Instruct 탭: 그 문서 페이지와 겹치는 출력(페이지 범위가 없는 출력은 문서 전체)이 있을 때.
 */
export function stepTabsForDocument(
  tabs: readonly StepTab[],
  job: ReviewJob | null,
  scope: DocumentScope,
  response: Pick<TabResponse, "parseElements" | "instructOutputs">,
): StepTab[] {
  const valueSteps = new Set<string>();
  if (job) {
    for (const result of resultsForDocument(job, scope.documentId)) {
      valueSteps.add(result.step_id);
    }
    for (const result of unlinkedResults(job)) valueSteps.add(result.step_id);
  }
  const { mergedPages } = scope;
  return tabs.filter(tab => {
    switch (tab.kind) {
      case "structure":
        return true;
      case "values":
        return tab.stepId !== null && valueSteps.has(tab.stepId);
      case "parse":
        return (
          mergedPages === null ||
          response.parseElements.some(element => mergedPages.has(element.page))
        );
      case "instruct":
        return (
          mergedPages === null ||
          response.instructOutputs.some(
            output =>
              output.stepId === tab.stepId &&
              (output.pageRanges.length === 0 ||
                rangesOverlapPages(output.pageRanges, mergedPages)),
          )
        );
      default: {
        const unreachable: never = tab.kind;
        return unreachable;
      }
    }
  });
}

/**
 * 보일 탭: `current` 가 목록에 있으면 그것. 없으면 — `current` 가 선택 문서 때문에 숨은 탭
 * (`allTabs` 에는 있음)이면 같은 종류의 첫 탭(값 탭이면 이 문서의 첫 값 탭), 그 다음 첫 편집
 * 가능 탭, 그것도 없으면 첫 탭. 탭이 없으면 `null`.
 */
export function defaultStepTab(
  tabs: readonly StepTab[],
  current: string | null,
  allTabs: readonly StepTab[] = tabs,
): StepTab | null {
  const chosen =
    current !== null ? tabs.find(tab => tab.id === current) : undefined;
  if (chosen) return chosen;
  const hidden =
    current !== null ? allTabs.find(tab => tab.id === current) : undefined;
  return (
    (hidden ? tabs.find(tab => tab.kind === hidden.kind) : undefined) ??
    tabs.find(tab => tab.editable) ??
    tabs[0] ??
    null
  );
}
