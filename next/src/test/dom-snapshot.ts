/**
 * 렌더 테스트의 DOM 스냅샷용 직렬화. `mock/dom-snapshot.mjs` 와 같은 규칙으로 실행마다 달라지는 값을
 * 자리 표시로 바꾼다 — React `useId`(`_r_1_`·`«r1»`·`:r1:`)와 Radix 의 `radix-…` id 는 처음 나온
 * 순서대로 `id-1`, `id-2` … 로, blob URL 은 `blob:1` … 로. 같은 id 를 가리키는 속성끼리는 같은 자리
 * 표시가 되므로 `aria-describedby`·`aria-controls` 연결은 스냅샷에 남는다. 테스트를 골라 돌려도
 * (`-t`) 결과가 같도록 `useId` 의 전역 카운터 값을 지운다.
 *
 * mock 과 다른 규칙이 하나 있다: 개행·탭·CR 을 뺀 C0 제어 문자(예: 라벨 "없음" 항목 value 의 NUL)는
 * `\u0000` 같은 글자 표기로 바꾼다. 그대로 두면 `.snap` 이 git 에서 binary 로 취급된다.
 */
export function snapshotHtml(element: Element | null): string {
  if (!element) throw new Error("snapshotHtml: element is null");
  const ids = new Map<string, string>();
  const blobs = new Map<string, string>();
  const generatedId =
    /(?:radix-)?(?:_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:|&laquo;r[0-9a-z]+&raquo;)/g;
  return element.outerHTML
    .replace(/blob:[^"'\s)]+/g, url => {
      if (!blobs.has(url)) blobs.set(url, `blob:${blobs.size + 1}`);
      return blobs.get(url)!;
    })
    .replace(generatedId, raw => {
      if (!ids.has(raw)) ids.set(raw, `id-${ids.size + 1}`);
      return ids.get(raw)!;
    })
    .replace(/></g, ">\n<")
    .replace(
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
      ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
}
