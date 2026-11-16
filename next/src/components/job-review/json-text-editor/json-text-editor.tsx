import { type ComponentProps, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { offsetOf } from "./offset";

export interface JsonTextEditorLabels {
  /** 입력 칸 이름(`aria-label`). */
  editor: string;
  /** 오류 위치로 커서를 옮기는 버튼. */
  jumpToError: string;
}

export interface JsonTextEditorError {
  /** 1-based 줄. 열과 함께 있으면 위치 이동 버튼이 보인다. */
  line?: number;
  /** 1-based 열(UTF-16 code unit 기준). */
  column?: number;
  /** 화면에 보일 오류 문구(위치 표기 포함은 host 가 정한다). */
  message: string;
}

export interface JsonTextEditorProps extends Omit<
  ComponentProps<"div">,
  "onChange" | "children"
> {
  /** 편집 중인 JSON 텍스트. */
  value: string;
  onChange: (value: string) => void;
  /** 읽기 오류. 있으면 입력 칸을 오류 상태로 두고 문구와 위치 이동 버튼을 보인다. */
  error?: JsonTextEditorError | null;
  disabled?: boolean;
  /** 보이는 줄 수(기본 16). */
  rows?: number;
  labels: JsonTextEditorLabels;
  /** 루트 `data-testid`. 입력은 `<testId>-textarea`, 버튼은 `<testId>-button-jump`. */
  testId?: string;
}

/**
 * JSON 텍스트 편집 칸. 고정폭 글꼴의 여러 줄 입력이고, 파싱·검사는 host 가 해서 오류를
 * `error` 로 넘긴다. 오류가 있으면 문구 옆 버튼으로 그 줄·열에 커서를 둔다.
 */
export function JsonTextEditor({
  value,
  onChange,
  error,
  disabled = false,
  rows = 16,
  labels,
  testId,
  className,
  ...props
}: JsonTextEditorProps) {
  const errorId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  const jump = () => {
    const field = ref.current;
    if (!field || error?.line === undefined || error.column === undefined) {
      return;
    }
    const offset = offsetOf(field.value, error.line, error.column);
    field.focus();
    field.setSelectionRange(offset, offset);
  };

  return (
    <div
      {...props}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <Textarea
        ref={ref}
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        aria-label={labels.editor}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        data-testid={testId ? `${testId}-textarea` : undefined}
        className="max-h-[60vh] min-h-40 font-mono text-xs"
      />
      {error ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p
            id={errorId}
            role="alert"
            className="min-w-0 text-xs text-destructive"
          >
            {error.message}
          </p>
          {error.line !== undefined && error.column !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={jump}
              disabled={disabled}
              data-testid={testId ? `${testId}-button-jump` : undefined}
              className="cursor-pointer"
            >
              {labels.jumpToError}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
