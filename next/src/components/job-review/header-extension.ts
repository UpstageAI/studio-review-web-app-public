import type { ReactNode } from "react";

/** 검수 화면 머리가 확장 hook 에 넘기는 그 렌더의 값. */
export interface JobReviewHeaderExtensionInput {
  collectionId: string;
  /** Collection 이름(아직 모르면 null). */
  collectionName: string | null;
  jobId: string;
  /** 첫 파일 이름(없으면 null). */
  firstFileName: string | null;
  /** Job 을 다 불러왔다(`state.status === "ready"`). */
  ready: boolean;
  /** 저장하지 않은 변경이 있거나 저장 중이다. */
  dirty: boolean;
  /** 떠날지 물을 때 보일 문구. */
  leaveMessage: string;
}

/** 확장 hook 이 머리에 돌려주는 것. */
export interface JobReviewHeaderExtension {
  /** 머리 맨 앞에 그릴 것(예: 공통 상단 바로 옮겨 그리는 내용). 없으면 null. */
  extras: ReactNode;
  /** true 면 주 동작 문구가 "…하고 다음" 이 된다. */
  advancesAfterComplete: boolean;
  /** 검수 완료가 성공한 직후에 부른다. `jobName` 은 첫 파일 이름, 없으면 Job ID. */
  onCompleted: (jobName: string) => Promise<void> | void;
}

/**
 * 검수 화면 머리에 화면 밖 기능(검수 큐, 최근 기록, 완료 안내 등)을 꽂는 hook. 머리가 렌더마다 한 번
 * 부르므로 hook 규칙을 따르며, 마운트된 동안 같은 함수여야 한다.
 */
export type UseJobReviewHeaderExtension = (
  input: JobReviewHeaderExtensionInput,
) => JobReviewHeaderExtension;

const NO_HEADER_EXTENSION: JobReviewHeaderExtension = {
  extras: null,
  advancesAfterComplete: false,
  onCompleted: () => {},
};

/** 확장이 없을 때의 기본값: 더 그리는 것도, 완료 뒤 하는 일도 없다. */
export const useNoHeaderExtension: UseJobReviewHeaderExtension = () =>
  NO_HEADER_EXTENSION;
