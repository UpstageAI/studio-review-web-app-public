import {
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PAGE_STEP,
  indexAtRatio,
  mergeMarks,
  parsePageInput,
  ratioOfIndex,
  stepIndex,
  type PageMark,
  type PageMarkKind,
} from "./position";

export interface PagePositionBarLabels {
  /** 전체 묶음의 접근성 이름 */
  label: string;
  /** 이전·다음 페이지 버튼 */
  previous: string;
  next: string;
  /** 숫자 입력의 접근성 이름 */
  pageInput: string;
  /** 전체 쪽수 표기(예: n => `/ ${n}`) */
  pageCount: (count: number) => string;
  /** 트랙(slider)의 접근성 이름 */
  track: string;
  /** 트랙이 읽어 주는 현재 값(예: `(page, total) => `${total}쪽 중 ${page}쪽``) */
  valueText: (page: number, total: number) => string;
  /** 표식 구간의 설명 */
  marks: Record<PageMarkKind, string>;
}

export interface PagePositionBarProps extends Omit<
  ComponentProps<"div">,
  "onChange" | "children"
> {
  /** 현재 뷰어 위치(0-based). */
  index: number;
  /** 페이지 수. */
  count: number;
  /** 트랙에 표시할 페이지(바뀐 값 · 검증 문제 · 이미지 없음). */
  marks?: readonly PageMark[];
  /** PageUp·PageDown 한 번에 옮기는 쪽수. 기본 10. */
  pageStep?: number;
  disabled?: boolean;
  onIndexChange: (index: number) => void;
  labels: PagePositionBarLabels;
  /**
   * 루트 `data-testid`. 하위 요소는 `<testId>-button-previous`·`<testId>-button-next`·
   * `<testId>-input-page`·`<testId>-slider-track`·`<testId>-mark-{changed|issue|no-image}`.
   */
  testId?: string;
}

const MARK_CLASS: Record<PageMarkKind, string> = {
  noImage: "bg-muted-foreground/40",
  issue: "bg-destructive",
  changed: "bg-primary",
};

const MARK_TEST_SUFFIX: Record<PageMarkKind, string> = {
  noImage: "no-image",
  issue: "issue",
  changed: "changed",
};

const tid = (testId: string | undefined, suffix: string) =>
  testId ? `${testId}-${suffix}` : undefined;

/**
 * 쪽수가 많은 문서의 페이지 위치 바(제어형): ◀ ▶ 한 쪽 이동(끝에서는 `aria-disabled`), 숫자 입력으로 바로 가기, 트랙을
 * 눌러·끌어·키보드로 옮기기. 트랙에는 바뀐 값·검증 문제·이미지 없는 페이지를 구간으로 표시한다.
 * 문구는 `labels`, 이동은 `onIndexChange` 로 host 가 맡는다.
 */
export function PagePositionBar({
  index,
  count,
  marks = [],
  pageStep = DEFAULT_PAGE_STEP,
  disabled = false,
  onIndexChange,
  labels,
  testId,
  className,
  ...props
}: PagePositionBarProps) {
  const safeCount = Math.max(count, 0);
  const current = Math.min(Math.max(index, 0), Math.max(safeCount - 1, 0));
  const go = (next: number) => {
    if (disabled || next === current) return;
    onIndexChange(next);
  };
  // 끝에 닿은 ◀·▶ 는 disabled 대신 aria-disabled 로 막는다. disabled 로 바뀌면 누르던 버튼이
  // 포커스를 잃어 키보드 사용자가 body 로 떨어진다(바 전체 비활성은 그대로 disabled).
  const atStart = current <= 0;
  const atEnd = current >= safeCount - 1;

  return (
    <div
      {...props}
      role="group"
      aria-label={labels.label}
      data-testid={testId}
      className={cn("flex min-w-0 items-center gap-2", className)}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={labels.previous}
        title={labels.previous}
        disabled={disabled}
        aria-disabled={atStart || undefined}
        onClick={() => {
          if (atStart) return;
          go(current - 1);
        }}
        data-testid={tid(testId, "button-previous")}
        className={atStart ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
      >
        <span aria-hidden="true">◀</span>
      </Button>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
        <PageInput
          index={current}
          count={safeCount}
          disabled={disabled}
          label={labels.pageInput}
          onCommit={go}
          testId={tid(testId, "input-page")}
        />
        <span>{labels.pageCount(safeCount)}</span>
      </div>
      <Track
        index={current}
        count={safeCount}
        marks={marks}
        pageStep={pageStep}
        disabled={disabled}
        labels={labels}
        onChange={go}
        testId={testId}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={labels.next}
        title={labels.next}
        disabled={disabled}
        aria-disabled={atEnd || undefined}
        onClick={() => {
          if (atEnd) return;
          go(current + 1);
        }}
        data-testid={tid(testId, "button-next")}
        className={atEnd ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
      >
        <span aria-hidden="true">▶</span>
      </Button>
    </div>
  );
}

/**
 * 숫자 입력. Enter 로 확정하고 Esc·blur 는 현재 위치로 되돌린다. 편집 중인 글자는 그때의 위치에
 * 묶어 두어, 위치가 바뀌면(확정·다른 조작) 새 위치가 보이고 포커스는 입력에 남는다.
 */
function PageInput({
  index,
  count,
  disabled,
  label,
  onCommit,
  testId,
}: {
  index: number;
  count: number;
  disabled: boolean;
  label: string;
  onCommit: (index: number) => void;
  testId?: string;
}) {
  const shown = count > 0 ? String(index + 1) : "";
  const [draft, setDraft] = useState<{ index: number; text: string } | null>(
    null,
  );
  const text = draft !== null && draft.index === index ? draft.text : shown;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const next = parsePageInput(text, count);
      setDraft(null);
      if (next !== null) onCommit(next);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={label}
      value={text}
      disabled={disabled || count === 0}
      onChange={event => setDraft({ index, text: event.target.value })}
      onKeyDown={onKeyDown}
      onBlur={() => setDraft(null)}
      data-testid={testId}
      className="h-7 w-14 px-1.5 text-center text-xs tabular-nums md:text-xs"
    />
  );
}

/** 트랙(slider): 누르거나 끌면 그 자리 페이지로, 키보드는 `stepIndex` 규칙으로 옮긴다. */
function Track({
  index,
  count,
  marks,
  pageStep,
  disabled,
  labels,
  onChange,
  testId,
}: {
  index: number;
  count: number;
  marks: readonly PageMark[];
  pageStep: number;
  disabled: boolean;
  labels: PagePositionBarLabels;
  onChange: (index: number) => void;
  testId?: string;
}) {
  const dragging = useRef(false);
  const segments = mergeMarks(marks, count);
  const ratio = ratioOfIndex(index, count);

  const indexAt = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return index;
    return indexAtRatio((event.clientX - rect.left) / rect.width, count);
  };
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || count === 0 || event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(indexAt(event));
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onChange(indexAt(event));
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // 수식어 키 조합(Alt+↑/↓ 등)은 바깥(문서 이동)에 맡긴다.
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const next = stepIndex(index, count, event.key, pageStep);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={labels.track}
      aria-orientation="horizontal"
      aria-valuemin={1}
      aria-valuemax={Math.max(count, 1)}
      aria-valuenow={count > 0 ? index + 1 : 1}
      aria-valuetext={labels.valueText(count > 0 ? index + 1 : 0, count)}
      aria-disabled={disabled || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
      data-testid={tid(testId, "slider-track")}
      className={cn(
        "relative h-6 min-w-0 flex-1 touch-none rounded-md bg-muted select-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
      )}
    >
      {segments.map(segment => (
        <span
          key={`${segment.kind}:${segment.start}`}
          title={labels.marks[segment.kind]}
          data-testid={tid(testId, `mark-${MARK_TEST_SUFFIX[segment.kind]}`)}
          className={cn(
            "absolute inset-y-2 rounded-md",
            MARK_CLASS[segment.kind],
          )}
          style={{
            left: `${(segment.start / count) * 100}%`,
            width: `${((segment.end - segment.start + 1) / count) * 100}%`,
          }}
        />
      ))}
      {count > 0 ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 h-5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-md border border-background bg-foreground"
          style={{ left: `${ratio * 100}%` }}
        />
      ) : null}
    </div>
  );
}
