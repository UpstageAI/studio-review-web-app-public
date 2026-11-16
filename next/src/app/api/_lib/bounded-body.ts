import "server-only";

// 본문을 상한까지만 읽는 helper. 파일 요소 URL(`viewer-document.ts`)·Job 응답(`source-jobs/{jobId}/response`)·
// 파일 원본(`file-source.ts`)처럼 크기를 미리 알 수 없는 upstream 본문, 그리고 요청 본문을 서버 메모리에 올릴 때 쓴다.

/**
 * 스트림을 `maxBytes` 까지만 읽어 바이트로 돌려준다. 읽는 도중 누적이 상한을 넘으면 거기서 멈추고
 * 스트림을 취소한 뒤 `null`. 본문이 없으면 빈 배열. `content-length` 는 보지 않는다(선언과 실제가
 * 다를 수 있어 실제 바이트로만 판정한다).
 */
export async function readBytesWithin(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * 본문을 `maxBytes` 까지만 읽어 문자열로 돌려준다. `content-length` 가 상한을 넘으면 읽기 전에
 * 본문을 취소하고, 읽는 도중 상한을 넘으면 거기서 멈추고 취소한다. 두 경우 모두 `null`.
 */
export async function readTextWithin(
  response: Pick<Response | Request, "headers" | "body">,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  const bytes = await readBytesWithin(response.body, maxBytes);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}
