import { memo, useEffect, useMemo, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { tableNodesFromHtml } from "./parse-table-html";

export interface ParseTableLabels {
  /** 표 영역(`role="region"`)의 접근성 이름 */
  region: string;
  /**
   * 표 안 그림 자리에 보일 대체 글자(`alt` 를 받는다). 이 함수의 identity 가 바뀌면 다시 파싱하므로 호출자는
   * 고정해 넘긴다.
   */
  image: (alt: string) => string;
}

type ParseTableBaseProps = Omit<
  ComponentProps<"div">,
  "children" | "onClick" | "ref"
> & {
  /** Parse 표 요소의 `content.html`. 허용 목록으로 다시 만들어 그린다. */
  html: string;
  labels: ParseTableLabels;
  /** 루트 `data-testid`. */
  testId?: string;
};

/**
 * `id` 를 주면 콜백이 그 값을 받고, 주지 않으면 인자 없이 불린다. 콜백은 선택이다 — `onActivate` 가 없으면
 * 영역을 눌러도 아무 일도 없고, `onUnrenderable` 이 없으면 그릴 수 없음을 알리지 않는다.
 */
export type ParseTableProps = ParseTableBaseProps &
  (
    | {
        id: string;
        /** 표 영역을 누를 때(영역 안 글자를 고른 상태의 클릭은 제외). */
        onActivate?: (id: string) => void;
        /** 표로 그릴 수 없을 때(표가 없음·변환 실패). 같은 입력이면 한 번만. */
        onUnrenderable?: (id: string) => void;
      }
    | {
        id?: undefined;
        onActivate?: () => void;
        onUnrenderable?: () => void;
      }
  );

type Callback = ((id?: string) => void) | undefined;

const call = (callback: Callback, id: string | undefined) => {
  if (!callback) return;
  if (id === undefined) callback();
  else callback(id);
};

/** 영역 안에서 글자를 고르는 중인지(드래그로 고른 뒤의 클릭은 행 선택으로 보지 않는다). */
function hasSelectionWithin(element: HTMLElement): boolean {
  const selection = element.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString()) {
    return false;
  }
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(element)) return true;
  }
  return false;
}

/**
 * Parse 표 요소의 `content.html` 을 허용 목록으로 다시 만든 표. 같은 `html`·`labels.image` 이면 다시 파싱하지
 * 않는다. 그릴 수 없으면(표가 없음·변환 실패) 아무것도 그리지 않고 `onUnrenderable` 로 알린다.
 * 목록의 보조 자리는 클릭해도 행이 선택되지 않으므로 표 영역 클릭을 `onActivate` 로 잇는다. 키보드
 * 사용자는 행 머리의 라벨 버튼으로 고르고, 영역 자체는 가로 스크롤을 위해 초점만 받는다.
 */
export const ParseTable = memo(function ParseTable({
  id,
  html,
  labels,
  onActivate,
  onUnrenderable,
  testId,
  className,
  ...props
}: ParseTableProps) {
  const region = useRef<HTMLDivElement>(null);
  const imageLabel = labels.image;
  const nodes = useMemo(
    () => tableNodesFromHtml(html, { image: imageLabel }),
    [html, imageLabel],
  );
  const unrenderable = nodes === null;

  useEffect(() => {
    if (unrenderable) call(onUnrenderable as Callback, id);
  }, [id, onUnrenderable, unrenderable]);

  if (unrenderable) return null;
  return (
    <div
      {...props}
      ref={region}
      role="region"
      aria-label={labels.region}
      tabIndex={0}
      onClick={
        onActivate
          ? () => {
              if (region.current && hasSelectionWithin(region.current)) return;
              call(onActivate as Callback, id);
            }
          : undefined
      }
      className={cn(
        "max-w-full overflow-x-auto rounded-[0.25rem] text-xs leading-5 whitespace-pre-wrap break-words text-foreground",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden",
        "[&_table]:border-collapse",
        "[&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_td]:align-top",
        className,
      )}
      data-testid={testId}
    >
      {nodes}
    </div>
  );
});
