"use client";

import { useCallback, useMemo } from "react";
import { results as jobResults, type HighlightLike } from "@/lib/review-model";
import {
  REVIEW_FIELDS_KEY,
  fieldHighlightFilter,
  parseFieldChoices,
  withStepFields,
  type FieldChoices,
} from "./field-filter";
import { useJobReview } from "./job-review-context";
import { createStoredValue } from "@/lib/browser-storage";

// 같은 탭 안의 구독자에게 알린다. 다른 탭에서 바꾼 값은 `storage` 이벤트로 받는다.
const stored = createStoredValue({
  key: REVIEW_FIELDS_KEY,
  area: "local",
  parse: parseFieldChoices,
  serialize: value => JSON.stringify(value),
  notify: "tab+storage",
});

/**
 * Step 별로 고른 보이는 필드와 바꾸는 함수(`null` 이면 그 Step 의 필드를 모두 보인다). 바꾸면 같은 탭의
 * 값 패널과 뷰어, 다른 탭에 바로 반영된다. 서버 렌더와 첫 화면은 고른 것 없음(모두 보임)이다.
 */
export function useFieldChoices(): [
  FieldChoices,
  (stepId: string, visible: readonly string[] | null) => void,
] {
  const choices = stored.useValue();
  const setStepFields = useCallback(
    (stepId: string, visible: readonly string[] | null) => {
      stored.write(withStepFields(stored.read(), stepId, visible));
    },
    [],
  );
  return [choices, setStepFields];
}

/**
 * 뷰어에 넘길 하이라이트에서 값 패널이 숨긴 필드의 추출값을 뺀다. 숨긴 행의 영역을 가리키거나 골라도
 * 패널에 갈 행이 없으므로 뷰어에도 그리지 않는다. 고른 필드가 없으면 받은 배열을 그대로 돌려준다.
 */
export function useFieldFilteredHighlights<T extends HighlightLike>(
  highlights: T[],
): T[] {
  const { job, state } = useJobReview();
  const [choices] = useFieldChoices();
  const steps = state.session?.current.steps;
  const keep = useMemo(
    () => (job ? fieldHighlightFilter(jobResults(job), steps, choices) : null),
    [job, steps, choices],
  );
  return useMemo(() => {
    if (!keep) return highlights;
    const kept = highlights.filter(keep);
    return kept.length === highlights.length ? highlights : kept;
  }, [highlights, keep]);
}
