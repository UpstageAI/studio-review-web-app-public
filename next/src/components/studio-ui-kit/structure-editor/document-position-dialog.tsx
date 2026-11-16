import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { tid } from "./shared/test-id";

/** 문서 위치 대화 상자 문구. 위치 번호는 전부 1-based. */
export interface DocumentPositionDialogLabels {
  title: string;
  /** 범위 설명 문장. `index` 는 옮길 문서의 지금 위치(1-based), `first`·`last` 는 옮길 수 있는 구간. */
  description: (index: number, first: number, last: number) => string;
  /** 입력칸 이름. */
  position: string;
  /** 구간 밖·숫자 아님 오류 문구. */
  invalid: (first: number, last: number) => string;
  cancel: string;
  move: string;
}

export interface DocumentPositionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 옮길 문서의 지금 위치(0-based). */
  index: number;
  /** 옮길 수 있는 첫 위치(1-based). 같은 파일 그룹이 이어진 구간의 처음. */
  min: number;
  /** 옮길 수 있는 끝 위치(1-based). 같은 파일 그룹이 이어진 구간의 끝. */
  max: number;
  /** 새 위치(1-based, `min‥max`). 지금 위치와 같으면 부르지 않는다. */
  onMove: (position: number) => void;
  /**
   * 닫힌 뒤 포커스를 돌려줄 요소(대화 상자를 연 메뉴 버튼). 메뉴 항목에서 열면 메뉴가 먼저 닫혀
   * 기본 복귀 대상이 사라지므로 host 가 찾아 준다. `null` 이면 기본 동작.
   */
  returnFocus?: () => HTMLElement | null;
  labels: DocumentPositionDialogLabels;
  /** 루트 testid. 하위는 `-input`·`-button-cancel`·`-button-move`. 없으면 testid 를 붙이지 않는다. */
  testId?: string;
}

/**
 * 문서의 새 위치 번호를 물어 순서를 바꾸는 대화 상자. `Filmstrip`·`PageGrid` 의
 * `onRequestDocumentPosition` 요청에 host 가 이것으로 답한다.
 */
export function DocumentPositionDialog({
  open,
  onOpenChange,
  returnFocus,
  labels,
  testId,
  ...props
}: DocumentPositionDialogProps) {
  // 범위가 적힌 설명 문장을 입력칸에도 연결한다(입력칸은 text 라 min/max 속성이 없다).
  const descriptionId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-sm"
        aria-describedby={descriptionId}
        onCloseAutoFocus={event => {
          const target = returnFocus?.() ?? null;
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
        data-testid={testId}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription id={descriptionId}>
            {labels.description(props.index + 1, props.min, props.max)}
          </DialogDescription>
        </DialogHeader>
        {/* 열 때마다 새로 마운트해 지금 위치에서 시작한다. */}
        {open ? (
          <PositionForm
            {...props}
            labels={labels}
            testId={testId}
            descriptionId={descriptionId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PositionForm({
  index,
  min,
  max,
  onMove,
  labels,
  testId,
  descriptionId,
  onClose,
}: Omit<
  DocumentPositionDialogProps,
  "open" | "onOpenChange" | "returnFocus"
> & {
  descriptionId: string;
  onClose: () => void;
}) {
  const inputId = useId();
  const errorId = useId();
  const [text, setText] = useState(String(index + 1));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const position = parsePosition(text, min, max);
    if (position === null) {
      setError(labels.invalid(min, max));
      return;
    }
    if (position !== index + 1) onMove(position);
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={inputId}
          className="text-xs font-medium text-muted-foreground"
        >
          {labels.position}
        </label>
        <Input
          id={inputId}
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={text}
          onChange={event => {
            setText(event.target.value);
            setError(null);
          }}
          onFocus={event => event.target.select()}
          aria-invalid={error ? true : undefined}
          aria-describedby={
            error ? `${descriptionId} ${errorId}` : descriptionId
          }
          className="w-24 tabular-nums"
          data-testid={tid(testId, "input")}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          data-testid={tid(testId, "button-cancel")}
        >
          {labels.cancel}
        </Button>
        <Button type="submit" data-testid={tid(testId, "button-move")}>
          {labels.move}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** `min‥max` 의 정수만 받는다(앞뒤 공백 허용). 아니면 `null`. */
function parsePosition(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : null;
}
