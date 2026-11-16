"use client";

import { getCollectionLineage } from "@/lib/review-api/client";
import { useResource } from "@/lib/use-resource";

const LINEAGE_KEY = "collection-lineage";

/** Collection 사이의 연결을 받는다. 관계 화면이 열릴 때 한 번 받고, `retry` 로 다시 받는다. */
export function useCollectionLineage() {
  return useResource(LINEAGE_KEY, signal => getCollectionLineage({ signal }));
}
