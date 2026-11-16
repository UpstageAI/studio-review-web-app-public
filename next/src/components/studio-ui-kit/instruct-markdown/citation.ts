export const CITATION_MARKER_PATTERN = /(?:【†(\d+)】|\[†(\d+)\])/g;

/** 인용 칩 링크 접두사. */
export const CITATION_HREF_PREFIX = "#cite-";

/** 인용 표식을 markdown 링크 `[†n](#cite-n)` 로 바꾼다. 렌더러가 `#cite-` 링크를 인용 칩으로 그린다. */
export function citationMarkdown(text: string): string {
  return text.replace(
    CITATION_MARKER_PATTERN,
    (_match, a: string | undefined, b: string | undefined) => {
      const n = a ?? b ?? "";
      return `[†${n}](${CITATION_HREF_PREFIX}${n})`;
    },
  );
}

/** 인용 표식을 지운다. 인용 데이터 없이 그릴 때 표식 대신 글만 남긴다. */
export function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER_PATTERN, "");
}

/** `#cite-n` → n. 아니면 `null`. */
export function citationIndexOf(href: string | undefined): number | null {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return null;
  const text = href.slice(CITATION_HREF_PREFIX.length);
  return /^\d+$/.test(text) ? Number(text) : null;
}
