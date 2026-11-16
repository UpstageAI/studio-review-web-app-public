import { lazy, Suspense, type ReactNode } from "react";
import type { MarkdownBodyProps } from "./markdown-body";

// react-markdown 과 remark 플러그인은 본문을 처음 그릴 때만 불러온다(별도 chunk).
const MarkdownBody = lazy(() => import("./markdown-body"));

export type InstructMarkdownProps = MarkdownBodyProps & {
  /** 본문 모듈을 불러오는 동안 보일 자리. 없으면 아무것도 그리지 않는다. */
  fallback?: ReactNode;
};

/**
 * Instruct 출력 markdown 렌더. 원시 HTML 은 그리지 않고(react-markdown 기본, `rehype-raw` 없음),
 * 안전하지 않은 URL 은 기본 `urlTransform` 이 지운다. 이미지는 불러오지 않고 대체 글자만 보인다.
 * `InstructCitations` 안이면 인용 표식 `【†n】`·`[†n]` 은 번호 칩 버튼으로(누르면 그 위치를 고르고,
 * 가리키면 미리 보인다), 밖이면 표식을 지우고 글만 그린다. 그 밖의 링크는 새 창
 * (`noopener noreferrer`)으로 연다. 위치 없는 칩의 툴팁에는 조상 `TooltipProvider` 가 필요하다.
 */
export function InstructMarkdown({
  fallback,
  ...props
}: InstructMarkdownProps) {
  return (
    <Suspense fallback={fallback ?? null}>
      <MarkdownBody {...props} />
    </Suspense>
  );
}
