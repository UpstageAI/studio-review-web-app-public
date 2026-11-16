"use client";

import { memo, useMemo } from "react";
import { ParseTable as CoreParseTable } from "@/components/studio-ui-kit/parse-table";

/**
 * Parse 표 요소의 `content.html` 을 허용 목록으로 다시 만든 표. 같은 `html`·`imageLabel` 이면 다시 파싱하지
 * 않는다. 그릴 수 없으면 아무것도 그리지 않고 `onUnrenderable(id)` 로 알리고, 표 영역 클릭은 `onActivate(id)`
 * 로 잇는다(Core `ParseTable` 에 문구와 testid 를 넘기는 래퍼).
 */
export const ParseTable = memo(function ParseTable({
  id,
  html,
  imageLabel,
  regionLabel,
  onActivate,
  onUnrenderable,
}: {
  id: string;
  html: string;
  imageLabel: (alt: string) => string;
  regionLabel: string;
  onActivate: (id: string) => void;
  onUnrenderable: (id: string) => void;
}) {
  const labels = useMemo(
    () => ({ region: regionLabel, image: imageLabel }),
    [regionLabel, imageLabel],
  );
  return (
    <CoreParseTable
      id={id}
      html={html}
      labels={labels}
      onActivate={onActivate}
      onUnrenderable={onUnrenderable}
      testId="job-review-parse-table"
    />
  );
});
