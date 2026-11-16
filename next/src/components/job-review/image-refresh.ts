// 페이지 이미지가 로드에 실패했을 때 그 파일의 이미지 URL 을 다시 받을지의 순수 규칙. 페이지 이미지는
// 만료되는 서명 URL 이라 화면을 오래 열어 두면 아직 받지 않은 페이지(연속 스크롤로 새로 보이는 페이지,
// 필름스트립과 페이지 정리 썸네일)가 로드에 실패한다. 같은 파일을 짧은 간격으로 거듭 받지 않도록 파일마다
// 쉬는 시간을 둔다(정말로 깨진 이미지라면 다시 받아도 또 실패하므로 끝없이 되풀이하지 않는다).

import type { FileEntry } from "./job-review-state";

/** 같은 파일을 자동으로 다시 받기까지 쉬는 시간. */
export const IMAGE_REFRESH_COOLDOWN_MS = 60_000;

/**
 * 실패한 이미지 요소가 요청한 URL. 화면이 넣은 값과 그대로 비교하려고 해석된 `src` 대신 속성 값을
 * 읽는다(`<img src>`, SVG `<image href>`). 이미지 요소가 아니거나 URL 이 없으면 `null`.
 */
export function failedImageUrl(
  target: Pick<Element, "localName" | "getAttribute"> | null,
): string | null {
  if (!target) return null;
  if (target.localName === "img") return target.getAttribute("src") || null;
  if (target.localName === "image") {
    return (
      target.getAttribute("href") || target.getAttribute("xlink:href") || null
    );
  }
  return null;
}

/** `url` 을 페이지 이미지로 가진 파일. 이 화면의 페이지 이미지가 아니면 `null`. */
export function fileRefOfImage(
  files: Readonly<Record<string, FileEntry>>,
  url: string,
): string | null {
  if (!url) return null;
  for (const [fileRef, entry] of Object.entries(files)) {
    if (entry.imageUrls.includes(url)) return fileRef;
  }
  return null;
}

/**
 * 파일마다 마지막으로 다시 받은 시각을 기억해, 쉬는 시간이 지났을 때만 `true` 를 돌려주는 문지기.
 * `true` 를 돌려준 호출이 그 파일의 새 기준 시각이 된다.
 */
export function createRefreshGate(
  cooldownMs: number = IMAGE_REFRESH_COOLDOWN_MS,
): (fileRef: string, now: number) => boolean {
  const last = new Map<string, number>();
  return (fileRef, now) => {
    const previous = last.get(fileRef);
    if (previous !== undefined && now - previous < cooldownMs) return false;
    last.set(fileRef, now);
    return true;
  };
}
