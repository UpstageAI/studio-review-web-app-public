import type { Dispatch, SetStateAction } from "react";
import { useCallback, useState } from "react";
import * as matrix from "../drawing/matrix";
import * as rendering from "../drawing/rendering";
import type { Transform } from "../drawing/types";

/** transform 을 마지막으로 맞춘 입력 — 크기 네 값과 드래그 이동량. */
type PlacementInput = {
  canvasWidth: number;
  canvasHeight: number;
  imageWidth: number;
  imageHeight: number;
  offset: { x: number; y: number };
};

export const useImageRendering = ({
  imageScaleChangeHandler,
  setCssTransform,
}: {
  imageScaleChangeHandler: (scale: number) => void;
  setCssTransform: Dispatch<SetStateAction<string>>;
}) => {
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    rotation: 0,
    tx: 0,
    ty: 0,
    matrix: matrix.identity(),
  });
  const [canvasSize, setCanvasSize] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  const [offset, setMouseMoveOffset] = useState<{
    x: number;
    y: number;
  }>({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>(
    { width: 0, height: 0 },
  );

  /**
   * 크기가 바뀌면 화면에 맞추고, 드래그 이동량이 새로 들어오면 그만큼 옮긴다.
   *
   * effect 로 하면 바뀐 입력이 한 번 커밋된 뒤에야 transform 이 따라와, 그 사이
   * 화면에 이전 transform 이 남는다. 입력이 바뀐 렌더에서 바로 맞춘다. 비교는
   * effect 의존성처럼 값마다 Object.is 로 하고, 이동량은 객체가 바뀔 때마다 한
   * 번 옮긴다. 첫 렌더는 맞춘 적 없는 상태(null)로 시작해 마운트 때의 (0, 0)
   * 이동도 그대로 한다.
   */
  const [placedFor, setPlacedFor] = useState<PlacementInput | null>(null);
  const sizeChanged =
    placedFor === null ||
    !Object.is(placedFor.canvasWidth, canvasSize.width) ||
    !Object.is(placedFor.canvasHeight, canvasSize.height) ||
    !Object.is(placedFor.imageWidth, imageSize.width) ||
    !Object.is(placedFor.imageHeight, imageSize.height);
  const offsetChanged = placedFor === null || placedFor.offset !== offset;
  if (sizeChanged || offsetChanged) {
    setPlacedFor({
      canvasWidth: canvasSize.width,
      canvasHeight: canvasSize.height,
      imageWidth: imageSize.width,
      imageHeight: imageSize.height,
      offset,
    });

    // 크기를 모르는 동안(0 이하 — 마운트 직후엔 음수도 보고된다)은 계산하지
    // 않는다. 음수로 계산하면 배율이 음수가 되어 화면이 비어 버린다.
    const fitted =
      sizeChanged &&
      imageSize.width > 0 &&
      imageSize.height > 0 &&
      canvasSize.width > 0 &&
      canvasSize.height > 0
        ? rendering.getImageTransform(
            canvasSize.width,
            canvasSize.height,
            imageSize.width,
            imageSize.height,
          )
        : null;
    // 크기와 이동량이 한 렌더에 함께 바뀌면 맞춘 뒤에 옮긴다.
    let next = fitted ?? transform;
    if (offsetChanged) {
      next = rendering.panTo({ x: offset.x, y: offset.y, xform: next });
    }
    if (next !== transform) {
      setTransform(next);
      setCssTransform(rendering.getCssTransform(next));
    }
    if (fitted) imageScaleChangeHandler(fitted.scale);
  }

  const zoomTo = useCallback(
    (scale: number, anchorPoint?: { x: number; y: number }) => {
      const t = rendering.zoomTo({
        newScale: scale,
        anchorx: anchorPoint?.x ?? canvasSize.width / 2,
        anchory: anchorPoint?.y ?? canvasSize.height / 2,
        xform: transform,
      });
      setTransform(t);
      setCssTransform(rendering.getCssTransform(t));

      imageScaleChangeHandler(t.scale);
    },
    [
      canvasSize.width,
      canvasSize.height,
      transform,
      imageScaleChangeHandler,
      setCssTransform,
    ],
  );

  const rotateBy = useCallback(
    (degree: number) => {
      const anchorx = canvasSize.width / 2;
      const anchory = canvasSize.height / 2;

      // 기존 transform에서 맵핑한 픽셀에서 출발해서 추가 회전을 한다.
      // 따라서 anchorx, anchory 좌표는 함수 호출 시점에 화면에 보이는 좌표를 중점으로
      // 회전을 시킨다.
      const newXform = rendering.rotateBy({
        degree,
        xform: transform,
        anchorx,
        anchory,
      });
      setTransform(newXform);
      setCssTransform(rendering.getCssTransform(newXform));
    },
    [canvasSize.height, canvasSize.width, setCssTransform, transform],
  );

  /**
   * 이미지의 특정 지점을 화면 중앙에, 주어진 배율로 놓는다 (인용 bbox 맞춤용).
   * fitToScreen → zoomTo → panTo 를 이어 부르면 각 단계가 직전 transform 상태를
   * 읽어야 해 지연이 필요하지만, 여기서는 최종 transform 을 한 번에 적용한다.
   */
  const focusOn = useCallback(
    (params: {
      scale: number;
      centerX: number;
      centerY: number;
    }): Transform | null => {
      if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;

      const t = rendering.getFocusTransform({
        screenw: canvasSize.width,
        screenh: canvasSize.height,
        scale: params.scale,
        centerx: params.centerX,
        centery: params.centerY,
      });
      setTransform(t);
      setCssTransform(rendering.getCssTransform(t));
      imageScaleChangeHandler(t.scale);
      return t;
    },
    [canvasSize, imageScaleChangeHandler, setCssTransform],
  );

  /**
   * 현재 배율을 유지한 채 이미지 좌상단을 화면의 `(left, top)` 으로 옮긴다.
   * 휠로 페이지 안을 훑을 때 쓴다 — 이동량 누적(`canvasObjectMoveHandler`)은
   * 직전 이동이 화면에 반영돼야 다음 이동을 계산할 수 있어, 이벤트가 빠르게
   * 몰리면 이동이 뭉개진다.
   */
  const panToPosition = useCallback(
    (params: { left: number; top: number }): Transform | null => {
      if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;

      const t = rendering.getTranslatedTransform({
        scale: transform.scale,
        tx: params.left,
        ty: params.top,
      });
      setTransform(t);
      setCssTransform(rendering.getCssTransform(t));
      return t;
    },
    [canvasSize, transform.scale, setCssTransform],
  );

  /**
   * 현재 배율을 유지한 채 페이지의 위/아래 끝을 화면에 맞춘다 — 확대 상태로
   * 페이지를 넘길 때(스크롤·페이지 버튼) 읽던 배율을 지키기 위해 쓴다.
   */
  const alignPage = useCallback(
    (params: { scale: number; align: "top" | "bottom" }): Transform | null => {
      if (imageSize.width <= 0 || imageSize.height <= 0) return null;
      if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;

      const t = rendering.getAlignedTransform({
        screenw: canvasSize.width,
        screenh: canvasSize.height,
        imgw: imageSize.width,
        imgh: imageSize.height,
        scale: params.scale,
        align: params.align,
      });
      setTransform(t);
      setCssTransform(rendering.getCssTransform(t));
      imageScaleChangeHandler(t.scale);
      return t;
    },
    [canvasSize, imageSize, imageScaleChangeHandler, setCssTransform],
  );

  const fitToScreen = useCallback((): Transform | null => {
    if (imageSize.width <= 0 || imageSize.height <= 0) return null;
    if (canvasSize.width <= 0 || canvasSize.height <= 0) return null;

    const t = rendering.getImageTransform(
      canvasSize.width,
      canvasSize.height,
      imageSize.width,
      imageSize.height,
    );
    setTransform(t);
    setCssTransform(rendering.getCssTransform(t));
    imageScaleChangeHandler(t.scale);
    return t;
  }, [canvasSize, imageSize, imageScaleChangeHandler, setCssTransform]);

  return {
    canvasSizeChangeHandler: setCanvasSize,
    canvasObjectMoveHandler: setMouseMoveOffset,
    imageSizeChangeHandler: setImageSize,
    rotateBy,
    fitToScreen,
    alignPage,
    focusOn,
    panToPosition,
    zoomTo,
    imageSize,
    canvasSize,
    transform,
  };
};
