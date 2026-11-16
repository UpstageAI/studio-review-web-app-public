import { type RefObject, useEffect, useState } from "react";

type MovingMode = "ready" | "movable" | "moving" | "stop";
type ToolCursor = "cursor-default" | "cursor-grab" | "cursor-grabbing";

/**
 * 손 도구 — 누른 채 끌어 페이지를 옮긴다. `enabled`가 false면(페이지가 캔버스에
 * 다 들어와 옮길 곳이 없으면) 끌기를 받지 않고 커서도 기본 화살표로 둔다.
 */
export function useImageTool(
  canvas: RefObject<HTMLDivElement | null>,
  image: RefObject<HTMLCanvasElement | SVGSVGElement | null>,
  onMoveImage: (offset: { x: number; y: number }) => void,
  enabled = true,
) {
  const [mouseOrigin, setMouseOrigin] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });

  const [movingMode, setMovingMode] = useState<MovingMode>("stop");
  const [toolCursor, setToolCursor] = useState<ToolCursor>("cursor-grab");

  useEffect(() => {
    const mousedown = (e: MouseEvent) => {
      if (!enabled) return;
      if (movingMode === "stop") {
        setMovingMode("movable");
        setToolCursor("cursor-grabbing");
        const rc = image.current?.getBoundingClientRect() || {
          left: 0,
          top: 0,
        };
        const x = e.clientX - rc.left;
        const y = e.clientY - rc.top;
        setMouseOrigin({ x, y });
      }
    };
    const mouseup = () => {
      if (movingMode === "movable" || movingMode === "moving") {
        setMovingMode("stop");
        setToolCursor("cursor-grab");
      }
    };
    const mousemove = (e: MouseEvent) => {
      if (movingMode === "movable") {
        setMovingMode("moving");
        setToolCursor("cursor-grabbing");
      } else if (movingMode === "moving") {
        const rc = image.current?.getBoundingClientRect() || {
          left: 0,
          top: 0,
        };
        const x = e.clientX - rc.left;
        const y = e.clientY - rc.top;

        onMoveImage({
          x: x - mouseOrigin.x,
          y: y - mouseOrigin.y,
        });
      }
    };

    // 정리할 때는 등록한 요소에서 뗀다. 언마운트 정리 시점에는 ref 가 이미 비어 있다.
    const target = canvas.current;
    target?.addEventListener("mousedown", mousedown);
    target?.addEventListener("mouseup", mouseup);
    target?.addEventListener("mousemove", mousemove);

    return () => {
      target?.removeEventListener("mousedown", mousedown);
      target?.removeEventListener("mouseup", mouseup);
      target?.removeEventListener("mousemove", mousemove);
    };
  }, [canvas.current, image.current, movingMode, enabled]);

  return {
    // 끄는 중(누른 채)이 아니면 옮길 수 있을 때만 손 모양을 보인다.
    cursor:
      enabled || movingMode !== "stop"
        ? toolCursor
        : ("cursor-default" as const),
  };
}
