"use client";

import { createContext, useContext } from "react";
import type {
  ReviewFeature,
  ReviewFeatures,
} from "@/lib/review-policy/review-features";
import type { ReviewSteps } from "@/lib/review-policy/review-steps";

/**
 * 검수 화면이 받는 정책: 설정 메뉴에서 켜고 끄는 부가 기능과 검수할 단계 종류.
 * 값의 원천은 `@/lib/review-policy` 의 store(브라우저 저장소 + 구독)이고, `ReviewPolicyProvider` 는 그
 * 값을 화면 아래로 내려 주기만 한다. 그래서 Context 밖(설정 메뉴)이나 다른 탭에서 바꿔도 곧바로 반영된다.
 */
export interface ReviewPolicy {
  features: ReviewFeatures;
  /** 같은 store 에 쓴다(설정 메뉴의 체크박스에도 반영된다). */
  setFeature: (feature: ReviewFeature, on: boolean) => void;
  steps: ReviewSteps;
}

export const ReviewPolicyContext = createContext<ReviewPolicy | null>(null);

/** 검수 화면 정책(`ReviewPolicyProvider` 안에서). */
export function useReviewPolicy(): ReviewPolicy {
  const value = useContext(ReviewPolicyContext);
  if (!value) {
    throw new Error("useReviewPolicy 는 ReviewPolicyProvider 안에서 쓴다");
  }
  return value;
}
