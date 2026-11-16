/** 한 페이지에 보이는 행 수. */
export const PAGE_SIZE = 20;

/**
 * 한 번의 요청으로 받아 두는 페이지 수. 블록 안에서는 서버를 다시 부르지 않고 번호로 넘기며,
 * 블록의 마지막 페이지에서 "다음" 을 누를 때 `after` 커서로 다음 블록을 받는다.
 */
export const CURSOR_BLOCK_PAGES = 5;

export interface CursorBlockPage {
  /** 1부터 세는 보이는 페이지 번호 */
  page: number;
  /** 번호 버튼으로 그릴 페이지(받아 둔 블록 범위) */
  pageNumbers: number[];
  /** 받아 둔 블록에서 보이는 행의 `slice` 시작·끝 */
  start: number;
  end: number;
  isFirstInBlock: boolean;
  isLastInBlock: boolean;
}

/**
 * 커서 블록 안에서 지금 보일 페이지를 계산한다. 커서 API 는 전체 개수를 주지 않으므로 번호는
 * 받아 둔 블록의 페이지까지만 그린다.
 *
 * - 가려는 페이지가 받아 둔 블록 밖이면(다른 블록을 받는 중) 떠나기 전 화면을 유지한다.
 *   앞으로 가는 중이면 받아 둔 블록의 마지막 페이지, 뒤로 가는 중이면 첫 페이지.
 * - 다시 읽어 행이 줄어 페이지가 블록 밖으로 밀리면 남은 마지막 페이지로 당긴다.
 * - 받아 둔 블록이 없으면(첫 조회·오류) 가려는 페이지를 그대로 보인다.
 *
 * @param pageIndex 0부터 세는 가려는 페이지
 * @param loadedBlockIndex 받아 둔 블록 번호(0부터)
 * @param loadedCount 받아 둔 블록의 행 수. 받은 블록이 없으면 `null`
 * @param pageSize 한 페이지의 행 수
 */
export function getCursorBlockPage(
  pageIndex: number,
  loadedBlockIndex: number,
  loadedCount: number | null,
  pageSize: number,
): CursorBlockPage {
  const pagesInBlock =
    loadedCount === null
      ? (pageIndex % CURSOR_BLOCK_PAGES) + 1
      : Math.max(1, Math.ceil(loadedCount / pageSize));
  const targetBlockIndex = Math.floor(pageIndex / CURSOR_BLOCK_PAGES);

  let offset: number;
  if (targetBlockIndex === loadedBlockIndex) {
    offset = Math.min(pageIndex % CURSOR_BLOCK_PAGES, pagesInBlock - 1);
  } else {
    offset = targetBlockIndex > loadedBlockIndex ? pagesInBlock - 1 : 0;
  }

  const firstPage = loadedBlockIndex * CURSOR_BLOCK_PAGES + 1;
  return {
    page: firstPage + offset,
    pageNumbers: Array.from({ length: pagesInBlock }, (_, i) => firstPage + i),
    start: offset * pageSize,
    end: (offset + 1) * pageSize,
    isFirstInBlock: offset === 0,
    isLastInBlock: offset === pagesInBlock - 1,
  };
}

/**
 * 다음 페이지를 부를 커서. upstream 이 `has_more: true` 를 주더라도 커서가 없으면 이어 받을 수
 * 없으므로 `null`(다음 없음)로 본다.
 */
export function nextCursorOf(page: {
  has_more?: boolean;
  last_cursor?: string | null;
}): string | null {
  return page.has_more === true && page.last_cursor ? page.last_cursor : null;
}

/**
 * "더 보기" 로 받은 행을 이어 붙이면서 이미 있는 키의 행은 뺀다. 페이지 사이에 항목이 새로
 * 들어오거나 순서가 바뀌면 커서 뒤 페이지가 앞 페이지의 행을 다시 줄 수 있다.
 */
export function appendUnique<T>(
  items: readonly T[],
  more: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set(items.map(keyOf));
  const added = more.filter(item => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...items, ...added];
}
