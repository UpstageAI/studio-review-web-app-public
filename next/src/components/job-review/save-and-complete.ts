import { isSaving, type SaveStatus } from "./job-review-state";

/** "저장하고 완료" 를 누른 뒤 기다리는 상태. */
export type PendingComplete = {
  /** 누른 Job 의 불러오기 키. 다른 Job 으로 바뀌면 버린다. */
  requestKey: string;
  /** 누를 때의 저장 상태 객체. 이것과 같으면 아직 저장이 시작되지 않았다. */
  from: SaveStatus;
};

/** 다음에 할 일: 더 기다리기, 검수 완료로 이어 가기, 멈추기(저장 상태 문구가 이유를 알린다). */
export type SaveAndCompleteStep = "wait" | "complete" | "stop";

/**
 * "저장하고 완료" 의 다음 단계. 저장이 모두 반영되고 다시 불러오기까지 끝나야 완료로 이어 간다.
 * 일부만 반영, 다시 불러오기 실패, 충돌, 실패, 검증 막힘, 변경 없음이면 멈춘다. 다른 Job 으로 옮겼으면
 * 멈춘다. 반영 뒤에도 세션 정리나 검수 상태 요청이 남아 있으면 끝날 때까지 기다린다.
 */
export function saveAndCompleteStep(
  pending: PendingComplete,
  current: {
    requestKey: string;
    save: SaveStatus;
    /** 남은 변경 항목 수 */
    changeCount: number;
    /** 검수 상태 요청이나 되돌리기 요청이 진행 중 */
    statusBusy: boolean;
  },
): SaveAndCompleteStep {
  if (pending.requestKey !== current.requestKey) return "stop";
  const save = current.save;
  if (save === pending.from || isSaving(save)) return "wait";
  if (save.phase === "saved" && !save.partial && save.reloadFailed === null) {
    return current.changeCount > 0 || current.statusBusy ? "wait" : "complete";
  }
  return "stop";
}
