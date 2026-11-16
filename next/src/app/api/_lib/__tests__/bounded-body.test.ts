import { describe, expect, it } from "vitest";

import { readBytesWithin, readTextWithin } from "../bounded-body";

/** `chunk` 바이트씩 `count` 번 내보내는 본문. 몇 번 읽혔는지와 취소 여부를 센다. */
function chunkedBody(chunk: number, count: number, fill = 0x20) {
  const seen = { pulls: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls += 1;
      if (seen.pulls > count) controller.close();
      else controller.enqueue(new Uint8Array(chunk).fill(fill));
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

describe("readTextWithin", () => {
  it("상한 이하면 본문 전체를 문자열로 돌려준다(여러 chunk 를 이어 붙임)", async () => {
    const { stream, seen } = chunkedBody(1024, 4, 0x61);
    const text = await readTextWithin(new Response(stream), 4096);
    expect(text).toBe("a".repeat(4096));
    expect(seen.cancelled).toBe(false);
  });

  it("content-length 가 상한을 넘으면 본문을 읽지 않고 취소하며 null", async () => {
    const { stream, seen } = chunkedBody(1024, 1);
    const text = await readTextWithin(
      new Response(stream, { headers: { "content-length": "4097" } }),
      4096,
    );
    expect(text).toBeNull();
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBe(0);
  });

  it("읽은 본문이 상한을 넘으면 거기서 멈추고 취소하며 null", async () => {
    const chunk = 1024;
    const { stream, seen } = chunkedBody(chunk, 100);
    const text = await readTextWithin(new Response(stream), 8 * chunk);
    expect(text).toBeNull();
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBeLessThan(100);
    expect(seen.pulls).toBeGreaterThan(8);
  });

  it("본문이 없으면 빈 문자열, UTF-8 다바이트 글자는 chunk 경계에 걸려도 그대로", async () => {
    expect(await readTextWithin(new Response(null), 10)).toBe("");
    const bytes = new TextEncoder().encode("한글 본문");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 1));
        controller.enqueue(bytes.slice(1));
        controller.close();
      },
    });
    expect(await readTextWithin(new Response(stream), 100)).toBe("한글 본문");
  });
});

describe("readBytesWithin", () => {
  it("상한과 정확히 같은 크기면 전체 바이트를 돌려주고 취소하지 않는다", async () => {
    const { stream, seen } = chunkedBody(1024, 4, 0x61);
    const bytes = await readBytesWithin(stream, 4096);
    expect(bytes?.byteLength).toBe(4096);
    expect(bytes?.every(b => b === 0x61)).toBe(true);
    expect(seen.cancelled).toBe(false);
  });

  it("상한을 1 바이트라도 넘으면 스트림을 취소하고 null", async () => {
    const { stream, seen } = chunkedBody(4097, 1);
    expect(await readBytesWithin(stream, 4096)).toBeNull();
    expect(seen.cancelled).toBe(true);
  });

  it("본문이 없으면 빈 바이트", async () => {
    expect((await readBytesWithin(null, 10))?.byteLength).toBe(0);
  });
});
