import { useCallback } from "react";
import { createStoredValue } from "@/lib/browser-storage";

/**
 * 설정 메뉴에서 켜고 끄는 검수 화면 부가 기능. 페이지 썸네일만 기본으로 켜고 나머지는 꺼 두며, 필요할
 * 때 켜서 쓴다. 끄면 그 기능의 버튼과 화면이 사라질 뿐 저장한 내용에는 영향이 없다.
 * - 페이지 편집 묶음
 *   - `pageTools`: 구성 탭 툴바의 페이지 편집 버튼(여기서 나누기, 앞 문서로, 뒤 문서로, 페이지 제외,
 *     페이지 옮기기)과 작업 패널의 "이 문서 제외", "새 문서로 분리"
 *   - `filmstrip`: 구성 탭의 페이지 썸네일 띠
 *   - `organizer`: 구성 탭의 페이지 정리 화면
 * - 고급 묶음
 *   - `jsonMenu`: 머리의 검수 결과 JSON 메뉴
 *   - `history`: 머리의 "변경 이력" 버튼과 결과 메뉴의 "이 결과의 변경 이력"
 */
export const REVIEW_FEATURES = [
  "pageTools",
  "filmstrip",
  "organizer",
  "jsonMenu",
  "history",
] as const;
export type ReviewFeature = (typeof REVIEW_FEATURES)[number];
export type ReviewFeatures = Record<ReviewFeature, boolean>;

/** 설정 메뉴에서 기능을 묶어 보이는 순서. */
export const REVIEW_FEATURE_GROUPS = [
  { id: "pageEditing", features: ["pageTools", "filmstrip", "organizer"] },
  { id: "advanced", features: ["jsonMenu", "history"] },
] as const satisfies readonly {
  id: string;
  features: readonly ReviewFeature[];
}[];

/** 켜고 끈 값을 기억하는 localStorage 키(JSON, 예: `{"organizer":true}`). 없는 기능은 기본값. */
export const REVIEW_FEATURES_KEY = "review-features";

export const REVIEW_FEATURE_DEFAULTS: ReviewFeatures = {
  pageTools: false,
  filmstrip: true,
  organizer: false,
  jsonMenu: false,
  history: false,
};

/** 저장된 글을 읽어 기본값에 덮는다. 읽을 수 없거나 모르는 값은 기본값으로 둔다. */
export function parseReviewFeatures(text: string | null): ReviewFeatures {
  const features = { ...REVIEW_FEATURE_DEFAULTS };
  if (!text) return features;
  try {
    const stored: unknown = JSON.parse(text);
    if (!stored || typeof stored !== "object") return features;
    for (const feature of REVIEW_FEATURES) {
      const value = (stored as Record<string, unknown>)[feature];
      if (typeof value === "boolean") features[feature] = value;
    }
  } catch {
    // 깨진 값은 무시하고 기본값을 쓴다.
  }
  return features;
}

// 같은 탭 안의 구독자에게 알린다. 다른 탭에서 바꾼 값은 `storage` 이벤트로 받는다.
const stored = createStoredValue({
  key: REVIEW_FEATURES_KEY,
  area: "local",
  parse: parseReviewFeatures,
  serialize: value => JSON.stringify(value),
  notify: "tab+storage",
});

/** 부가 기능의 켜짐 상태와 바꾸는 함수. 서버 렌더와 첫 화면은 기본값이다. */
export function useReviewFeatures(): [
  ReviewFeatures,
  (feature: ReviewFeature, on: boolean) => void,
] {
  const features = stored.useValue();
  const setFeature = useCallback((feature: ReviewFeature, on: boolean) => {
    stored.write({ ...stored.read(), [feature]: on });
  }, []);
  return [features, setFeature];
}

/** 부가 기능 하나가 켜져 있는지. */
export function useReviewFeature(feature: ReviewFeature): boolean {
  return useReviewFeatures()[0][feature];
}
