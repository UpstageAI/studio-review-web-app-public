import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** 저장 상태 짧은 문구. 어떤 문구를 보일지는 호출자가 고른다. */
export interface ReviewActionsStatus {
  text: string;
  /** `error` 는 빨강, `muted` 는 흐리게, `ok` 는 기본 글자색. */
  tone: "muted" | "error" | "ok";
  /** 마우스를 올렸을 때 보일 보조 정보(예: 저장 버전 번호). */
  title?: string;
}

/** testid 를 붙이는 부위. */
// prettier-ignore
export type ReviewActionsPart =
  "status" | "tray" | "changeCount" | "save" | "primary";

/** 줄 끝 주 동작 버튼(예: 검수 완료·다시 열기). */
export interface ReviewActionsPrimary {
  /** 버튼 글자. 진행 중 문구도 호출자가 골라 넘긴다. */
  label: string;
  disabled: boolean;
  onClick: () => void;
  /** 없으면 `default`. */
  variant?: "default" | "outline";
  title?: string;
  /** `aria-keyshortcuts` 값. */
  keyShortcuts?: string;
  /** 이 버튼의 `data-testid`. `testIds.primary`·`testId` 접미보다 먼저 쓴다. */
  testId?: string;
  /**
   * 버튼에 붙일 `data-*` 속성(호출자의 DOM 관례 표식). `data-testid` 는 넣을 수 없다(`testId` 로
   * 넘긴다. 타입을 우회해 넣어도 내부 testid 가 이긴다).
   */
  buttonProps?: Record<`data-${string}`, string> & { "data-testid"?: never };
}

export interface ReviewActionsLabels {
  /** 변경 사항 버튼 글자 */
  tray: string;
  /** 저장 버튼 글자 */
  save: string;
  /** 저장 중일 때 저장 버튼 글자 */
  saving: string;
}

export interface ReviewActionsProps extends Omit<
  ComponentProps<"div">,
  "children"
> {
  /** 저장 상태 문구. 없어도 알림 영역(`aria-live`) 자리는 늘 그린다. */
  status?: ReviewActionsStatus | null;
  /** 상태 문구와 변경 사항 버튼 사이에 둘 호출자 UI(메뉴·버튼 등). */
  actions?: ReactNode;
  /** 저장하지 않은 변경 수. 0 보다 크면 변경 사항 버튼에 배지로 보인다. */
  changeCount: number;
  /** 변경 사항 창이 열려 있는지(`aria-expanded`). */
  trayOpen: boolean;
  onOpenTray: () => void;
  onSave: () => void;
  saveDisabled: boolean;
  saving: boolean;
  /** 저장 버튼을 강조(`default`)할지, 아니면 `outline`. */
  saveEmphasized: boolean;
  saveTitle?: string;
  /** 저장 버튼의 `aria-keyshortcuts` 값. */
  saveKeyShortcuts?: string;
  /** 저장 버튼의 `aria-describedby`(예: 저장할 수 없는 이유 안내의 id). */
  saveDescribedBy?: string;
  primary: ReviewActionsPrimary;
  labels: ReviewActionsLabels;
  /** 루트 `data-testid`. 하위는 `-status`·`-button-tray`·`-change-count`·`-button-save`·`-button-primary`. */
  testId?: string;
  /** 부위별 `data-testid` 덮어쓰기(접미 규칙보다 먼저 쓴다). */
  testIds?: Partial<Record<ReviewActionsPart, string>>;
}

const SUFFIX: Record<ReviewActionsPart, string> = {
  status: "status",
  tray: "button-tray",
  changeCount: "change-count",
  save: "button-save",
  primary: "button-primary",
};

/**
 * 검수 화면의 저장·완료 버튼 줄: 저장 상태 문구, 호출자 slot, 변경 사항 버튼(변경 수 배지), 저장,
 * 주 동작. 버튼 줄만 그린다 — 단축키, 저장 가능 판정, 저장 뒤 완료로 이어 가기는 호출자가 한다.
 */
export function ReviewActions({
  status,
  actions,
  changeCount,
  trayOpen,
  onOpenTray,
  onSave,
  saveDisabled,
  saving,
  saveEmphasized,
  saveTitle,
  saveKeyShortcuts,
  saveDescribedBy,
  primary,
  labels,
  testId,
  testIds,
  className,
  ...props
}: ReviewActionsProps) {
  const sub = (part: ReviewActionsPart) =>
    testIds?.[part] ?? (testId ? `${testId}-${SUFFIX[part]}` : undefined);

  return (
    <div
      {...props}
      className={cn("flex flex-wrap items-center gap-2", className)}
      data-testid={testId}
    >
      <span
        aria-live="polite"
        className="text-xs whitespace-nowrap empty:hidden"
        data-testid={sub("status")}
      >
        {status ? (
          <span
            className={cn(
              status.tone === "error" && "text-destructive",
              status.tone === "muted" && "text-muted-foreground",
            )}
            title={status.title}
          >
            {status.text}
          </span>
        ) : null}
      </span>
      {actions}
      <Button
        type="button"
        variant="outline"
        size="default"
        aria-haspopup="dialog"
        aria-expanded={trayOpen}
        onClick={onOpenTray}
        data-testid={sub("tray")}
      >
        {labels.tray}
        {changeCount > 0 ? (
          <Badge data-testid={sub("changeCount")}>{changeCount}</Badge>
        ) : null}
      </Button>
      <Button
        type="button"
        size="default"
        variant={saveEmphasized ? "default" : "outline"}
        disabled={saveDisabled}
        aria-describedby={saveDescribedBy}
        aria-keyshortcuts={saveKeyShortcuts}
        title={saveTitle}
        onClick={onSave}
        data-testid={sub("save")}
      >
        {saving ? labels.saving : labels.save}
      </Button>
      <Button
        type="button"
        size="default"
        variant={primary.variant}
        disabled={primary.disabled}
        aria-keyshortcuts={primary.keyShortcuts}
        title={primary.title}
        onClick={primary.onClick}
        {...primary.buttonProps}
        data-testid={primary.testId ?? sub("primary")}
      >
        {primary.label}
      </Button>
    </div>
  );
}
