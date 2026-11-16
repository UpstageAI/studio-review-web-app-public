"use client";

/**
 * Image Viewer Components
 *
 * Components for viewing and interacting with document images
 */

export { default as ImageViewerSection } from "./components";
export type { ImageViewerSectionProps, TranslateFunction } from "./components";

// Re-export the highlight contract used by viewer consumers.
export type {
  HighlightValue,
  HighlightValueWithId,
} from "../shared/types/highlight";

/** 인용 bbox 맞춤 축 — 소비처가 뷰어 프로퍼티로 넘긴다. */
export type { BboxFitAxis } from "./utils/bbox-utils";
