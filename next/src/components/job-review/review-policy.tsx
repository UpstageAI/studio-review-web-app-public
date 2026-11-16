"use client";

import { useMemo, type ReactNode } from "react";
import { useReviewFeatures } from "@/lib/review-policy/review-features";
import { useReviewSteps } from "@/lib/review-policy/review-steps";
import { ReviewPolicyContext } from "./review-policy-context";

/** 정책 store 를 구독해 검수 화면 아래로 내린다(값은 스냅샷이 아니라 store 의 현재 값). */
export function ReviewPolicyProvider({ children }: { children: ReactNode }) {
  const [features, setFeature] = useReviewFeatures();
  const [steps] = useReviewSteps();
  // 무관한 부모 렌더에 소비자가 따라 그리지 않게 값 객체를 묶는다.
  const value = useMemo(
    () => ({ features, setFeature, steps }),
    [features, setFeature, steps],
  );
  return (
    <ReviewPolicyContext.Provider value={value}>
      {children}
    </ReviewPolicyContext.Provider>
  );
}
