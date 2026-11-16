import type { NextRequest } from "next/server";

import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  MAX_INLINE_IMPORT_BYTES,
  RESOURCE_ID_PATTERN,
  createReviewImport,
} from "@/lib/upstage/review";

import { readBytesWithin } from "@/app/api/_lib/bounded-body";
import { assertSameOrigin } from "@/app/api/_lib/same-origin";
import {
  errorResponse,
  invalidValue,
  mapClientError,
  relayUpstream,
} from "@/app/api/_lib/upstream-relay";

function tooLarge(): Response {
  return errorResponse(
    413,
    "package_limit_exceeded",
    `Review file must be ${MAX_INLINE_IMPORT_BYTES} bytes or smaller`,
  );
}

/**
 * 수정한 검수 JSON 파일 바이트를 올려 가져오기를 만든다(반영 방식은 `auto` 고정).
 * `Idempotency-Key` 는 브라우저가 만든다. 같은 파일을 다시 보낼 때는 같은 키를, 파일을 고쳤으면
 * 새 키를 쓴다. 응답은 `202` + `Retry-After` 이며 상태는 `review-imports/{importId}` 로 조회한다.
 */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/search-collections/[collectionId]/review-imports">,
) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  const { collectionId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(collectionId)) {
    return invalidValue("collection_id is invalid", "collection_id");
  }

  const idempotencyKey = request.headers.get("idempotency-key") ?? "";
  if (
    idempotencyKey.length === 0 ||
    idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH
  ) {
    return invalidValue(
      `Idempotency-Key header must be 1..${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
      "Idempotency-Key",
    );
  }

  // 본문을 읽기 전에 선언된 크기로 먼저 거른다.
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_INLINE_IMPORT_BYTES
  ) {
    return tooLarge();
  }

  // Route Handler 는 본문 크기 상한이 없어(proxy 를 거치지 않음) 선언이 없거나 틀린 본문도 여기서
  // 읽는 도중에 막는다.
  const body = await readBytesWithin(request.body, MAX_INLINE_IMPORT_BYTES);
  if (body === null) {
    return tooLarge();
  }
  if (body.byteLength === 0) {
    return invalidValue("Request body is empty");
  }

  try {
    return await relayUpstream(
      await createReviewImport(collectionId, body, { idempotencyKey }),
    );
  } catch (err) {
    return mapClientError(err);
  }
}
