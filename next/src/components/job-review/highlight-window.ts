import type { HighlightLike, PageRef } from "@/lib/review-model";
import type { FileEntry } from "./job-review-state";
import { HIGHLIGHT_CHUNK, HIGHLIGHT_WINDOW } from "./large-job";

// 뷰어 현재 페이지 주변만 다루는 순수 계산: 어느 하이라이트 묶음을 받아야 하는지, 그 묶음들의
// 상태, 뷰어에 넘길 하이라이트 창. React·fetch 없음.

/** 현재 페이지 앞뒤로 미리 받아 두는 뷰어 페이지 수(묶음 절반). */
const LOOKAHEAD = HIGHLIGHT_CHUNK / 2;

/** 페이지가 속한 묶음의 시작 페이지(1, 21, 41, …). */
export function chunkStartOf(page: number): number {
  return Math.floor((page - 1) / HIGHLIGHT_CHUNK) * HIGHLIGHT_CHUNK + 1;
}

export type HighlightChunkRequest = {
  fileRef: string;
  fileId: string;
  /** 묶음 시작 페이지(파일 로컬). */
  chunk: number;
  /** 요청 범위(파일 로컬, 양끝 포함). 끝은 파일 쪽수를 넘지 않는다. */
  from: number;
  to: number;
};

type WindowChunk = { ref: PageRef; entry: FileEntry; chunk: number };

/**
 * 뷰어 `[sel - LOOKAHEAD, sel + LOOKAHEAD]` 안 페이지가 속한 (파일, 묶음) 쌍을 중복 없이,
 * 페이지 순서로. 파일 상태가 `ready`·`not_ready` 인 것만(이미지를 아직 받는 중이면 묶음도 기다린다).
 */
function windowChunks(
  docPages: readonly PageRef[],
  selectedPageIndex: number,
  files: Readonly<Record<string, FileEntry>>,
): WindowChunk[] {
  const first = Math.max(0, selectedPageIndex - LOOKAHEAD);
  const last = Math.min(docPages.length - 1, selectedPageIndex + LOOKAHEAD);
  const seen = new Set<string>();
  const out: WindowChunk[] = [];
  for (let index = first; index <= last; index += 1) {
    const ref = docPages[index];
    if (!ref) continue;
    const entry = Object.hasOwn(files, ref.file_ref)
      ? files[ref.file_ref]
      : undefined;
    if (!entry || (entry.status !== "ready" && entry.status !== "not_ready")) {
      continue;
    }
    const chunk = chunkStartOf(ref.page);
    const key = `${ref.file_ref}\u0000${chunk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ref, entry, chunk });
  }
  return out;
}

/** 현재 창 안에서 아직 요청하지 않은 묶음. `parseChunks` 에 상태가 있으면(로딩·완료·실패) 다시 요청하지 않는다. */
export function wantedHighlightChunks(
  docPages: readonly PageRef[],
  selectedPageIndex: number,
  files: Readonly<Record<string, FileEntry>>,
): HighlightChunkRequest[] {
  return windowChunks(docPages, selectedPageIndex, files).flatMap(
    ({ ref, entry, chunk }) => {
      if (entry.parseChunks[chunk] !== undefined) return [];
      const last = chunk + HIGHLIGHT_CHUNK - 1;
      return [
        {
          fileRef: ref.file_ref,
          fileId: entry.fileId,
          chunk,
          from: chunk,
          to: entry.numPages === null ? last : Math.min(last, entry.numPages),
        },
      ];
    },
  );
}

export type HighlightsStatus = "idle" | "loading" | "error";

/** 현재 창 안 묶음 중 하나라도 받는 중이면 `loading`, 아니면 하나라도 실패했으면 `error`. */
export function highlightsStatusFor(
  docPages: readonly PageRef[],
  selectedPageIndex: number,
  files: Readonly<Record<string, FileEntry>>,
): HighlightsStatus {
  let status: HighlightsStatus = "idle";
  for (const { entry, chunk } of windowChunks(
    docPages,
    selectedPageIndex,
    files,
  )) {
    const chunkStatus = entry.parseChunks[chunk];
    if (chunkStatus === "loading") return "loading";
    if (chunkStatus === "error") status = "error";
  }
  return status;
}

/**
 * 뷰어에 넘길 하이라이트: 현재 페이지 ± `HIGHLIGHT_WINDOW` 쪽과 선택·호버된 것. 전부 통과하면 입력
 * 배열을 그대로 돌려준다(객체 정체성 유지).
 */
export function viewerHighlightsFor<T extends HighlightLike>(
  highlights: T[],
  selectedPageIndex: number,
  selectedId: string | null,
  hoveredId: string | null,
): T[] {
  const keep = (highlight: T) =>
    Math.abs(highlight.page - 1 - selectedPageIndex) <= HIGHLIGHT_WINDOW ||
    highlight.id === selectedId ||
    highlight.id === hoveredId;
  return highlights.every(keep) ? highlights : highlights.filter(keep);
}
