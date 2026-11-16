import React, { useMemo } from "react";
import type { HighlightValueWithId } from "../../../shared/types/highlight";
import {
  areRatioCoordinates,
  resolveFocusTarget,
} from "../../utils/bbox-utils";

interface HighlightPolygonProps {
  readonly highlight: HighlightValueWithId | null;
  readonly isSelected: boolean;
  readonly isHovered: boolean;
  readonly isBackground?: boolean;
  readonly pulse?: boolean;
  readonly replacement?: {
    text?: string;
    pending?: boolean;
    sourceText?: string;
  };
  /** 하이라이트에 `color`가 없을 때 쓰는 CSS 색 */
  readonly highlightColor: string;
  /** 하이라이트에 `word_coordinates_color`가 없을 때 쓰는 CSS 색 */
  readonly wordHighlightColor: string;
  readonly currentPageIndex: number;
  readonly actualImageSize: Readonly<{ width: number; height: number }>;
  readonly onHover?: (highlight: HighlightValueWithId | null) => void;
  readonly onClick?: (highlight: HighlightValueWithId | null) => void;
}

const getHighlightTheme = (
  // SVG fill·stroke 에 그대로 쓰는 CSS 색. 테마 토큰으로 풀지 않는다.
  color: string,
  isSelected: boolean,
  isHovered: boolean,
  isBackground = false,
) => {
  const fill = color;

  const opacity = isHovered
    ? 0.12
    : isSelected
      ? 0.14
      : isBackground
        ? 0.04
        : 0;
  const strokeOpacity = isHovered || isSelected ? 1 : isBackground ? 0.5 : 0;
  const strokeWidth = isHovered || isSelected ? 4 : isBackground ? 2 : 0;
  return {
    fill,
    // stroke는 fill과 동일한 색상을 사용하여 항상 유효한 색상이 되도록 지정
    stroke: fill,
    opacity,
    strokeOpacity,
    strokeWidth,
  };
};

/**
 * 하이라이트 데이터를 SVG path로 변환해 그려주는 컴포넌트
 */
export function HighlightPolygon({
  highlight,
  isSelected,
  isHovered,
  isBackground = false,
  pulse = false,
  replacement,
  highlightColor,
  wordHighlightColor,
  currentPageIndex,
  actualImageSize,
  onHover,
  onClick,
}: HighlightPolygonProps): React.JSX.Element | null {
  const hasMainPolygon = (highlight?.coordinates?.length ?? 0) >= 3;
  const hasWordPolygon =
    highlight?.word_coordinates?.some(coordinates => coordinates.length >= 3) ??
    false;
  const shouldRender =
    Boolean(highlight) &&
    (hasMainPolygon || hasWordPolygon) &&
    highlight?.page === currentPageIndex + 1;

  const { pathData, theme } = useMemo(() => {
    // 하이라이트가 준 색이 먼저다. 없으면 뷰어의 기본 색을 쓴다.
    const color = highlight?.color || highlightColor;
    if (!highlight) {
      return {
        pathData: "",
        theme: getHighlightTheme(color, isSelected, isHovered, isBackground),
      };
    }

    const isRatioCoordinates = areRatioCoordinates(highlight.coordinates);
    const points = toHighlightPoints({
      coordinates: highlight.coordinates,
      actualImageSize,
      isRatioCoordinates,
    });

    const path = toSvgPath(points);
    return {
      pathData: path,
      theme: getHighlightTheme(color, isSelected, isHovered, isBackground),
    };
  }, [
    actualImageSize,
    highlight,
    highlightColor,
    isSelected,
    isHovered,
    isBackground,
  ]);

  const replacementBounds = useMemo(() => {
    if (!replacement || !highlight || !hasMainPolygon) return null;
    const points = toHighlightPoints({
      coordinates: highlight.coordinates,
      actualImageSize,
      isRatioCoordinates: areRatioCoordinates(highlight.coordinates),
    });
    if (points.length === 0) return null;
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      width: Math.max(12, Math.max(...xs) - x),
      height: Math.max(12, Math.max(...ys) - y),
    };
  }, [actualImageSize, hasMainPolygon, highlight, replacement]);

  const replacementLayout = useMemo(() => {
    if (!replacementBounds || !replacement?.text) return null;
    return fitReplacementText({
      text: replacement.text,
      sourceText: replacement.sourceText,
      width: replacementBounds.width,
      height: replacementBounds.height,
    });
  }, [replacement, replacementBounds]);

  // Word coordinates paths 계산 (새로운)
  const wordPaths = useMemo(() => {
    if (
      !highlight?.word_coordinates ||
      highlight.word_coordinates.length === 0
    ) {
      return [];
    }

    // main polygon이 있으면 word 좌표도 그 단위를 상속하고, word-only이면
    // 포커스와 동일하게 실제 word 좌표에서 단위를 추론한다.
    const isRatioCoordinates =
      resolveFocusTarget(highlight)?.isRatioCoordinates ?? false;

    return highlight.word_coordinates.flatMap((wordCoords, index) => {
      if (wordCoords.length < 3) return [];
      const points = toHighlightPoints({
        coordinates: wordCoords,
        actualImageSize,
        isRatioCoordinates,
      });
      return {
        id: `${highlight.id}-word-${index}`,
        pathData: toSvgPath(points),
      };
    });
  }, [highlight, actualImageSize]);

  // Word bbox 테마: highlight.word_coordinates_color 사용
  const wordTheme = useMemo(() => {
    if (wordPaths.length === 0) return null;

    // highlight 객체의 word_coordinates_color 사용 (데이터 레벨 색상)
    return getHighlightTheme(
      highlight?.word_coordinates_color || wordHighlightColor,
      isSelected,
      isHovered,
      false,
    );
  }, [highlight, wordHighlightColor, wordPaths, isSelected, isHovered]);

  if (!shouldRender || !highlight) {
    return null;
  }

  const handleMouseEnter = () => {
    if (!onHover) return;
    onHover(highlight);
  };

  const handleMouseLeave = () => {
    if (!onHover) return;
    onHover(null);
  };

  const handleClick = () => {
    if (!onClick) return;

    // 이미 선택된 다른 하이라이트 해제
    onClick(null);
    if (onHover) {
      onHover(null);
    }

    onClick(highlight);
  };

  return (
    <g style={pulse ? { animation: "pulse 0.55s ease-in-out 2" } : undefined}>
      {/* 기존 main coordinates bbox */}
      {hasMainPolygon ? (
        <path
          data-highlight-id={highlight.id}
          data-selected={isSelected ? "true" : "false"}
          data-pulse={pulse ? "true" : "false"}
          d={pathData}
          fill={theme.fill}
          fillOpacity={theme.opacity}
          stroke={theme.stroke}
          strokeOpacity={theme.strokeOpacity}
          strokeWidth={theme.strokeWidth}
          strokeLinejoin="round"
          // zoom(축소/확대)에 영향을 받지 않고 항상 일정한 두께로 보이도록 설정
          vectorEffect="non-scaling-stroke"
          style={{ cursor: "pointer" }}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        />
      ) : null}

      {replacementBounds && (
        <foreignObject
          x={replacementBounds.x}
          y={replacementBounds.y}
          width={replacementBounds.width}
          height={replacementBounds.height}
          style={{ pointerEvents: "none", overflow: "hidden" }}
        >
          <div
            data-testid={`translation-replacement-${highlight.id}`}
            style={{
              boxSizing: "border-box",
              display: "flex",
              height: "100%",
              width: "100%",
              flexDirection: "column",
              justifyContent: "center",
              overflow: "hidden",
              background: "#ffffff",
              color: "#171717",
              fontFamily: replacementLayout?.monospace
                ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
                : "Inter, Pretendard, Arial, sans-serif",
              fontSize: `${replacementLayout?.fontSize ?? 7}px`,
              fontWeight: replacementLayout?.emphasized ? 600 : 400,
              letterSpacing: replacementLayout?.monospace ? "-0.02em" : 0,
              lineHeight: replacementLayout?.lineHeight ?? 1.16,
              padding: `${replacementLayout?.padding ?? 2}px`,
              textAlign: replacementLayout?.centered ? "center" : "left",
              WebkitFontSmoothing: "antialiased",
            }}
          >
            {replacement?.pending ? (
              <>
                <span
                  className="bg-muted"
                  style={{
                    display: "block",
                    height: "28%",
                    width: "92%",
                    borderRadius: 3,
                  }}
                />
                <span
                  className="bg-muted"
                  style={{
                    display: "block",
                    height: "28%",
                    width: "68%",
                    marginTop: 4,
                    borderRadius: 3,
                  }}
                />
              </>
            ) : (
              replacementLayout?.lines.map((line, index) => (
                <span
                  key={index}
                  style={{ display: "block", whiteSpace: "pre" }}
                >
                  {line || "\u00a0"}
                </span>
              ))
            )}
          </div>
        </foreignObject>
      )}

      {/* Word coordinates bboxes */}
      {wordTheme &&
        wordPaths.map(({ id, pathData }) => (
          <path
            key={id}
            d={pathData}
            fill={wordTheme.fill}
            fillOpacity={wordTheme.opacity}
            stroke={wordTheme.stroke}
            strokeOpacity={wordTheme.strokeOpacity}
            strokeWidth={wordTheme.strokeWidth / 2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            style={{
              cursor: "pointer",
              pointerEvents: hasMainPolygon ? "none" : "auto",
            }}
            onMouseEnter={hasMainPolygon ? undefined : handleMouseEnter}
            onMouseLeave={hasMainPolygon ? undefined : handleMouseLeave}
            onClick={hasMainPolygon ? undefined : handleClick}
          />
        ))}
    </g>
  );
}

function toHighlightPoints({
  coordinates,
  actualImageSize,
  isRatioCoordinates,
}: {
  coordinates: HighlightValueWithId["coordinates"];
  actualImageSize: { width: number; height: number };
  isRatioCoordinates: boolean;
}): Array<[number, number]> {
  if (!coordinates) return [];

  if (
    isRatioCoordinates &&
    actualImageSize.width > 0 &&
    actualImageSize.height > 0
  ) {
    return coordinates.map(coord => [
      coord.x * actualImageSize.width,
      coord.y * actualImageSize.height,
    ]);
  }

  return coordinates.map(coord => [coord.x, coord.y]);
}

function toSvgPath(points: Array<[number, number]>): string {
  if (!points || points.length === 0) return "";
  const pathStr = points.map(p => `${p[0]},${p[1]}`).join(" L ");
  return `M ${pathStr} Z`;
}

type ReplacementTextLayout = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  padding: number;
  centered: boolean;
  emphasized: boolean;
  monospace: boolean;
};

function characterWidthUnits(character: string): number {
  if (/\s/u.test(character)) return 0.34;
  // Latin-1(U+00FF) 밖의 문자는 한 칸 폭으로 센다.
  if (/[\u0100-\u{10ffff}]/u.test(character)) return 1;
  if (/[ilI1.,:;'|!]/u.test(character)) return 0.3;
  if (/[mwMW@#%&]/u.test(character)) return 0.86;
  return 0.56;
}

function textWidthUnits(value: string): number {
  return Array.from(value).reduce(
    (total, character) => total + characterWidthUnits(character),
    0,
  );
}

function splitLongToken(token: string, maxUnits: number): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let units = 0;
  for (const character of Array.from(token)) {
    const characterUnits = characterWidthUnits(character);
    if (chunk && units + characterUnits > maxUnits) {
      chunks.push(chunk);
      chunk = character;
      units = characterUnits;
    } else {
      chunk += character;
      units += characterUnits;
    }
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function wrapReplacementLine(value: string, maxUnits: number): string[] {
  if (!value) return [""];
  if (textWidthUnits(value) <= maxUnits) return [value];
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const chunks =
      textWidthUnits(word) > maxUnits ? splitLongToken(word, maxUnits) : [word];
    for (const chunk of chunks) {
      const candidate = line ? `${line} ${chunk}` : chunk;
      if (line && textWidthUnits(candidate) > maxUnits) {
        lines.push(line);
        line = chunk;
      } else {
        line = candidate;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

function wrapReplacementText(value: string, maxUnits: number): string[] {
  return value
    .split(/\r?\n/)
    .flatMap(line => wrapReplacementLine(line.trim(), maxUnits));
}

function fitReplacementText({
  text,
  sourceText,
  width,
  height,
}: {
  text: string;
  sourceText?: string;
  width: number;
  height: number;
}): ReplacementTextLayout {
  const source = sourceText ?? "";
  const explicitLines = Math.max(1, text.split(/\r?\n/).length);
  const padding = Math.max(1, Math.min(4, Math.min(width, height) * 0.045));
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const lineHeight = 1.14;
  const monospace = /[|]|<table|\b(?:KIOSK|NO\s*:|Amount|Number)\b/iu.test(
    `${source}\n${text}`,
  );
  const widthSafetyFactor = monospace ? 1.12 : 1.04;
  const maxFontSize = Math.max(
    4,
    Math.min(64, height * 0.7, availableHeight / (explicitLines * lineHeight)),
  );
  let fontSize = maxFontSize;
  let lines = wrapReplacementText(
    text,
    availableWidth / (fontSize * widthSafetyFactor),
  );

  while (
    fontSize > 3 &&
    lines.length * fontSize * lineHeight > availableHeight
  ) {
    fontSize -= 0.5;
    lines = wrapReplacementText(
      text,
      availableWidth / (fontSize * widthSafetyFactor),
    );
  }

  const centered =
    explicitLines === 1 &&
    !/[|:]/u.test(source) &&
    textWidthUnits(text) * fontSize <= availableWidth * 1.8;
  return {
    lines,
    fontSize: Math.max(3, Math.round(fontSize * 10) / 10),
    lineHeight,
    padding,
    centered,
    emphasized: centered && explicitLines === 1,
    monospace,
  };
}
