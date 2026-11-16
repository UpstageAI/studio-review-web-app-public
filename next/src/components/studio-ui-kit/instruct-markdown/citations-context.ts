import { createContext, use } from "react";

export interface CitationState {
  /** 위치를 알 수 없어 누를 수 없다. */
  disabled: boolean;
  selected: boolean;
}

export interface InstructMarkdownLabels {
  /** 인용 칩의 접근성 이름. */
  citation: (index: number) => string;
  /** 위치 없는 칩의 툴팁. */
  noLocation: string;
  /** 이미지 자리의 대체 글자(`alt` 를 받는다). */
  image: (alt: string) => string;
}

export interface InstructCitationsValue {
  getCitationState: (index: number) => CitationState;
  onCitationSelect: (index: number) => void;
  onCitationHover?: (index: number | null) => void;
  labels: InstructMarkdownLabels;
  testId?: string;
}

export const InstructCitationsContext =
  createContext<InstructCitationsValue | null>(null);

/** Provider 밖이면 `null`(인용 칩 없이 글만 그린다). */
export function useInstructCitations(): InstructCitationsValue | null {
  return use(InstructCitationsContext);
}
