// 줄·열(1-based) → 텍스트 안 위치(순수). 오류 위치로 커서를 옮길 때 쓴다.

/**
 * 줄·열(1-based) → 텍스트 안 위치. 줄이 텍스트보다 많으면 텍스트 끝, 열이 그 줄 길이를 넘으면
 * 그 줄 끝(다음 줄로 넘어가지 않음)으로 맞춘다. 열 1 미만은 줄 처음.
 */
export function offsetOf(text: string, line: number, column: number): number {
  let offset = 0;
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf("\n", offset);
    if (next === -1) return text.length;
    offset = next + 1;
  }
  const lineEnd = text.indexOf("\n", offset);
  const end = lineEnd === -1 ? text.length : lineEnd;
  return Math.min(offset + Math.max(column - 1, 0), end);
}
