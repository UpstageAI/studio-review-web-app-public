import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Validate 판정. */
export type Verdict = "green" | "yellow" | "red";

/** 원본 판정 근거 한 줄. */
export interface VerdictCheck {
  name?: string;
  severity?: string;
  passed?: boolean;
  reason?: string;
}

export interface VerdictSegmentLabels {
  /** 세그먼트 묶음의 접근성 이름 */
  group: string;
  /** 칸 문구 */
  verdicts: Record<Verdict, string>;
  /** 근거 목록 제목 */
  checks: string;
  /** 통과·실패 표시의 접근성 이름 */
  passed: string;
  failed: string;
}

export interface VerdictSegmentProps extends Omit<
  ComponentProps<"div">,
  "onChange"
> {
  /** 현재 판정. 세 값 밖이면 `null`(아무 칸도 고르지 않은 상태). */
  value: Verdict | null;
  /** 다른 칸을 고를 때. 이미 고른 칸을 다시 누르면 부르지 않는다. */
  onValueChange: (value: Verdict) => void;
  disabled?: boolean;
  /** 원본 판정 근거. 없으면 목록을 그리지 않는다. */
  checks?: readonly VerdictCheck[] | null;
  labels: VerdictSegmentLabels;
  /** 세그먼트 아래 안내(예: 판정을 고치면 근거가 사라진다는 것). */
  notice?: ReactNode;
  /**
   * 세 칸 버튼에 각각 붙일 `data-*` 속성(예: host 의 다음 입력 칸 찾기 표식). 내부가 쓰는
   * `data-verdict` 는 덮지 못하고, `data-testid` 는 넣을 수 없다(타입을 우회해 넣어도 내부
   * testid 가 이긴다).
   */
  buttonProps?: VerdictButtonProps;
  /** 루트 `data-testid`. 칸 버튼은 `<testId>-button-<값>`, 근거 줄은 `<testId>-reason`. */
  testId?: string;
}

/** 칸 버튼에 붙일 `data-*` 속성. `data-testid` 는 넣을 수 없다. */
type VerdictButtonProps = Record<`data-${string}`, string> & {
  "data-testid"?: never;
};

const VERDICTS: readonly Verdict[] = ["green", "yellow", "red"];

/**
 * Validate 판정 세 칸(green·yellow·red)과 원본 판정 근거 목록. 칸은 라디오 묶음처럼
 * 동작해서 좌우 방향키로 옮겨 고를 수 있다.
 */
export function VerdictSegment({
  value,
  onValueChange,
  disabled = false,
  checks,
  labels,
  notice,
  buttonProps,
  testId,
  className,
  ...props
}: VerdictSegmentProps) {
  const focusIndex = value === null ? 0 : VERDICTS.indexOf(value);
  const extraButtonProps = withoutVerdict(buttonProps);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0 || disabled) return;
    event.preventDefault();
    const current = VERDICTS.indexOf(
      (event.currentTarget.dataset.verdict ?? "green") as Verdict,
    );
    const next = VERDICTS[(current + step + VERDICTS.length) % VERDICTS.length];
    if (!next) return;
    onValueChange(next);
    const sibling =
      event.currentTarget.parentElement?.querySelector<HTMLElement>(
        `[data-verdict="${next}"]`,
      );
    sibling?.focus();
  };

  return (
    <div
      {...props}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <div
        role="radiogroup"
        aria-label={labels.group}
        aria-disabled={disabled || undefined}
        className="inline-flex w-fit rounded-lg border border-border p-0.5"
      >
        {VERDICTS.map((verdict, index) => {
          const checked = verdict === value;
          return (
            <button
              key={verdict}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === focusIndex ? 0 : -1}
              disabled={disabled}
              data-verdict={verdict}
              {...extraButtonProps}
              onClick={() => {
                if (!checked) onValueChange(verdict);
              }}
              onKeyDown={onKeyDown}
              data-testid={testId ? `${testId}-button-${verdict}` : undefined}
              className={cn(
                "cursor-pointer rounded-md px-3 py-1 text-sm transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none",
                checked
                  ? verdict === "red"
                    ? "bg-destructive text-background"
                    : "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {labels.verdicts[verdict]}
            </button>
          );
        })}
      </div>
      {notice ? (
        <p className="text-xs text-muted-foreground">{notice}</p>
      ) : null}
      {checks && checks.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-muted-foreground">
            {labels.checks}
          </p>
          <ul className="flex flex-col gap-1 text-xs">
            {checks.map((check, index) => (
              <li
                key={`${check.name ?? ""}-${index}`}
                data-testid={testId ? `${testId}-reason` : undefined}
                className="flex min-w-0 gap-2"
              >
                <span
                  role="img"
                  aria-label={check.passed ? labels.passed : labels.failed}
                  className={cn(
                    "shrink-0 font-medium",
                    check.passed ? "text-foreground" : "text-destructive",
                  )}
                >
                  {check.passed ? "✓" : "✗"}
                </span>
                <span className="min-w-0 break-words">
                  {[check.name, check.severity, check.reason]
                    .filter(part => typeof part === "string" && part !== "")
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** `buttonProps` 에서 내부가 쓰는 `data-verdict` 를 뺀다(칸 이동이 이 값을 읽는다). */
function withoutVerdict(
  buttonProps: VerdictButtonProps | undefined,
): VerdictButtonProps | undefined {
  if (!buttonProps || !("data-verdict" in buttonProps)) return buttonProps;
  const rest = { ...buttonProps };
  delete rest["data-verdict"];
  return rest;
}
