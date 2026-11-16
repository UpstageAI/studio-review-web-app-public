import {
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  appendDraft,
  editDraft,
  revertDraft,
  rowsOf,
  syncDrafts,
  type RangeDraft,
} from "./drafts";

/** 파일 하나의 페이지 범위 행. `text` 는 화면이 정한 범위 표기(예: `"1-3, 5"`). */
export interface PageRangeRow {
  fileRef: string;
  text: string;
}

export interface PageRangeFileOption {
  fileRef: string;
  /** 선택지에 보일 파일 이름. */
  name: string;
}

export interface PageRangeEditorLabels {
  /** 파일 선택의 접근성 이름 — 1-based 행 번호 */
  file: (row: number) => string;
  /** 범위 입력의 접근성 이름 — 1-based 행 번호 */
  range: (row: number) => string;
  /** 범위 입력 placeholder(예: `"1-3, 5"`) */
  placeholder: string;
  /** 행 삭제 버튼 이름 — 1-based 행 번호 */
  removeRow: (row: number) => string;
  /** 행 추가 버튼 */
  addRow: string;
}

/** 루트 `ref` 는 받지 않는다(내부에서 루트를 직접 잡는다). */
export interface PageRangeEditorProps extends Omit<
  ComponentProps<"div">,
  "children" | "onChange" | "ref"
> {
  /** 확정된 행. 바뀌면(되돌리기 등) 편집 중인 내용을 이 값으로 다시 채운다. */
  rows: readonly PageRangeRow[];
  /** 고를 수 있는 파일. 새 행은 첫 파일로 시작한다. */
  fileOptions: readonly PageRangeFileOption[];
  /** 범위 표기 검사. 틀리면 행 아래에 보일 문구, 맞으면 `null`. */
  validate: (text: string) => string | null;
  /**
   * Enter·blur·파일 변경·행 삭제 때 모든 행이 `validate` 를 통과하고 `rows` 와 다르면
   * 부른다. 하나라도 틀리면 부르지 않고 그 행 아래에 문구를 보인다.
   */
  onCommit?: (rows: PageRangeRow[]) => void;
  /** 편집 중인 행이 바뀔 때마다(검사 전). 확정 버튼을 host 가 둘 때 쓴다. */
  onDraftChange?: (rows: PageRangeRow[]) => void;
  disabled?: boolean;
  labels: PageRangeEditorLabels;
  /**
   * 루트 `data-testid`. 하위 요소는 `<testId>-select-file`·`<testId>-input-range`·
   * `<testId>-button-remove`·`<testId>-button-add`.
   */
  testId?: string;
}

function sameRows(
  a: readonly PageRangeRow[],
  b: readonly PageRangeRow[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (row, index) =>
        row.fileRef === b[index]?.fileRef && row.text === b[index]?.text,
    )
  );
}

const tid = (testId: string | undefined, suffix: string) =>
  testId ? `${testId}-${suffix}` : undefined;

/**
 * 문서의 페이지 범위를 파일별 행(파일 선택 + 범위 입력)으로 편집한다. 범위 표기의
 * 해석·검사는 host 가 `validate` 로 정하고, 확정은 `onCommit` 으로만 알린다.
 * 편집 중인 내용과 행별 오류는 이 컴포넌트가 갖는다.
 */
export function PageRangeEditor({
  rows,
  fileOptions,
  validate,
  onCommit,
  onDraftChange,
  disabled = false,
  labels,
  testId,
  className,
  ...props
}: PageRangeEditorProps) {
  const baseId = useId();
  const [committed, setCommitted] = useState<readonly PageRangeRow[]>(rows);
  const [drafts, setDrafts] = useState<RangeDraft[]>(() =>
    syncDrafts([], rows),
  );
  const [errors, setErrors] = useState<(string | null)[]>([]);
  const focusRow = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 밖에서 확정 값이 바뀌면 편집 중인 내용을 버리고 다시 채운다(같은 자리 행은 id 를 이어 받아 DOM 유지).
  if (!sameRows(committed, rows)) {
    setCommitted(rows);
    setDrafts(syncDrafts(drafts, rows));
    setErrors([]);
  }

  useEffect(() => {
    const index = focusRow.current;
    if (index === null) return;
    focusRow.current = null;
    const frame = requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLInputElement>(`[data-range-row="${index}"]`)
        ?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [drafts.length]);

  const update = (next: RangeDraft[]) => {
    setDrafts(next);
    onDraftChange?.(rowsOf(next));
  };

  const commit = (next: readonly RangeDraft[]) => {
    const found = next.map(row => validate(row.text));
    setErrors(found);
    if (found.some(error => error !== null)) return;
    if (!sameRows(next, rows)) onCommit?.(rowsOf(next));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(drafts);
    } else if (event.key === "Escape") {
      // 행이 지워져 당겨졌어도 그 행이 처음 가졌던 값으로 돌아간다.
      update(revertDraft(drafts, index));
      setErrors(current => current.map((e, i) => (i === index ? null : e)));
    }
  };

  return (
    <div
      {...props}
      ref={rootRef}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      {drafts.map((row, index) => {
        const error = errors[index] ?? null;
        const errorId = `${baseId}-error-${row.id}`;
        const known = fileOptions.some(file => file.fileRef === row.fileRef);
        return (
          <div key={row.id} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 items-center gap-1.5">
              <Select
                value={row.fileRef}
                disabled={disabled}
                onValueChange={fileRef => {
                  const next = editDraft(drafts, index, { fileRef });
                  update(next);
                  commit(next);
                }}
              >
                <SelectTrigger
                  aria-label={labels.file(index + 1)}
                  data-testid={tid(testId, "select-file")}
                  className="w-32 min-w-0 shrink-0"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {known ? null : (
                    <SelectItem value={row.fileRef}>{row.fileRef}</SelectItem>
                  )}
                  {fileOptions.map(file => (
                    <SelectItem key={file.fileRef} value={file.fileRef}>
                      {file.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={row.text}
                disabled={disabled}
                placeholder={labels.placeholder}
                inputMode="numeric"
                autoComplete="off"
                aria-label={labels.range(index + 1)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                data-range-row={index}
                data-testid={tid(testId, "input-range")}
                className="min-w-0 flex-1"
                onChange={event => {
                  const text = event.target.value;
                  update(editDraft(drafts, index, { text }));
                  if (error) {
                    setErrors(current =>
                      current.map((e, i) => (i === index ? null : e)),
                    );
                  }
                }}
                onBlur={() => commit(drafts)}
                onKeyDown={event => onKeyDown(event, index)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || drafts.length <= 1}
                aria-label={labels.removeRow(index + 1)}
                title={labels.removeRow(index + 1)}
                data-testid={tid(testId, "button-remove")}
                className="shrink-0 cursor-pointer"
                onClick={() => {
                  const next = drafts.filter((_, i) => i !== index);
                  update(next);
                  commit(next);
                }}
              >
                ×
              </Button>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        disabled={disabled || fileOptions.length === 0}
        data-testid={tid(testId, "button-add")}
        className="cursor-pointer self-start"
        onClick={() => {
          const first = fileOptions[0];
          if (!first) return;
          focusRow.current = drafts.length;
          update(appendDraft(drafts, { fileRef: first.fileRef, text: "" }));
        }}
      >
        {labels.addRow}
      </Button>
    </div>
  );
}
