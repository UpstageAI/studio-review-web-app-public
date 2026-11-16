import type { SaveStatus } from "./job-review-state";

/** 저장 버튼을 켤지 정하는 재료. 버튼마다 필요한 것만 골라 조합한다. */
export type SaveReadiness = {
  /** 저장할 변경 항목이 있다. */
  hasChanges: boolean;
  /** 저장이 진행 중이다(올리기·반영 대기·다시 불러오기). */
  saving: boolean;
  /** 충돌을 받았다. 다시 불러올 때까지 다시 저장해도 같은 충돌이 난다. */
  conflicted: boolean;
  /** 저장을 막는 검증 문제가 있다. 받지 않았으면 `false`. */
  blocking: boolean;
};

/**
 * 저장 가능 판정의 재료를 한 곳에서 만든다. 결과를 하나로 합치지 않고 부품으로 돌려준다.
 *
 * 헤더는 `blocking` 을 보지 않는다 — 차단 문제가 있을 때 저장을 누르면 트레이가 열려 이유를 보여 준다.
 * 트레이는 `blocking` 을 본다.
 */
export function saveReadiness(input: {
  /** 변경 항목 수 */
  changeCount: number;
  save: SaveStatus;
  /** 화면이 쓰는 저장 중 값(`isSaving(save)`). */
  saving: boolean;
  blocking?: boolean;
}): SaveReadiness {
  return {
    hasChanges: input.changeCount > 0,
    saving: input.saving,
    conflicted: input.save.phase === "conflict",
    blocking: input.blocking ?? false,
  };
}
