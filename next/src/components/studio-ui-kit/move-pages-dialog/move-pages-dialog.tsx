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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isRangeWithin, parsePositiveInt } from "./numbers";
import { tid } from "./test-id";

/** 옮길 대상 문서 하나. `index` 는 host 의 후보 목록 안 위치(0-based). */
export type MovePagesTarget = {
  documentId: string;
  index: number;
  label: string | null;
  pageCount: number;
};

/** 대상 문서 안 위치. `beforePage` 는 1-based(그 페이지 앞, 장수 + 1 이면 끝). */
export type MovePagesPosition = "end" | "start" | { beforePage: number };

/** 페이지를 보낼 곳: 대상 문서 안 위치, 또는 라벨을 정한 새 문서. */
export type MovePagesDestination =
  | { kind: "document"; documentId: string; position: MovePagesPosition }
  | { kind: "new-document"; label: string | null };

/**
 * 옮길 페이지의 출처. `range` 는 한 문서의 페이지 범위를 입력받고(`currentIndex` 는 0-based 기본값),
 * `selection` 은 이미 고른 페이지의 요약 한 줄만 보인다.
 */
export type MovePagesSource =
  | { kind: "range"; pageCount: number; currentIndex: number }
  | { kind: "selection"; count: number; summary: string };

/** 제출 요청. `kind` 는 출처의 `kind` 와 같고, `range` 는 출처가 `range` 일 때만 있다(1-based, 양끝 포함). */
export type MovePagesRequest =
  | {
      kind: "range";
      range: { from: number; to: number };
      destination: MovePagesDestination;
    }
  | { kind: "selection"; destination: MovePagesDestination };

/** 제출 결과. 실패면 `message` 를 오류 줄에 보이고 닫지 않는다. */
export type MovePagesResult = { ok: true } | { ok: false; message: string };

type PositionChoice = "end" | "start" | "before";

/** 페이지 옮기기 대화 상자 문구. 번호는 전부 1-based. */
export interface MovePagesDialogLabels {
  title: string;
  /** 출처가 `range` 일 때 설명. */
  description: string;
  /** 출처가 `selection` 일 때 설명. */
  selectionDescription: string;
  from: string;
  to: string;
  target: string;
  /** 대상 select 항목 문구. `index` 는 1-based, `label` 이 없으면 `null`. */
  documentOption: (index: number, label: string | null) => string;
  newDocument: string;
  /** 대상 문서가 없을 때 안내 줄. */
  onlyNewDocument: string;
  newDocumentLabel: string;
  /** 라벨 select 의 "라벨 없음" 항목, 자유 입력의 placeholder. */
  noLabel: string;
  position: string;
  positions: Record<PositionChoice, string>;
  /** 순번 칸 이름. `max` 는 대상 문서 장수 + 1. */
  beforePage: (max: number) => string;
  invalidRange: (total: number) => string;
  invalidBefore: (total: number) => string;
  /** 고른 대상 문서가 `targets` 에서 사라졌을 때. */
  targetMissing: string;
  cancel: string;
  move: string;
}

export interface MovePagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 옮길 수 있는 문서(순서 그대로). 대상 규칙은 host 가 정한다. */
  targets: readonly MovePagesTarget[];
  /** 새 문서 라벨로 고를 수 있는 라벨. `null` 이면 자유 입력. */
  labelChoices: readonly string[] | null;
  /** 새 문서 라벨의 기본값. `labelChoices` 밖이면 그 앞에 더해 보인다. */
  defaultLabel: string | null;
  /** 열 때 "새 문서" 를 미리 고른다. */
  initialTarget?: "new-document";
  source: MovePagesSource;
  /** 검사를 통과한 제출. 성공이면 닫고, 실패면 `message` 를 보인다. */
  onMove: (request: MovePagesRequest) => MovePagesResult;
  /** 자유 입력 라벨의 `maxLength`. 없으면 속성을 두지 않는다. */
  labelMaxLength?: number;
  labels: MovePagesDialogLabels;
  /** 루트 testid. 하위 접미는 Core README "DOM 계약". 없으면 testid 를 붙이지 않는다. */
  testId?: string;
}

/** 대상 select 의 "새 문서" 항목 값(문서 id 와 겹치지 않는다). */
const NEW_DOCUMENT = "\u0000new";
/** 라벨 select 의 "(라벨 없음)" 항목 값. */
const NO_LABEL = "\u0000none";

/**
 * 페이지를 다른 문서로 옮기거나, 라벨을 정한 새 문서로 분리하는 대화 상자. 출처가 `range` 면
 * 페이지 범위를 고르고, `selection` 이면 이미 고른 페이지의 요약을 보인다. 다른 문서가 없어도
 * 새 문서는 늘 고를 수 있다.
 */
export function MovePagesDialog({
  open,
  onOpenChange,
  labels,
  testId,
  ...props
}: MovePagesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        data-testid={testId}
      >
        <DialogHeader>
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>
            {props.source.kind === "selection"
              ? labels.selectionDescription
              : labels.description}
          </DialogDescription>
        </DialogHeader>
        {/* 열 때마다 새로 마운트해 보고 있는 페이지에서 시작한다. */}
        {open ? (
          <MovePagesForm
            {...props}
            labels={labels}
            testId={testId}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MovePagesForm({
  targets,
  labelChoices,
  defaultLabel,
  initialTarget,
  source,
  onMove,
  labelMaxLength,
  labels,
  testId,
  onClose,
}: Omit<MovePagesDialogProps, "open" | "onOpenChange"> & {
  onClose: () => void;
}) {
  const currentIndex = source.kind === "range" ? source.currentIndex : 0;
  const fromId = useId();
  const toId = useId();
  const targetId = useId();
  const labelId = useId();
  const beforeId = useId();
  const errorId = useId();
  const radioName = useId();
  const [fromText, setFromText] = useState(String(currentIndex + 1));
  const [toText, setToText] = useState(String(currentIndex + 1));
  const [targetDocumentId, setTargetDocumentId] = useState(
    initialTarget === "new-document" || targets.length === 0
      ? NEW_DOCUMENT
      : targets[0]!.documentId,
  );
  // 대상을 바꿔도 열려 있는 동안은 유지한다.
  const [label, setLabel] = useState(defaultLabel ?? "");
  const [position, setPosition] = useState<PositionChoice>("end");
  const [beforeText, setBeforeText] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const toNewDocument = targetDocumentId === NEW_DOCUMENT;
  const target = targets.find(item => item.documentId === targetDocumentId);
  const onlyNewDocument = targets.length === 0;
  // 기본 라벨이 고를 수 있는 라벨 밖이어도 기본값으로 보이게 항목에 더한다.
  const labelItems =
    labelChoices &&
    defaultLabel !== null &&
    !labelChoices.includes(defaultLabel)
      ? [defaultLabel, ...labelChoices]
      : labelChoices;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let range: { from: number; to: number } | undefined;
    if (source.kind === "range") {
      const from = parsePositiveInt(fromText);
      const to = parsePositiveInt(toText);
      const valid =
        from !== null &&
        to !== null &&
        isRangeWithin(source.pageCount, from, to);
      if (!valid || from === null || to === null) {
        setError(labels.invalidRange(source.pageCount));
        return;
      }
      range = { from, to };
    }
    let destination: MovePagesDestination;
    if (toNewDocument) {
      destination = {
        kind: "new-document",
        label: label.trim() === "" ? null : label.trim(),
      };
    } else {
      if (!target) {
        setError(labels.targetMissing);
        return;
      }
      let where: MovePagesPosition =
        position === "before" ? { beforePage: 0 } : position;
      if (position === "before") {
        const before = parsePositiveInt(beforeText);
        if (before === null || before > target.pageCount + 1) {
          setError(labels.invalidBefore(target.pageCount + 1));
          return;
        }
        where = { beforePage: before };
      }
      destination = {
        kind: "document",
        documentId: target.documentId,
        position: where,
      };
    }
    const outcome = onMove(
      range
        ? { kind: "range", range, destination }
        : { kind: "selection", destination },
    );
    if (outcome.ok) {
      onClose();
      return;
    }
    setError(outcome.message);
  };

  const numberField = (
    id: string,
    label: string,
    value: string,
    onChange: (next: string) => void,
    suffix: string,
  ) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={event => {
          onChange(event.target.value);
          setError(null);
        }}
        onFocus={event => event.target.select()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className="w-24 tabular-nums"
        data-testid={tid(testId, suffix)}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="flex min-w-0 flex-col gap-4">
      {source.kind === "selection" ? (
        <p className="text-sm break-words" data-testid={tid(testId, "summary")}>
          {source.summary}
        </p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {numberField(
            fromId,
            labels.from,
            fromText,
            setFromText,
            "input-from",
          )}
          {numberField(toId, labels.to, toText, setToText, "input-to")}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={targetId}
          className="text-xs font-medium text-muted-foreground"
        >
          {labels.target}
        </label>
        <Select
          value={targetDocumentId}
          onValueChange={value => {
            setTargetDocumentId(value);
            setError(null);
          }}
        >
          <SelectTrigger
            id={targetId}
            className="w-full"
            data-testid={tid(testId, "select-target")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map(item => (
              <SelectItem
                key={item.documentId}
                value={item.documentId}
                data-testid={tid(testId, `option-${item.documentId}`)}
              >
                {labels.documentOption(item.index + 1, item.label)}
              </SelectItem>
            ))}
            <SelectItem
              value={NEW_DOCUMENT}
              data-testid={tid(testId, "option-new-document")}
            >
              {labels.newDocument}
            </SelectItem>
          </SelectContent>
        </Select>
        {onlyNewDocument ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid={tid(testId, "only-new-document")}
          >
            {labels.onlyNewDocument}
          </p>
        ) : null}
      </div>
      {toNewDocument ? (
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={labelId}
            className="text-xs font-medium text-muted-foreground"
          >
            {labels.newDocumentLabel}
          </label>
          {labelItems ? (
            <Select
              value={label === "" ? NO_LABEL : label}
              onValueChange={value => {
                setLabel(value === NO_LABEL ? "" : value);
                setError(null);
              }}
            >
              <SelectTrigger
                id={labelId}
                className="w-full"
                data-testid={tid(testId, "label-select")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={NO_LABEL}
                  data-testid={tid(testId, "option-no-label")}
                >
                  {labels.noLabel}
                </SelectItem>
                {labelItems.map(choice => (
                  <SelectItem
                    key={choice}
                    value={choice}
                    data-testid={tid(testId, `option-label-${choice}`)}
                  >
                    {choice}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={labelId}
              value={label}
              maxLength={labelMaxLength}
              placeholder={labels.noLabel}
              autoComplete="off"
              onChange={event => {
                setLabel(event.target.value);
                setError(null);
              }}
              data-testid={tid(testId, "label-input")}
            />
          )}
        </div>
      ) : (
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-xs font-medium text-muted-foreground">
            {labels.position}
          </legend>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {(["end", "start", "before"] as const).map(choice => (
              <label key={choice} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={radioName}
                  value={choice}
                  checked={position === choice}
                  onChange={() => {
                    setPosition(choice);
                    setError(null);
                  }}
                  className="accent-primary"
                  data-testid={tid(testId, `radio-${choice}`)}
                />
                {labels.positions[choice]}
              </label>
            ))}
          </div>
          {position === "before"
            ? numberField(
                beforeId,
                labels.beforePage((target?.pageCount ?? 0) + 1),
                beforeText,
                setBeforeText,
                "input-before",
              )
            : null}
        </fieldset>
      )}
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
