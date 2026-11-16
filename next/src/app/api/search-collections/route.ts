import type { NextRequest } from "next/server";

import { listSearchCollections } from "@/lib/upstage/collections";

import { pickQuery } from "@/app/api/_lib/query";
import { mapClientError, relayUpstream } from "@/app/api/_lib/upstream-relay";

const LIST_QUERY = {
  kind: { enum: ["documents", "table"] },
  include_default: { bool: true },
  is_default: { bool: true },
  listed: { bool: true },
  q: { length: { min: 2, max: 200 } },
  after: { cursor: true },
  before: { cursor: true },
  limit: { int: { min: 1, max: 100 } },
  order: { enum: ["asc", "desc"] },
} as const;

/** Collection 목록. 허용한 쿼리만 upstream 으로 넘기고 본문은 그대로 전달한다. */
export async function GET(request: NextRequest) {
  const query = pickQuery(request.nextUrl.searchParams, LIST_QUERY);
  if (query.error) return query.error;

  try {
    return await relayUpstream(await listSearchCollections(query.values));
  } catch (err) {
    return mapClientError(err);
  }
}
