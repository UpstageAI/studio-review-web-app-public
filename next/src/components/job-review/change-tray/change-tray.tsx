import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 변경 항목 하나(사람 말 문구). */
export interface ChangeTrayItem {
  id: string;
  text: string;
  /** 다른 검수와 충돌했거나 서버가 거부한 항목. 빨갛게 표시한다. */
  conflict?: boolean;
  /** 항목 문구 아래 작은 보조 줄(예: 어디서 불러온 변경인지). */
  readonly note?: string;
}

/** 같은 문서의 변경 묶음. */
export interface ChangeTrayGroup {
  id: string;
  documentLabel: string;
  items: ChangeTrayItem[];
}

/** 저장 전 검증 요약 한 줄. */
export interface ChangeTraySummaryItem {
  id: string;
  label: string;
  ok: boolean;
  /** 보조 설명(크기·한도 등). */
  detail?: string;
}

/** 트레이 위쪽 상태 영역(저장 진행·결과·안내). */
export interface ChangeTrayStatus {
  kind: "info" | "success" | "error";
  text: string;
  /** 보조 설명(가져오기 id 등). */
  detail?: string;
  action?: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    testId?: string;
  };
}

export interface ChangeTrayLabels {
  /** 변경 목록 제목(예: "변경 사항") */
  changes: string;
  /** 항목 되돌리기 버튼 문구 */
  revert: string;
  /** 항목 되돌리기 버튼의 접근 가능한 이름 */
  revertItem: (text: string) => string;
  /** 충돌 항목 표시(예: "충돌") */
  conflict: string;
  /** 검증 요약 제목(예: "저장 전 검증") */
  summary: string;
  /** 통과·문제 표시의 화면 낭독용 문구 */
  passed: string;
  failed: string;
  /** 변경이 없을 때 제목(예: "아직 바뀐 것이 없습니다") */
  emptyTitle: string;
}

export interface ChangeTrayProps extends Omit<
  ComponentProps<"div">,
  "children"
> {
  groups: ChangeTrayGroup[];
  onRevert: (id: string) => void;
  /** 저장 중 등 되돌리기를 막을 때. */
  revertDisabled?: boolean;
  summary: ChangeTraySummaryItem[];
  status?: ChangeTrayStatus | null;
  /** 변경이 없을 때 보일 "이 화면에서 할 수 있는 것" 줄들. */
  emptyHint: string[];
  /** 목록 아래 접는 영역(업로드 본문 보기 등). */
  advanced?: ReactNode;
  labels: ChangeTrayLabels;
  /** 루트 `data-testid`. 하위 요소는 `<testId>-item`·`<testId>-button-revert` 등. */
  testId?: string;
}

// 테두리 두께(`border`)와 색을 같은 문자열에 둔다. 상태 종류마다 완성된 클래스 문자열이다.
const STATUS_CLASS = {
  info: "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm border-border bg-muted/50 text-foreground",
  success:
    "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm border-primary/40 bg-primary/10 text-foreground",
  error:
    "flex min-w-0 flex-col gap-2 rounded-md border px-3 py-2 text-sm border-destructive/50 bg-destructive/10 text-destructive",
} as const;

/**
 * 변경 사항 트레이 본문: 상태 영역, 문서별로 묶은 변경 항목(항목마다 되돌리기), 저장 전 검증
 * 요약, 고급 영역. 열고 닫는 틀(시트·패널)과 모든 문구는 host 가 정한다.
 */
export function ChangeTray({
  groups,
  onRevert,
  revertDisabled = false,
  summary,
  status,
  emptyHint,
  advanced,
  labels,
  testId,
  className,
  ...props
}: ChangeTrayProps) {
  const empty = groups.every(group => group.items.length === 0);
  const sub = (name: string) => (testId ? `${testId}-${name}` : undefined);

  return (
    <div
      {...props}
      className={cn("flex min-w-0 flex-col gap-4", className)}
      data-testid={testId}
    >
      <div className="empty:hidden">
        {status ? (
          <div
            role={status.kind === "error" ? "alert" : "status"}
            className={STATUS_CLASS[status.kind]}
            data-status={status.kind}
            data-testid={sub("status")}
          >
            <p className="break-words">{status.text}</p>
            {status.detail ? (
              <p className="font-mono text-xs break-all text-muted-foreground">
                {status.detail}
              </p>
            ) : null}
            {status.action ? (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={status.action.disabled}
                  onClick={status.action.onClick}
                  data-testid={status.action.testId}
                  className="cursor-pointer"
                >
                  {status.action.label}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <section className="flex min-w-0 flex-col gap-3">
        <h3 className="text-xs font-medium text-muted-foreground">
          {labels.changes}
        </h3>
        {empty ? (
          <div className="flex flex-col gap-2" data-testid={sub("empty")}>
            <p className="text-sm font-medium">{labels.emptyTitle}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              {emptyHint.map(line => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : (
          groups
            .filter(group => group.items.length > 0)
            .map(group => (
              <div key={group.id} className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-medium break-words">
                  {group.documentLabel}
                </p>
                <ul className="flex min-w-0 flex-col gap-1">
                  {group.items.map(item => (
                    <li
                      key={item.id}
                      data-conflict={item.conflict ? "true" : undefined}
                      data-testid={sub("item")}
                      className={cn(
                        "flex min-w-0 items-start justify-between gap-2 rounded-md border-l-2 py-1 pr-1 pl-2 text-sm",
                        item.conflict
                          ? "border-l-destructive bg-destructive/10"
                          : "border-l-primary",
                      )}
                    >
                      <span className="min-w-0 break-words">
                        {item.conflict ? (
                          <span className="mr-1 text-xs font-medium text-destructive">
                            {labels.conflict}
                          </span>
                        ) : null}
                        {item.text}
                        {item.note ? (
                          <span className="block text-xs text-muted-foreground">
                            {item.note}
                          </span>
                        ) : null}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={revertDisabled}
                        aria-label={labels.revertItem(item.text)}
                        onClick={() => onRevert(item.id)}
                        data-testid={sub("button-revert")}
                        className="shrink-0 cursor-pointer"
                      >
                        <span aria-hidden="true">↺</span> {labels.revert}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
        )}
      </section>

      <section
        className="flex min-w-0 flex-col gap-1.5"
        data-testid={sub("summary")}
      >
        <h3 className="text-xs font-medium text-muted-foreground">
          {labels.summary}
        </h3>
        <ul className="flex min-w-0 flex-col gap-1 text-sm">
          {summary.map(item => (
            <li
              key={item.id}
              data-ok={item.ok ? "true" : "false"}
              className={cn(
                "flex min-w-0 items-baseline gap-2",
                item.ok ? "text-foreground" : "text-destructive",
              )}
            >
              <span aria-hidden="true" className="shrink-0">
                {item.ok ? "✓" : "✗"}
              </span>
              <span className="sr-only">
                {item.ok ? labels.passed : labels.failed}
              </span>
              <span className="min-w-0 break-words">
                {item.label}
                {item.detail ? (
                  <span className="ml-1 text-xs text-muted-foreground">
                    {item.detail}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {advanced}
    </div>
  );
}
