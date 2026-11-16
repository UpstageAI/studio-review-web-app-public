"use client";

import type { ReactNode } from "react";
import {
  InstructStructured as CoreInstructStructured,
  type InstructStructuredLabels,
} from "@/components/studio-ui-kit/instruct-markdown";
import {
  isJsonObject,
  stringifyJson,
  type JsonValue,
} from "@/lib/review-model";

export type { InstructStructuredLabels };

export type InstructStructuredProps = {
  value: JsonValue;
  /** 문자열 값을 그린다(markdown + 인용 칩). */
  renderText: (text: string) => ReactNode;
  labels: InstructStructuredLabels;
};

/**
 * `response_format` 으로 받은 JSON 출력을 필드별로 보인다. 객체 판별·숫자 표기는 모델 JSON 표현
 * (`ExactNumber` 는 객체가 아니라 원문 표기)을 따른다. 원본은 "원본 JSON 보기" 에 있다.
 */
export function InstructStructured({
  value,
  renderText,
  labels,
}: InstructStructuredProps) {
  return (
    <CoreInstructStructured
      value={value}
      renderText={renderText}
      formatScalar={stringifyJson}
      isRecord={isJsonObject}
      labels={labels}
      testId="job-review-instruct-structured"
    />
  );
}
