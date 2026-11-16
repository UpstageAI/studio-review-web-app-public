"use client";

import { useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";
import type { DocumentElementListItem } from "./document-element-list";

type RevealTarget = {
  id: string;
  element: HTMLElement;
  delivered: boolean;
};

/** A ready selection is a request; changing presentation is not. */
export function useItemReveal(
  selectedId: string | null,
  items: readonly DocumentElementListItem[],
  elements: RefObject<Map<string, HTMLElement>>,
  onRevealItem?: (element: HTMLElement, item: DocumentElementListItem) => void,
) {
  const previous = useRef<{
    id: string | null;
    element: HTMLElement | null;
  } | null>(null);
  const request = useRef<RevealTarget | null>(null);

  // Inspect committed DOM on every commit. Cleanup cancels obsolete frames;
  // pending requests can be rescheduled, including StrictMode's setup replay.
  useLayoutEffect(() => {
    const item = items.find(candidate => candidate.id === selectedId);
    const element = item ? (elements.current.get(item.id) ?? null) : null;
    if (
      !previous.current ||
      previous.current.id !== selectedId ||
      previous.current.element !== element
    ) {
      previous.current = { id: selectedId, element };
      request.current =
        item && element
          ? { id: item.id, element, delivered: !onRevealItem }
          : null;
    }

    const pending = request.current;
    if (!pending || pending.delivered) return;
    if (!onRevealItem) {
      pending.delivered = true;
      return;
    }

    let active = true;
    const frame = requestAnimationFrame(() => {
      if (
        !active ||
        request.current !== pending ||
        selectedId !== pending.id ||
        !item ||
        elements.current.get(pending.id) !== pending.element ||
        !pending.element.isConnected
      ) {
        return;
      }
      pending.delivered = true;
      onRevealItem(pending.element, item);
    });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  });
}
