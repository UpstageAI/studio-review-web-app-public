import { useEffect, useMemo, useState } from "react";
import { localStore } from "@/lib/browser-storage";
import {
  readVisited,
  visitedStorageKey,
  withVisited,
  writeVisited,
} from "./visited-documents";

type Visited = { storageKey: string; keys: readonly string[] };

/**
 * 이 Job 에서 열어 본 문서 키 목록. 고른 문서(`selectedKey`)를 곧바로 더하고 브라우저에 기억해 같은
 * 브라우저로 다시 열어도 남는다. 큐로 다른 Job 으로 넘어가면 그 Job 의 기록을 다시 읽는다.
 */
export function useVisitedDocuments(
  collectionId: string,
  jobId: string,
  selectedKey: string | null,
): ReadonlySet<string> {
  const storageKey = visitedStorageKey(collectionId, jobId);
  const [visited, setVisited] = useState<Visited>(() => ({
    storageKey,
    keys: readVisited(localStore(), storageKey),
  }));

  // 렌더 중에 맞춘다(효과에서 setState 하지 않는다): Job 이 바뀌면 그 Job 기록을 읽고, 고른 문서가
  // 목록에 없으면 더한다.
  let current = visited;
  if (current.storageKey !== storageKey) {
    current = { storageKey, keys: readVisited(localStore(), storageKey) };
  }
  if (selectedKey !== null) {
    const keys = withVisited(current.keys, selectedKey);
    if (keys !== current.keys) current = { storageKey, keys };
  }
  if (current !== visited) setVisited(current);

  useEffect(() => {
    writeVisited(localStore(), visited.storageKey, visited.keys);
  }, [visited]);

  const keys = current.keys;
  return useMemo(() => new Set(keys), [keys]);
}
