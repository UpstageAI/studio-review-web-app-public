import type { JobRevision, JobRevisionOperation } from "@/lib/review-api/types";

/** 같은 저장(작업)에서 나와 목록에 이어 붙은 행 묶음. */
export interface RevisionGroup {
  /** `${operation.id}:${첫 행 id}` — 같은 작업이 떨어져 두 번 나와도 겹치지 않는다. */
  readonly key: string;
  readonly operation: JobRevisionOperation;
  /** 첫 행의 반영 시각(Unix 초). */
  readonly publishedAt: number;
  readonly rows: readonly JobRevision[];
}

/** 연속한 같은 `operation.id` 행만 하나로 묶는다(순서 유지). */
export function groupByOperation(
  rows: readonly JobRevision[],
): RevisionGroup[] {
  const out: {
    key: string;
    operation: JobRevisionOperation;
    publishedAt: number;
    rows: JobRevision[];
  }[] = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && last.operation.id === row.operation.id) {
      last.rows.push(row);
      continue;
    }
    out.push({
      key: `${row.operation.id}:${row.id}`,
      operation: row.operation,
      publishedAt: row.published_at,
      rows: [row],
    });
  }
  return out;
}
