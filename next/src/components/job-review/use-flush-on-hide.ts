"use client";

import { useEffect, useRef } from "react";
import { subscribeHide } from "./flush-on-hide";

/**
 * 페이지가 숨겨지거나 내려가기 직전에 `onHide` 를 부른다. 리스너는 마운트 때 한 번 걸고
 * 언마운트 때 풀며, 콜백은 늘 최신 것을 부른다(렌더마다 다시 걸지 않는다).
 */
export function useFlushOnHide(onHide: () => void): void {
  const ref = useRef(onHide);
  useEffect(() => {
    ref.current = onHide;
  });
  useEffect(() => subscribeHide(window, document, () => ref.current()), []);
}
