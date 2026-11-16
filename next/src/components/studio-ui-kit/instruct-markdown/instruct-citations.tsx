import { useMemo, type ReactNode } from "react";
import {
  InstructCitationsContext,
  type CitationState,
  type InstructCitationsValue,
  type InstructMarkdownLabels,
} from "./citations-context";

export type { CitationState, InstructMarkdownLabels };

export interface InstructCitationsProps {
  /** 인용 번호의 칩 상태. */
  getCitationState: (index: number) => CitationState;
  /** 누를 수 있는 칩을 눌렀을 때. */
  onCitationSelect: (index: number) => void;
  /** 누를 수 있는 칩을 가리키거나(포커스) 떠날 때(`null`). */
  onCitationHover?: (index: number | null) => void;
  labels: InstructMarkdownLabels;
  /** 칩 `data-testid` 접두. 칩은 `<testId>-citation`. */
  testId?: string;
  children?: ReactNode;
}

/**
 * 안쪽 `InstructMarkdown` 의 인용 칩이 읽는 상태·콜백·문구. markdown 의 렌더 부품은 모듈 상수라 선택이
 * 바뀌어도 칩이 다시 마운트되지 않고, 칩만 이 값으로 새 상태를 받는다. 콜백·`labels` 는 고정해 넘긴다.
 */
export function InstructCitations({
  getCitationState,
  onCitationSelect,
  onCitationHover,
  labels,
  testId,
  children,
}: InstructCitationsProps) {
  const value = useMemo<InstructCitationsValue>(
    () => ({
      getCitationState,
      onCitationSelect,
      onCitationHover,
      labels,
      testId,
    }),
    [getCitationState, onCitationSelect, onCitationHover, labels, testId],
  );
  return (
    <InstructCitationsContext value={value}>
      {children}
    </InstructCitationsContext>
  );
}
