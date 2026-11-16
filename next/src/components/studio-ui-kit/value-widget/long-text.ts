export function longTextPreview(text: string, max = 200): string {
  const chars = Array.from(text.slice(0, max * 2 + 2));
  return chars.length > max ? `${chars.slice(0, max).join("")}…` : text;
}

/** 코드 포인트 수(서로게이트 쌍은 한 글자). 큰 문자열을 배열로 나누지 않고 센다. */
export function codePointCount(text: string): number {
  let count = text.length;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
      const previous = text.charCodeAt(index - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) count -= 1;
    }
  }
  return count;
}

/** UTF-8 바이트 수. */
export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}
