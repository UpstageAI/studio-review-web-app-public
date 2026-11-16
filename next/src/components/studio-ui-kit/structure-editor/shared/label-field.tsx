import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import type { StructureEditorCallbacks } from "./callbacks";
import { labelCommit, normalizeLabel } from "./label";
import type { StructureEditorLabels } from "./labels";
import { tid } from "./test-id";
import type { StructureDocument } from "./types";

/** 라벨 select 의 "라벨 없음" 값. */
export const NO_LABEL = "\u0000";

/** 라벨 select·입력칸 class(두 view 가 같은 모양). */
export const LABEL_FIELD_CLASS =
  "h-7 w-0 min-w-24 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50";

type LabelFieldLabels = Pick<
  StructureEditorLabels,
  "label" | "noLabel" | "notInConfigOption" | "untitled"
>;

export interface LabelFieldProps {
  document: StructureDocument;
  disabled: boolean;
  labels: LabelFieldLabels;
  maxLength?: number;
  testId?: string;
  onLabelChange: StructureEditorCallbacks["onLabelChange"];
  /**
   * 자유 입력 중에 입력칸이 언마운트되면(창 밖으로 나간 행 등) blur 와 같게 확정할까. 페이지 격자는
   * `true`, 필름스트립은 `false`(지금은 입력이 버려진다 — 두 view 의 동작을 그대로 둔다).
   */
  commitOnUnmount: boolean;
}

/**
 * 문서 라벨 필드: 설정 라벨(`labelChoices`)이 있으면 native select, 없으면 입력(blur·Enter 에 확정,
 * Esc 취소). testid 는 `<testId>-label-select` / `<testId>-label-input`.
 */
export function LabelField({
  document,
  disabled,
  labels,
  maxLength,
  testId,
  onLabelChange,
  commitOnUnmount,
}: LabelFieldProps) {
  if (document.labelChoices) {
    const choices = document.labelChoices;
    const current = document.label;
    const outside = current !== null && !choices.includes(current);
    return (
      <select
        aria-label={labels.label}
        value={current ?? NO_LABEL}
        disabled={disabled}
        onChange={event => {
          const value = event.target.value;
          onLabelChange(document.documentId, value === NO_LABEL ? null : value);
        }}
        data-testid={tid(testId, "label-select")}
        className={cn(LABEL_FIELD_CLASS, "cursor-pointer")}
      >
        {current === null ? (
          <option value={NO_LABEL}>{labels.noLabel}</option>
        ) : null}
        {outside ? (
          <option value={current}>{labels.notInConfigOption(current)}</option>
        ) : null}
        {choices.map(choice => (
          <option key={choice} value={choice}>
            {choice}
          </option>
        ))}
      </select>
    );
  }

  return (
    <LabelInput
      document={document}
      disabled={disabled}
      labels={labels}
      maxLength={maxLength}
      testId={testId}
      onLabelChange={onLabelChange}
      commitOnUnmount={commitOnUnmount}
    />
  );
}

/**
 * 자유 입력 라벨. 확정해도 입력을 다시 만들지 않아 Enter 뒤에도 포커스가 남는다 — 라벨이 밖에서
 * 바뀌면(확정 반영·되돌리기 등) 렌더 중에 이전 값과 비교해 편집 중인 내용을 다시 채운다.
 */
function LabelInput({
  document,
  disabled,
  labels,
  maxLength,
  testId,
  onLabelChange,
  commitOnUnmount,
}: Omit<LabelFieldProps, "labels"> & { labels: LabelFieldLabels }) {
  const { draft, setDraft, commit, onKeyDown } = useLabelDraft({
    documentId: document.documentId,
    label: document.label,
    disabled,
    onLabelChange,
    commitOnUnmount,
  });
  return (
    <input
      type="text"
      aria-label={labels.label}
      placeholder={labels.untitled}
      value={draft}
      maxLength={maxLength}
      disabled={disabled}
      onChange={event => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      data-testid={tid(testId, "label-input")}
      className={LABEL_FIELD_CLASS}
    />
  );
}

/**
 * 라벨 입력의 draft 와 확정. 확정 값은 `labelCommit`(앞뒤 공백 제거, 바뀌지 않으면 보내지 않음).
 * `commitOnUnmount` 면 언마운트 때도 확정하되(blur 가 오지 않으므로), 확정한 직후 라벨 prop 이 반영되기
 * 전에 언마운트되면 같은 값을 한 번 더 보내지 않는다.
 */
function useLabelDraft({
  documentId,
  label,
  disabled,
  onLabelChange,
  commitOnUnmount,
}: {
  documentId: string;
  label: string | null;
  disabled: boolean;
  onLabelChange: StructureEditorCallbacks["onLabelChange"];
  commitOnUnmount: boolean;
}) {
  const [base, setBase] = useState({ documentId, label });
  const [draft, setDraft] = useState(label ?? "");
  if (base.documentId !== documentId || base.label !== label) {
    setBase({ documentId, label });
    setDraft(label ?? "");
  }
  // 마지막으로 확정해 보낸 값. 라벨 prop 이 바뀌면 그 값으로 맞춘다.
  const committedRef = useRef(normalizeLabel(label));
  const latestRef = useRef({
    draft,
    disabled,
    label,
    documentId,
    onLabelChange,
    commitOnUnmount,
  });
  useEffect(() => {
    latestRef.current = {
      draft,
      disabled,
      label,
      documentId,
      onLabelChange,
      commitOnUnmount,
    };
  });
  useEffect(() => {
    committedRef.current = normalizeLabel(label);
  }, [label]);
  useEffect(() => {
    const latest = latestRef;
    const committed = committedRef;
    return () => {
      // 창 밖으로 나가 언마운트되면 blur 가 오지 않으므로 여기서 확정한다.
      const current = latest.current;
      if (!current.commitOnUnmount || current.disabled) return;
      const next = labelCommit(current.draft, current.label);
      if (!next || next.value === committed.current) return;
      committed.current = next.value;
      current.onLabelChange(current.documentId, next.value);
    };
  }, []);
  const commit = () => {
    const next = labelCommit(draft, label);
    if (!next) {
      setDraft(label ?? "");
      return;
    }
    setDraft(next.value ?? "");
    committedRef.current = next.value;
    onLabelChange(documentId, next.value);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      setDraft(label ?? "");
    }
  };
  return { draft, setDraft, commit, onKeyDown };
}

/** 라벨을 고칠 수 없을 때(`onLabelChange` 없음) 보이는 라벨 글자. */
export function LabelText({
  label,
  untitled,
}: {
  label: string | null;
  untitled: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        label === null ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {label ?? untitled}
    </span>
  );
}
