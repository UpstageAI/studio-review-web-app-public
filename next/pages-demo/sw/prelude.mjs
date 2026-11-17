// 서비스 워커에서 BFF Route Handler 를 그대로 돌리기 위한 Node 전역 흉내. 다른 모듈보다 먼저 평가돼야
// 하므로 `entry.mjs` 가 맨 처음 import 한다.
import { UPSTREAM_SEGMENT } from "../config.mjs";

/** mock upstream 주소. 서비스 워커 scope 아래라 Pages 에서는 `https:` 다. */
export const UPSTREAM_BASE = `${self.registration.scope}${UPSTREAM_SEGMENT}`;

// BFF 가 호출 시점에 읽는 환경 변수(`src/lib/upstage/env.ts`).
self.process = {
  env: {
    NODE_ENV: "production",
    UPSTAGE_API_KEY: "mock-key",
    UPSTAGE_CONSOLE_API_URL: UPSTREAM_BASE,
    // 로컬 미리보기(`http://localhost`)의 페이지 이미지용. loopback 이 아닌 http 는 켜져 있어도 걸러진다.
    UPSTAGE_ALLOW_HTTP_IMAGE_URLS: "1",
  },
};

const encoder = new TextEncoder();

// BFF 가 쓰는 두 가지만 둔다(`job-response-figures.ts` 의 base64 디코드, `file-source.ts` 의 바이트 수).
self.Buffer = {
  from(value, encoding) {
    if (encoding !== "base64") {
      throw new TypeError(`Buffer.from: unsupported encoding ${encoding}`);
    }
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  },
  byteLength: text => encoder.encode(text).length,
};
