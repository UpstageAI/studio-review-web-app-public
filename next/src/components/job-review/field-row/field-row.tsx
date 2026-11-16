import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { InfoIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FieldRowLabels {
  /** 원래 값으로 되돌리는 버튼 */
  revert: string;
  /** 원본 값 앞 머리말(예: "원본 값") */
  machine: string;
  /** 키 칩에 마우스를 올렸을 때 보이는 문구(예: "스키마 키: invoice_date"). 없으면 키 그대로. */
  keyTitle?: (key: string) => string;
  /** 도움말에 마우스를 올렸을 때 보이는 문구(예: "스키마 설명: …"). 없으면 도움말 그대로. */
  descriptionTitle?: (description: string) => string;
}

export interface FieldRowProps extends Omit<
  ComponentProps<"div">,
  "children" | "title" | "onSelect"
> {
  /** 필드 이름(schema `title` 등). */
  title: string;
  /**
   * schema 의 키. 있으면 고정폭 글씨 칩으로 보여 "키" 임을 드러낸다. 이름(`title`)이 키와 같으면 칩만,
   * 다르면 이름 옆에 칩을 둔다.
   */
  fieldKey?: string;
  /** 도움말(schema `description`). 기본 한 줄로 줄여 보이고, 입력 위젯에 포커스가 있으면 모두 보인다. */
  description?: string | null;
  /**
   * 도움말 글(`<span>`)의 id. 입력의 `aria-describedby` 에 넣으면 화면에서 한 줄로 줄어 있어도 전체
   * 문구를 읽는다.
   */
  descriptionId?: string;
  /** 이름 `<label>` 이 가리킬 입력 id. */
  labelFor?: string;
  /** 결과 `content` 안 JSON Pointer. 있으면 DOM 에 `data-pointer` 로 남긴다. */
  pointer?: string;
  /** 입력 위젯(host 가 넣는다). */
  children: ReactNode;
  /** 원본 값 표시 문자열. 없으면 줄을 그리지 않는다(바뀐 행에만 넘기면 바뀐 행에만 보인다). */
  machineValue?: string;
  /** 현재 값이 원본 값과 다르다. 왼쪽 강조 띠와 되돌리기가 보인다. */
  changed: boolean;
  onRevert?: () => void;
  /** 뷰어에서 이 필드의 위치가 선택돼 있다. */
  selected: boolean;
  /** 행 안으로 포커스가 들어올 때(입력을 누르면) — 원본 위치로 이동. */
  onSelect?: () => void;
  /** 행 위에 포인터가 올라오고 나갈 때. */
  onHoverChange?: (hovering: boolean) => void;
  /** 편집할 수 없는 행(흐리게). 사유는 `chip` 으로 넘긴다. */
  locked?: boolean;
  /** 상태 칩(바뀜 등). */
  chip?: ReactNode;
  /** 이름 줄 끝에 두는 행 조작(메뉴 버튼 등). host 가 넣는다. */
  actions?: ReactNode;
  /** 입력 오류 문구. */
  error?: string | null;
  /** 오류 `<p>` 의 id — 입력의 `aria-describedby` 가 가리킨다. */
  errorId?: string;
  labels: FieldRowLabels;
  /** 루트 `data-testid`. 버튼은 `<testId>-button-revert`. */
  testId?: string;
}

/**
 * 값 필드 한 행: 이름·도움말·입력 위젯·원본 값·되돌리기·행 조작 slot. 바뀐 행은 왼쪽에 강조 띠를
 * 두고, 뷰어에서 고른 행은 배경을 깐다. 긴 도움말은 한 줄로 줄여 두고(마우스를 올리면 `title` 로
 * 전체), 행의 입력 위젯(입력칸, 선택, 스위치)에 포커스가 있을 때만 펼친다. 행 메뉴(⋮)를 열고 닫아 포커스가
 * 메뉴 버튼으로 돌아와도 펼치지 않는다. 입력에 포커스가 들어오면 `onSelect`, 행을 가리키면
 * `onHoverChange` 로 알려 host 가 뷰어의 원본 위치를 보인다. 입력 위젯과 문구는 모두 host 가 넘긴다.
 */
export function FieldRow({
  title,
  fieldKey,
  description,
  descriptionId,
  labelFor,
  pointer,
  children,
  machineValue,
  changed,
  onRevert,
  selected,
  onSelect,
  onHoverChange,
  locked = false,
  chip,
  actions,
  error,
  errorId,
  labels,
  testId,
  className,
  onFocusCapture,
  onPointerEnter,
  onPointerLeave,
  ...props
}: FieldRowProps) {
  return (
    <div
      {...props}
      data-pointer={pointer}
      data-selected={selected ? "true" : undefined}
      data-testid={testId}
      // host 가 같은 이벤트 핸들러를 넘기면 내부 동작 뒤에 함께 부른다.
      onFocusCapture={event => {
        onSelect?.();
        onFocusCapture?.(event);
      }}
      onPointerEnter={event => {
        onHoverChange?.(true);
        onPointerEnter?.(event);
      }}
      onPointerLeave={event => {
        onHoverChange?.(false);
        onPointerLeave?.(event);
      }}
      className={cn(
        "group/field-row flex min-w-0 flex-col gap-1.5 rounded-md border-l-2 py-2 pr-2 pl-3 transition-colors motion-reduce:transition-none",
        changed ? "border-l-primary" : "border-l-transparent",
        // 뷰어와 연결된 고른 행은 중립 회색 바탕만 깐다(primary 색은 바뀐 행 띠에만).
        selected && "bg-muted/70",
        locked && "opacity-70",
        className,
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label
          htmlFor={labelFor}
          className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium break-words text-foreground"
        >
          {fieldKey === undefined || fieldKey !== title ? (
            <span className="min-w-0">{title}</span>
          ) : null}
          {fieldKey !== undefined ? (
            <code
              title={labels.keyTitle ? labels.keyTitle(fieldKey) : fieldKey}
              className="min-w-0 rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium break-all text-foreground"
              data-testid={testId ? `${testId}-key` : undefined}
            >
              {fieldKey}
            </code>
          ) : null}
        </label>
        {chip}
        {actions ? (
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {actions}
          </div>
        ) : null}
      </div>
      {description ? (
        <p
          title={
            labels.descriptionTitle
              ? labels.descriptionTitle(description)
              : description
          }
          className="flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground"
          data-testid={testId ? `${testId}-description` : undefined}
        >
          <InfoIcon
            aria-hidden="true"
            className="mt-px size-3.5 shrink-0 opacity-70"
          />
          <span
            id={descriptionId}
            className="line-clamp-1 min-w-0 break-words group-has-[:is(input,textarea,[role=combobox],[role=switch]):focus]/field-row:line-clamp-none"
          >
            {description}
          </span>
        </p>
      ) : null}
      <div className="min-w-0">{children}</div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-destructive"
          data-testid={testId ? `${testId}-error` : undefined}
        >
          {error}
        </p>
      ) : null}
      {machineValue !== undefined ? (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {labels.machine}{" "}
            <span
              className={cn(
                "font-mono",
                changed && "text-foreground line-through",
              )}
            >
              {machineValue}
            </span>
          </span>
          {changed && onRevert ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onRevert}
              data-testid={testId ? `${testId}-button-revert` : undefined}
              className="cursor-pointer"
            >
              <span aria-hidden="true">↺</span> {labels.revert}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
