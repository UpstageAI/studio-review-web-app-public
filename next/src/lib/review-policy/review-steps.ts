import { useCallback } from "react";
import { createStoredValue } from "@/lib/browser-storage";
import { stepTypeKey, type StepTypeKey } from "@/lib/review-model";

/**
 * 설정 메뉴 "검수할 단계" 에서 고르는 Step 종류(검수 화면 위 단계 탭). 기본은 고칠 수 있는 단계만 켜고,
 * 보기 전용인 Parse 와 Instruct 는 끈다. 모르는 종류의 Step 은 늘 보인다.
 */
export const REVIEW_STEP_TYPES: readonly StepTypeKey[] = [
  "parse",
  "classify",
  "split",
  "extract",
  "validate",
  "match",
  "merge",
  "instruct",
  "export",
];

/** 보기 전용 단계(설정 메뉴에서 그렇다고 알린다). */
export const READ_ONLY_STEP_TYPES: ReadonlySet<StepTypeKey> = new Set([
  "parse",
  "instruct",
]);

export type ReviewSteps = Record<StepTypeKey, boolean>;

/** 켜고 끈 값을 기억하는 localStorage 키(JSON, 예: `{"parse":true}`). 없는 종류는 기본값. */
export const REVIEW_STEPS_KEY = "review-steps";

export const REVIEW_STEP_DEFAULTS: ReviewSteps = {
  parse: false,
  classify: true,
  split: true,
  extract: true,
  validate: true,
  match: true,
  merge: true,
  instruct: false,
  export: true,
};

/** 저장된 글을 읽어 기본값에 덮는다. 읽을 수 없거나 모르는 값은 기본값으로 둔다. */
export function parseReviewSteps(text: string | null): ReviewSteps {
  const steps = { ...REVIEW_STEP_DEFAULTS };
  if (!text) return steps;
  try {
    const stored: unknown = JSON.parse(text);
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return steps;
    }
    for (const type of REVIEW_STEP_TYPES) {
      const value = (stored as Record<string, unknown>)[type];
      if (typeof value === "boolean") steps[type] = value;
    }
  } catch {
    // 깨진 값은 무시하고 기본값을 쓴다.
  }
  return steps;
}

/**
 * 설정에서 켠 종류의 탭만 남긴다. 모르는 종류는 남긴다. 남는 탭이 없으면(그 Job 의 단계를 모두 끈
 * 경우) 빈 화면이 되지 않게 모든 탭을 그대로 돌려주고 `fallback` 으로 알린다.
 */
export function filterStepTabs<T extends { type: string }>(
  tabs: readonly T[],
  steps: ReviewSteps,
): { tabs: readonly T[]; fallback: boolean } {
  const shown = tabs.filter(tab => {
    const key = stepTypeKey(tab.type);
    return key === null || steps[key];
  });
  return shown.length > 0 || tabs.length === 0
    ? { tabs: shown, fallback: false }
    : { tabs, fallback: true };
}

// 같은 탭 안의 구독자에게 알린다. 다른 탭에서 바꾼 값은 `storage` 이벤트로 받는다.
const stored = createStoredValue({
  key: REVIEW_STEPS_KEY,
  area: "local",
  parse: parseReviewSteps,
  serialize: value => JSON.stringify(value),
  notify: "tab+storage",
});

/** 단계 종류별로 보일지와 바꾸는 함수. 서버 렌더와 첫 화면은 기본값이다. */
export function useReviewSteps(): [
  ReviewSteps,
  (type: StepTypeKey, on: boolean) => void,
] {
  const steps = stored.useValue();
  const setStep = useCallback((type: StepTypeKey, on: boolean) => {
    stored.write({ ...stored.read(), [type]: on });
  }, []);
  return [steps, setStep];
}
