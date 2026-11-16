"use client";

// Instruct markdown 의 인용 칩이 읽는 상태와 콜백을 Core `InstructCitations` 로 넘긴다.
// markdown 의 렌더 부품은 고정이라 선택이 바뀌어도 칩이 다시 마운트되지 않고, 칩만 새 상태를 받는다.

import type { ReactNode } from "react";
import {
  InstructCitations,
  type CitationState,
  type InstructMarkdownLabels,
} from "@/components/studio-ui-kit/instruct-markdown";

export type InstructCitationState = CitationState;

export type InstructCitationValue = {
  citationState: (index: number) => InstructCitationState;
  onCitation: (index: number) => void;
  /** 인용 칩을 가리키거나(포커스) 떠날 때(`null`). 뷰어가 그 위치를 미리 보인다. */
  onCitationHover?: (index: number | null) => void;
  labels: InstructMarkdownLabels;
};

/** 칩 testid 는 `job-review-instruct-citation`. 값의 콜백·`labels` 는 고정해 넘긴다. */
export function InstructCitationContext({
  value,
  children,
}: {
  value: InstructCitationValue;
  children?: ReactNode;
}) {
  return (
    <InstructCitations
      getCitationState={value.citationState}
      onCitationSelect={value.onCitation}
      onCitationHover={value.onCitationHover}
      labels={value.labels}
      testId="job-review-instruct"
    >
      {children}
    </InstructCitations>
  );
}
