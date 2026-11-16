import { useMemo, type ComponentProps, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  citationIndexOf,
  citationMarkdown,
  stripCitationMarkers,
} from "./citation";
import { useInstructCitations } from "./citations-context";

export type MarkdownBodyProps = Omit<
  ComponentProps<"div">,
  "children" | "ref"
> & {
  text: string;
};

/**
 * Studio 의 Instruct 결과 본문과 같이 GFM(표·취소선·작업 목록)에 더해 줄바꿈 하나도 줄을 바꾼다
 * (`remark-breaks`). 모델 출력은 문단 사이에 빈 줄 없이 줄만 바꾸는 일이 많아, 없으면 한 문단으로 붙는다.
 */
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];

/**
 * 인용 표식 `【†n】` 링크 자리에 그리는 번호 칩. 상태·콜백은 `InstructCitations` 에서 받는다.
 * Provider 밖이면 칩 없이 링크 글자만 그린다.
 */
function CitationChip({
  index,
  children,
}: {
  index: number;
  children?: ReactNode;
}) {
  const citations = useInstructCitations();
  if (!citations) return <>{children}</>;
  const {
    getCitationState,
    onCitationSelect,
    onCitationHover,
    labels,
    testId,
  } = citations;
  const { disabled, selected } = getCitationState(index);
  const hover = (over: boolean) => {
    if (!disabled) onCitationHover?.(over ? index : null);
  };
  const chip = (
    <button
      type="button"
      aria-label={labels.citation(index)}
      aria-disabled={disabled || undefined}
      aria-pressed={disabled ? undefined : selected}
      data-testid={testId ? `${testId}-citation` : undefined}
      data-citation={index}
      data-selected={selected && !disabled ? "true" : undefined}
      className={cn(
        "mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-[0.25rem] px-1 align-baseline text-xs leading-4 font-semibold",
        disabled
          ? "cursor-not-allowed bg-muted text-muted-foreground"
          : "cursor-pointer bg-primary/10 text-primary hover:bg-primary/20",
        selected && !disabled && "ring-1 ring-primary",
      )}
      onClick={() => {
        if (!disabled) onCitationSelect(index);
      }}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onFocus={() => hover(true)}
      onBlur={() => hover(false)}
    >
      {index}
    </button>
  );
  if (!disabled) return chip;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{labels.noLocation}</TooltipContent>
    </Tooltip>
  );
}

/** 이미지 대체 글자. Provider 밖이면 `labels.image` 가 없으므로 `alt` 만 보인다. */
function ImageAlt({ alt }: { alt: string }) {
  const citations = useInstructCitations();
  return (
    <span className="text-muted-foreground">
      {citations ? citations.labels.image(alt) : alt}
    </span>
  );
}

/**
 * 모듈 상수. react-markdown 은 `components.a` 를 요소 타입으로 쓰므로, 렌더마다 새 함수를 넘기면
 * 선택이 바뀔 때마다 모든 링크·칩이 다시 마운트돼 누른 칩의 포커스가 사라진다.
 */
const COMPONENTS: Components = {
  a: ({ href, children }) => {
    const index = citationIndexOf(href);
    if (index === null) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2"
        >
          {children}
        </a>
      );
    }
    return <CitationChip index={index}>{children}</CitationChip>;
  },
  img: ({ alt }) => (alt ? <ImageAlt alt={alt} /> : null),
};

/**
 * Instruct 출력 markdown 본문. `InstructMarkdown` 이 지연 로드한다(react-markdown 을 처음 그릴 때만 불러온다).
 */
export default function MarkdownBody({
  text,
  className,
  ...props
}: MarkdownBodyProps) {
  const withCitations = useInstructCitations() !== null;
  // 본문이 같으면 markdown 을 다시 파싱하지 않는다. 선택·hover 가 바뀌면 칩만 context 로 갱신된다.
  const content = useMemo(
    () => (
      <Markdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {withCitations ? citationMarkdown(text) : stripCitationMarkers(text)}
      </Markdown>
    ),
    [text, withCitations],
  );

  return (
    <div
      {...props}
      className={cn(
        "min-w-0 text-sm leading-6 break-words text-foreground",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold",
        "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-base [&_h3]:font-semibold",
        "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:font-semibold [&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:font-medium [&_h6]:mt-3 [&_h6]:mb-1",
        "[&_p]:my-2 [&_hr]:my-3 [&_hr]:border-border",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:my-0",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_strong]:font-semibold [&_s]:text-muted-foreground",
        "[&_code]:rounded-[0.25rem] [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_table]:my-2 [&_table]:block [&_table]:overflow-x-auto [&_table]:text-xs",
        "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      {content}
    </div>
  );
}
