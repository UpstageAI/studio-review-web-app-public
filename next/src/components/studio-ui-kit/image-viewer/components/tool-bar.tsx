import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Icons } from "../../shared/ui/icon/icon";
import { MAX_ZOOM_RATIO, MIN_ZOOM_RATIO } from "../constants/image-viewer";
import { ToolZoom } from "./tool-zoom";
import { BaseIcon } from "../../shared/ui/icon/base-icon";
import { ExpandIcon } from "lucide-react";

const ICON_BUTTON_CLASS_NAME =
  "inline-flex h-7 w-7 min-w-0 cursor-pointer appearance-none items-center justify-center whitespace-nowrap rounded-md border-0 bg-transparent p-0 text-sm font-medium leading-6 text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:opacity-90 focus:outline-hidden focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-hidden active:opacity-90 disabled:pointer-events-none disabled:cursor-default disabled:opacity-35";
const TOOL_ICON_BUTTON_CLASS_NAME = `${ICON_BUTTON_CLASS_NAME} hover:shadow-xs`;

export interface ImageViewToolbarProps {
  fileVisible: boolean;
  imageScale: number;
  onImageScaleChange: (scale: number) => void;
  numberOfPages: number;
  pageIndex: number;
  onPageSelect: (index: number) => void;
  onRotate?(): void;
  onReset?(): void;
  testId?: string;
}

export function ImageViewToolbar({
  fileVisible,
  imageScale,
  onImageScaleChange,
  numberOfPages,
  pageIndex,
  onPageSelect,
  onRotate,
  onReset,
  testId,
}: ImageViewToolbarProps): React.ReactElement {
  const [inputValue, setInputValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const cancelPageEditRef = useRef(false);

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    cancelPageEditRef.current = false;
    setInputValue(String(pageIndex + 1));
    setIsFocused(true);
    e.target.select();
  };

  const handleBlur = () => {
    const parsed = parseInt(inputValue, 10);
    if (
      !cancelPageEditRef.current &&
      !isNaN(parsed) &&
      parsed >= 1 &&
      parsed <= numberOfPages
    ) {
      onPageSelect(parsed - 1);
    }
    cancelPageEditRef.current = false;
    setIsFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      // blur fires before React commits state updates from this key event.
      cancelPageEditRef.current = true;
      e.currentTarget.blur();
    }
  };

  return (
    <div
      className={cn(
        // 헤더와 같은 배경·얇은 구분선으로 문서 프레임을 닫는다. 컨테이너
        // 쿼리는 분할 칸의 실제 폭을 기준으로 툴바 밀도를 조절한다.
        "flex min-h-[52px] w-full items-center border-t border-border bg-background/95 px-2 py-2 [container-type:inline-size] [@container(max-width:22rem)]:px-1",
        !fileVisible && "invisible",
      )}
      data-testid={testId || "image-view-toolbar"}
    >
      <div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 [@container(max-width:22rem)]:gap-0.5">
        {/* 기능별로 작고 동일한 컨트롤 표면을 사용한다. 강한 외곽선 대신
            muted 배경만 두어 문서보다 툴바가 먼저 보이지 않게 한다. */}
        <div className="relative flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-muted/60 p-0.5 [@container(max-width:22rem)]:gap-0 [@container(max-width:22rem)]:p-0">
          {/* 회전을 지원하지 않는 뷰어(이어서 스크롤)에서는 버튼을 두지 않는다 —
              눌러도 아무 일도 없는 버튼은 고장으로 보인다. */}
          {onRotate && (
            <button
              type="button"
              onClick={onRotate}
              className={TOOL_ICON_BUTTON_CLASS_NAME}
              aria-label="Rotate clockwise"
              data-testid={
                testId
                  ? `${testId}-rotate-button`
                  : "image-toolbar-rotate-button"
              }
            >
              <BaseIcon source={Icons.Rotate} className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onReset}
            className={TOOL_ICON_BUTTON_CLASS_NAME}
            aria-label="Fit to view"
            data-testid={
              testId ? `${testId}-reset-button` : "image-toolbar-reset-button"
            }
          >
            <ExpandIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-w-0 justify-center">
          <ToolZoom
            imageScale={imageScale}
            onClickZoomIn={() => {
              if (imageScale * 1.1 < MAX_ZOOM_RATIO) {
                onImageScaleChange(imageScale * 1.1);
              }
            }}
            onClickZoomOut={() => {
              if (imageScale * 0.9 > MIN_ZOOM_RATIO) {
                onImageScaleChange(imageScale * 0.9);
              }
            }}
            onImageHandler={onImageScaleChange}
          />
        </div>

        <span className="grid h-8 shrink-0 grid-cols-[1.75rem_minmax(3rem,auto)_1.75rem] items-center rounded-lg bg-muted/60 p-0.5">
          <button
            type="button"
            className={ICON_BUTTON_CLASS_NAME}
            disabled={pageIndex <= 0}
            aria-label="Previous page"
            onClick={() => {
              const prevPage = Math.max(pageIndex - 1, 0);
              onPageSelect(prevPage);
            }}
            data-testid={
              testId ? `${testId}-prev-page` : "image-toolbar-prev-page"
            }
          >
            <BaseIcon source={Icons.ChevronUp} className="h-3.5 w-3.5" />
          </button>

          <span className="grid min-w-[3.75rem] grid-cols-[1.75rem_auto_1.75rem] items-center justify-items-center tabular-nums">
            {numberOfPages > 1 ? (
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={isFocused ? inputValue : String(pageIndex + 1)}
                onChange={e => setInputValue(e.target.value.replace(/\D/g, ""))}
                onFocus={handleFocus}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                aria-label="Current page"
                className="h-6 w-7 cursor-text rounded-md border-0 bg-transparent p-0 text-center text-[11px] font-medium leading-6 text-foreground shadow-none outline-hidden ring-0 transition-[background-color,box-shadow] hover:bg-background hover:shadow-xs hover:ring-1 hover:ring-border/60 focus:bg-background focus:shadow-xs focus:ring-2 focus:ring-primary/30"
                data-testid={
                  testId ? `${testId}-page-input` : "image-toolbar-page-input"
                }
              />
            ) : (
              <span
                className="h-6 w-7 text-center text-[11px] font-medium leading-6 text-foreground"
                data-testid={
                  testId ? `${testId}-page-label` : "image-toolbar-page-label"
                }
              >
                {pageIndex + 1}
              </span>
            )}

            <span className="text-[11px] text-muted-foreground">/</span>
            <span
              className="justify-self-center text-[11px] text-muted-foreground"
              data-testid={
                testId ? `${testId}-page-total` : "image-toolbar-page-total"
              }
            >
              {numberOfPages}
            </span>
          </span>

          <button
            type="button"
            className={ICON_BUTTON_CLASS_NAME}
            disabled={pageIndex >= numberOfPages - 1}
            aria-label="Next page"
            onClick={() => {
              const nextPage = Math.min(pageIndex + 1, numberOfPages - 1);
              onPageSelect(nextPage);
            }}
            data-testid={
              testId ? `${testId}-next-page` : "image-toolbar-next-page"
            }
          >
            <BaseIcon source={Icons.ChevronDown} className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}
