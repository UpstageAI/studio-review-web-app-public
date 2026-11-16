/** Upstage API 오류 응답 본문. 분기는 `code` 로 한다. */
export interface UpstageErrorEnvelope {
  error: {
    code: string;
    type?: string;
    message?: string;
    param?: string | null;
    details?: unknown;
  };
}

/** 검수 가져오기 반영 방식. `auto` 는 업로드 즉시 반영, `manual` 은 별도 apply 호출로 반영한다. */
export type ReviewApplyMode = "auto" | "manual";
