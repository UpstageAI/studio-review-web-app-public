import { Slider } from "./slider";
import { MAX_ZOOM_RATIO, MIN_ZOOM_RATIO } from "../constants/image-viewer";
import { useMemo } from "react";
import { Icons } from "../../shared/ui/icon/icon";
import { BaseIcon } from "../../shared/ui/icon/base-icon";

export interface ToolZoomProps {
  imageScale: number;
  onClickZoomIn: () => void;
  onClickZoomOut: () => void;
  onImageHandler: (imageScale: number) => void;
}

function parseTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds - hours * 3600) / 60);
  const secs = seconds - hours * 3600 - minutes * 60;
  return [hours, minutes, secs];
}

function formatHumanTime(seconds: number) {
  const [h, m, s] = parseTime(seconds);
  return `${h} hour${h === 1 ? "" : "s"}, ${m} minute${m === 1 ? "" : "s"}, ${s} second${s === 1 ? "" : "s"}`;
}

// imageScale이 유효하지 않으면 기본값 사용
function getValidScale(scale: number) {
  if (isNaN(scale) || !isFinite(scale) || scale < MIN_ZOOM_RATIO) {
    return MIN_ZOOM_RATIO;
  }
  if (scale > MAX_ZOOM_RATIO) {
    return MAX_ZOOM_RATIO;
  }
  return scale;
}

function calculateToolbarValue(scale: number) {
  const validScale = getValidScale(scale);
  const result = Math.log10(validScale * 100) * 1000;
  // NaN이나 Infinity를 방지
  if (!isFinite(result)) {
    return Math.log10(MIN_ZOOM_RATIO * 100) * 1000;
  }
  return result;
}

export function ToolZoom({
  imageScale,
  onClickZoomIn,
  onClickZoomOut,
  onImageHandler,
}: ToolZoomProps): React.ReactElement {
  const toolbarValue = useMemo(
    () => [calculateToolbarValue(imageScale)],
    [imageScale],
  );

  return (
    <div className="flex h-8 w-full min-w-0 items-center justify-center">
      {/* 버튼 크기는 유지하고 슬라이더만 더 짧게 수축해 분할 최소 폭을 확보한다. */}
      <div className="flex h-full w-full max-w-[320px] min-w-0 items-center justify-center gap-0.5 [@container(max-width:22rem)]:gap-0">
        <button
          onClick={() => onClickZoomOut()}
          type="button"
          aria-label="Zoom out"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BaseIcon source={Icons.ZoomOut} className="h-4 w-4" />
        </button>
        <div
          className="flex min-w-6 flex-1 items-center px-1.5 [@container(max-width:22rem)]:hidden"
          data-testid="image-toolbar-zoom-slider"
        >
          <Slider
            label="zoom"
            minValue={Math.log10(MIN_ZOOM_RATIO * 100) * 1000}
            maxValue={Math.log10(MAX_ZOOM_RATIO * 100) * 1000}
            step={1}
            value={toolbarValue}
            onChange={([value]) => {
              let nextValue = Math.pow(10, value / 1000) / 100;
              if (nextValue < MIN_ZOOM_RATIO) {
                nextValue = MIN_ZOOM_RATIO;
              }
              if (nextValue > MAX_ZOOM_RATIO) {
                nextValue = MAX_ZOOM_RATIO;
              }
              onImageHandler(nextValue);
            }}
            onChangeEnd={() => {}}
            numberFormatter={{ format: formatHumanTime } as Intl.NumberFormat}
            onChangeStart={() => {}}
          />
        </div>
        <button
          onClick={() => onClickZoomIn()}
          type="button"
          aria-label="Zoom in"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <BaseIcon source={Icons.ZoomIn} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
