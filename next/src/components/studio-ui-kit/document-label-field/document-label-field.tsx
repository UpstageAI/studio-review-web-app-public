import { useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { labelCommit } from "./label";
import { tid } from "./test-id";

/** select 의 "라벨 없음" 항목 값. 숨은 native option 의 value 로 DOM 에 드러난다. */
const NO_LABEL = "\u0000none";

export interface DocumentLabelFieldLabels {
  /** select 의 "라벨 없음" 항목 글자이자 입력 placeholder. */
  noLabel: string;
  /** 고를 수 있는 라벨 밖의 지금 라벨 항목 글자. 없으면 그 항목을 그리지 않는다. */
  notInConfigOption?: (label: string) => string;
}

export interface DocumentLabelFieldClassNames {
  /** select 트리거에 더할 class. */
  trigger?: string;
  /** 입력에 더할 class. */
  input?: string;
}

export interface DocumentLabelFieldProps {
  /** 지금 라벨. `null` 은 라벨 없음. */
  value: string | null;
  onValueChange: (label: string | null) => void;
  /** 고를 수 있는 라벨. 있으면 select, `null` 이면 자유 입력. */
  choices: readonly string[] | null;
  /**
   * 자유 입력을 언제 알릴까. `"blur"`(기본)는 화면 안 draft 를 들고 있다가 blur·Enter 에 확정한다(앞뒤 공백을
   * 빼고 빈 값은 `null`, 바뀌지 않았으면 보내지 않음, Esc 는 되돌림). `"change"` 는 입력마다 그대로 보낸다
   * (`""` 만 `null` — 공백 정리는 호출자가 제출 때). select 는 두 모드 모두 고르는 즉시 보낸다.
   */
  commit?: "blur" | "change";
  /** select 의 "라벨 없음" 항목: `"when-empty"`(기본)는 지금 라벨이 없을 때만, `"always"` 는 늘 맨 앞. */
  noLabelOption?: "when-empty" | "always";
  /**
   * 지금 라벨이 `choices` 밖일 때: `"annotated"`(기본)는 그 라벨을 `labels.notInConfigOption` 문구로 맨 앞
   * (라벨 없음 항목 뒤)에 더한다(문구 함수가 없으면 더하지 않음). `"none"` 은 더하지 않는다.
   */
  outsideOption?: "annotated" | "none";
  maxLength?: number;
  disabled?: boolean;
  /** select 트리거·입력의 id(호출자의 `<label htmlFor>` 연결). */
  id?: string;
  labels: DocumentLabelFieldLabels;
  /** testid 접두. 하위는 `-label-select`·`-option-no-label`·`-option-label-<라벨>`·`-label-input`. */
  testId?: string;
  classNames?: DocumentLabelFieldClassNames;
}

/**
 * 문서 라벨 조작부 하나: 고를 수 있는 라벨이 있으면 select, 없으면 자유 입력. 칸 제목(`<label>`)과 안내
 * 줄은 호출자가 그린다(root 요소 없음).
 */
export function DocumentLabelField({
  choices,
  commit = "blur",
  ...props
}: DocumentLabelFieldProps) {
  if (choices) return <LabelSelect {...props} choices={choices} />;
  return commit === "change" ? (
    <LiveLabelInput {...props} />
  ) : (
    <DraftLabelInput {...props} />
  );
}

type FieldProps = Omit<DocumentLabelFieldProps, "choices" | "commit">;

function LabelSelect({
  value,
  onValueChange,
  choices,
  noLabelOption = "when-empty",
  outsideOption = "annotated",
  disabled,
  id,
  labels,
  testId,
  classNames,
}: FieldProps & { choices: readonly string[] }) {
  const annotated =
    outsideOption === "annotated" &&
    labels.notInConfigOption !== undefined &&
    value !== null &&
    !choices.includes(value);
  return (
    <Select
      value={value ?? NO_LABEL}
      disabled={disabled}
      onValueChange={next => onValueChange(next === NO_LABEL ? null : next)}
    >
      <SelectTrigger
        id={id}
        className={classNames?.trigger}
        data-testid={tid(testId, "label-select")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {noLabelOption === "always" || value === null ? (
          <SelectItem
            value={NO_LABEL}
            data-testid={tid(testId, "option-no-label")}
          >
            {labels.noLabel}
          </SelectItem>
        ) : null}
        {annotated && value !== null && labels.notInConfigOption ? (
          <SelectItem
            value={value}
            data-testid={tid(testId, `option-label-${value}`)}
          >
            {labels.notInConfigOption(value)}
          </SelectItem>
        ) : null}
        {choices.map(choice => (
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
  );
}

/** `commit: "change"` — 입력마다 알린다. */
function LiveLabelInput({
  value,
  onValueChange,
  maxLength,
  disabled,
  id,
  labels,
  testId,
  classNames,
}: FieldProps) {
  return (
    <Input
      id={id}
      value={value ?? ""}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={labels.noLabel}
      onChange={event =>
        onValueChange(event.target.value === "" ? null : event.target.value)
      }
      data-testid={tid(testId, "label-input")}
      className={classNames?.input}
    />
  );
}

/**
 * `commit: "blur"` — draft 를 들고 blur·Enter 에 확정한다. 밖에서 `value` 가 바뀌면 렌더 중에 이전 값과
 * 비교해 draft 를 다시 채운다(effect 를 쓰지 않는다). 확정 뒤 입력을 새로 만들고 싶으면 호출자가 `key` 를
 * 바꾼다 — 그러면 포커스는 입력에 남지 않는다.
 */
function DraftLabelInput({
  value,
  onValueChange,
  maxLength,
  disabled,
  id,
  labels,
  testId,
  classNames,
}: FieldProps) {
  const [base, setBase] = useState(value);
  const [draft, setDraft] = useState(value ?? "");
  if (base !== value) {
    setBase(value);
    setDraft(value ?? "");
  }
  const commit = () => {
    // 손대지 않았으면 끝(blur 와 Enter 가 겹쳐도 한 번만 보낸다). 확정하면 draft 는 앞뒤 공백을 뺀 값이 된다.
    if (draft === (value ?? "")) return;
    const next = labelCommit(draft, value);
    setDraft(draft.trim());
    if (next) onValueChange(next.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      setDraft(value ?? "");
    }
  };
  return (
    <Input
      id={id}
      value={draft}
      maxLength={maxLength}
      disabled={disabled}
      placeholder={labels.noLabel}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      data-testid={tid(testId, "label-input")}
      className={classNames?.input}
    />
  );
}
