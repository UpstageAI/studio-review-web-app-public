import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { codePointCount, longTextPreview, utf8ByteLength } from "./long-text";

/** codec 을 거치지 않고 위젯이 직접 만드는 값(글자 입력, 스위치, 비운 선택). */
export type ValueWidgetPrimitive = string | boolean | null;

/** 위젯 모양. 값 모델의 위젯 종류는 host 가 이 다섯 가지로 바꿔 넘긴다. */
export type ValueWidgetDescriptor<V> =
  | { kind: "text"; multiline: boolean; long?: boolean }
  | { kind: "number"; integer: boolean }
  | { kind: "boolean" }
  | { kind: "enum"; options: readonly V[]; nullable: boolean }
  | { kind: "json" };

// prettier-ignore
export type ValueWidgetErrorReason =
  "invalid_number" | "not_integer" | "invalid_json" | "not_scalar";

// prettier-ignore
export type ValueWidgetParse<V, R extends ValueWidgetErrorReason> =
  { ok: true; value: V } | { ok: false; reason: R };

/** 값 ↔ 글자 변환과 같음 판정. 값의 표현(정밀 숫자 등)은 host 가 정한다. */
export interface ValueWidgetCodec<V> {
  /** 입력칸·선택 항목 글자. `null` → "", 문자열 → 그대로, 그 밖 → 표기. */
  toText(value: V | ValueWidgetPrimitive): string;
  /** 선택 항목 key. 값이 같으면 key 도 같아야 한다. */
  keyOf(value: V | ValueWidgetPrimitive): string;
  /** 같은 값인지. 같으면 확정하지 않는다. */
  equals(a: V | ValueWidgetPrimitive, b: V | ValueWidgetPrimitive): boolean;
  /** 숫자 입력. 정수 위젯이면 소수부가 있는 값을 거부한다. */
  parseNumber(
    text: string,
    integer: boolean,
  ): ValueWidgetParse<V, "invalid_number" | "not_integer">;
  /** JSON 값 하나(객체·배열이 아닌 것) 입력. */
  parseScalar(text: string): ValueWidgetParse<V, "invalid_json" | "not_scalar">;
}

export interface ValueWidgetLabels {
  /** 값이 없음(선택 상자의 비움 항목, 스위치 옆). */
  none: string;
  true: string;
  false: string;
  /** 값이 `null` 일 때 입력칸 placeholder. */
  nullPlaceholder: string;
  /** 값이 빈 문자열일 때 입력칸 placeholder. */
  emptyPlaceholder: string;
  /** 선택 목록에 없는 현재 값 항목. */
  notInConfig: (value: string) => string;
  /** 입력을 값으로 읽지 못한 이유별 문구(`onError` 로 넘긴다). */
  errors: Record<ValueWidgetErrorReason, string>;
  /** 긴 문자열 요약 줄. 바이트 수 표기(locale)는 host 가 한다. */
  longTextSummary: (bytes: number, count: number) => string;
  longTextHint: string;
  /** 긴 문자열 요약의 "JSON 으로 편집" 버튼. */
  editJson: string;
}

/**
 * 입력 요소에 붙일 `data-*` 속성(예: host 의 다음 입력 칸 찾기 표식). `data-testid` 는 넣을 수
 * 없다(타입을 우회해 넣어도 내부 testid 가 이긴다).
 */
export type ValueWidgetControlProps = Record<`data-${string}`, string> & {
  "data-testid"?: never;
};

export interface ValueWidgetProps<V> {
  /** 입력 요소 id(라벨의 `htmlFor`). */
  id: string;
  descriptor: ValueWidgetDescriptor<V>;
  value: V | ValueWidgetPrimitive;
  codec: ValueWidgetCodec<V>;
  /** 값이 바뀌어 확정될 때(blur·Enter·선택). 같은 값이면 부르지 않는다. */
  onCommit: (value: V | ValueWidgetPrimitive) => void;
  /** 입력 오류 문구(`labels.errors`). `null` 은 오류 없음. */
  onError: (message: string | null) => void;
  disabled?: boolean;
  /** `aria-invalid`. */
  invalid?: boolean;
  /** `aria-describedby`. */
  describedBy?: string;
  /** 긴 문자열 요약에 "JSON 으로 편집" 버튼을 그린다. 없으면 버튼이 없다. */
  onEditJson?: () => void;
  /**
   * Enter 로 확정에 성공한 뒤 부른다(입력 요소를 넘김). 다음 칸으로 포커스를 옮기는 일은
   * host 가 한다. 없으면 포커스는 그대로다.
   */
  onSubmitNext?: (from: HTMLElement) => void;
  /** 입력 요소(입력칸, 선택 상자)에 더할 클래스. 표 셀처럼 좁은 자리에서 모양을 줄일 때. */
  controlClassName?: string;
  /**
   * 입력 요소(긴 문자열 미리보기, 선택 상자 트리거, 스위치, 입력칸)에 붙일 `data-*` 속성.
   * `data-testid` 는 덮지 못한다. adapter primitive 가 쓰는 `data-slot` 등은 넘기지 않는다.
   */
  controlProps?: ValueWidgetControlProps;
  labels: ValueWidgetLabels;
  /** 하위 testid 접두. 루트 요소는 없다. */
  testId?: string;
}

const NULL_KEY = "\u0000null";

function tid(testId: string | undefined, part: string): string | undefined {
  return testId ? `${testId}-${part}` : undefined;
}

/**
 * 위젯 종류별 값 입력. 텍스트·숫자는 입력하는 동안 화면 안에서만 들고 있다가 blur·Enter
 * 때 한 번 확정한다(키 입력마다 바깥 상태를 바꾸지 않는다). Esc 는 입력을 원래 값으로 되돌린다.
 */
export function ValueWidget<V>(props: ValueWidgetProps<V>) {
  const { descriptor } = props;
  switch (descriptor.kind) {
    case "enum":
      return <EnumWidget {...props} descriptor={descriptor} />;
    case "boolean":
      return <BooleanWidget {...props} />;
    case "number":
      return (
        <TextLikeWidget {...props} mode="number" integer={descriptor.integer} />
      );
    case "text":
      if (descriptor.long) return <LongTextSummary {...props} />;
      return (
        <TextLikeWidget
          {...props}
          mode={descriptor.multiline ? "multiline" : "text"}
        />
      );
    default:
      return <TextLikeWidget {...props} mode="json" />;
  }
}

/**
 * 너무 긴 문자열의 읽기 전용 요약: 크기·글자 수, 앞부분 미리보기, "JSON 으로 편집" 버튼. 문자열 전체를
 * 입력칸에 넣지 않아 레이아웃이 멈추지 않는다. 미리보기는 포커스를 받는다.
 */
function LongTextSummary<V>({
  id,
  value,
  disabled = false,
  onEditJson,
  controlProps,
  labels,
  testId,
}: ValueWidgetProps<V>) {
  const text = typeof value === "string" ? value : "";
  const summary = useMemo(
    () => ({
      bytes: utf8ByteLength(text),
      count: codePointCount(text),
      preview: longTextPreview(text),
    }),
    [text],
  );
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      data-testid={tid(testId, "long-text")}
    >
      <p className="text-xs text-muted-foreground">
        {labels.longTextSummary(summary.bytes, summary.count)}
      </p>
      <pre
        id={id}
        tabIndex={0}
        {...controlProps}
        className="max-h-32 overflow-auto rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
        data-testid={tid(testId, "long-text-preview")}
      >
        {summary.preview}
      </pre>
      <p className="text-xs text-muted-foreground">{labels.longTextHint}</p>
      {onEditJson ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onEditJson}
          className="cursor-pointer self-start"
          data-testid={tid(testId, "long-text-button-edit-json")}
        >
          {labels.editJson}
        </Button>
      ) : null}
    </div>
  );
}

function EnumWidget<V>({
  id,
  descriptor,
  value,
  codec,
  disabled = false,
  invalid,
  describedBy,
  onCommit,
  controlClassName,
  controlProps,
  labels,
  testId,
}: ValueWidgetProps<V> & {
  descriptor: Extract<ValueWidgetDescriptor<V>, { kind: "enum" }>;
}) {
  const options = descriptor.options.map(option => ({
    key: codec.keyOf(option),
    value: option,
    label: codec.toText(option),
  }));
  const inOptions = options.some(option => codec.equals(option.value, value));
  const currentKey = value === null ? NULL_KEY : codec.keyOf(value);

  return (
    <Select
      value={currentKey}
      disabled={disabled}
      onValueChange={key => {
        if (key === currentKey) return;
        if (key === NULL_KEY) onCommit(null);
        else {
          const option = options.find(item => item.key === key);
          if (option) onCommit(option.value);
        }
      }}
    >
      <SelectTrigger
        id={id}
        className={cn("w-full", controlClassName)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        {...controlProps}
        data-testid={tid(testId, "select-value")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {descriptor.nullable || value === null ? (
          <SelectItem value={NULL_KEY}>{labels.none}</SelectItem>
        ) : null}
        {!inOptions && value !== null ? (
          <SelectItem value={currentKey}>
            {labels.notInConfig(codec.toText(value))}
          </SelectItem>
        ) : null}
        {options.map(option => (
          <SelectItem key={option.key} value={option.key}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function BooleanWidget<V>({
  id,
  value,
  disabled = false,
  invalid,
  describedBy,
  onCommit,
  controlProps,
  labels,
  testId,
}: ValueWidgetProps<V>) {
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={value === true}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onCheckedChange={checked => {
          if (checked !== value) onCommit(checked);
        }}
        {...controlProps}
        data-testid={tid(testId, "switch-value")}
      />
      <span className="text-sm text-muted-foreground">
        {value === null
          ? labels.none
          : value === true
            ? labels.true
            : labels.false}
      </span>
    </div>
  );
}

type TextMode = "text" | "multiline" | "number" | "json";

function TextLikeWidget<V>({
  id,
  value,
  codec,
  disabled = false,
  invalid,
  describedBy,
  onCommit,
  onError,
  onSubmitNext,
  controlClassName,
  controlProps,
  labels,
  testId,
  mode,
  integer = false,
}: ValueWidgetProps<V> & { mode: TextMode; integer?: boolean }) {
  const original = codec.toText(value);
  // 입력 중인 글자. 확정하거나 바깥에서 값이 바뀌면(되돌리기) 원래 값으로 맞춘다.
  const [draft, setDraft] = useState<{ base: string; text: string } | null>(
    null,
  );
  const text = draft && draft.base === original ? draft.text : original;

  const reset = () => {
    setDraft(null);
    onError(null);
  };

  /** 입력을 값으로 바꿔 확정한다. 실패하면 오류를 보이고 `false`. */
  const commit = (): boolean => {
    if (text === original) {
      reset();
      return true;
    }
    let next: V | ValueWidgetPrimitive;
    if (mode === "number") {
      const parsed = codec.parseNumber(text, integer);
      if (!parsed.ok) {
        onError(labels.errors[parsed.reason]);
        return false;
      }
      next = parsed.value;
    } else if (mode === "json") {
      const parsed = codec.parseScalar(text);
      if (!parsed.ok) {
        onError(labels.errors[parsed.reason]);
        return false;
      }
      next = parsed.value;
    } else {
      next = text;
    }
    reset();
    if (!codec.equals(next, value)) onCommit(next);
    return true;
  };

  const onKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      reset();
      return;
    }
    const submit =
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      (mode !== "multiline" || event.metaKey || event.ctrlKey);
    if (!submit) return;
    event.preventDefault();
    const target = event.currentTarget;
    if (commit()) onSubmitNext?.(target);
  };

  const common = {
    id,
    value: text,
    disabled,
    // null 은 "값 없음", 빈 문자열은 "빈 값" 을 흐리게 보인다(둘은 저장되는 값이 다르다).
    placeholder:
      value === null
        ? labels.nullPlaceholder
        : value === ""
          ? labels.emptyPlaceholder
          : undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft({ base: original, text: event.target.value }),
    onBlur: () => {
      commit();
    },
    onKeyDown,
    "aria-invalid": invalid || undefined,
    "aria-describedby": describedBy,
    ...controlProps,
  };

  if (mode === "multiline") {
    return (
      <Textarea
        {...common}
        rows={3}
        className={controlClassName}
        data-testid={tid(testId, "textarea-value")}
      />
    );
  }
  return (
    <Input
      {...common}
      inputMode={mode === "number" ? "decimal" : undefined}
      className={cn(
        (mode === "number" || mode === "json") && "font-mono",
        controlClassName,
      )}
      data-testid={tid(testId, "input-value")}
    />
  );
}
