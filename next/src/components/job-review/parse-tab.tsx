"use client";

import { useTranslations } from "next-intl";
import { useCallback, useId, useMemo, useState } from "react";
import {
  DocumentElementList,
  type DocumentElementListItemClassNames,
  type DocumentElementListLabels,
  type DocumentElementListProps,
} from "@/components/studio-ui-kit/document-element-list";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useJobReview } from "./job-review-context";
import { isParseHighlightId } from "./job-review-state";
import {
  PARSE_PAGE_FILTER_STORAGE_KEY,
  defaultCurrentPageOnly,
  itemsOnPage,
  readStoredFlag,
  storedFlagValue,
} from "./parse-tab-model";
import { ParseTable } from "./parse-table";
import { readStorageItem, writeStorageItem } from "@/lib/browser-storage";
import type { ParseListItem } from "./step-outputs";

/**
 * 그림이 있는 행: 머리 줄을 접어 보조 자리(actions)가 제목 아래 한 줄을 다 쓰게 한다.
 * 목록 item 은 본문에 글자만 그리므로(HTML·Markdown 해석 없음) 그림·표는 그 자리에 둔다.
 */
const IMAGE_ROW_CLASS_NAMES: DocumentElementListItemClassNames = {
  container:
    "[&>div:first-child]:flex-wrap **:data-[slot=document-element-list-actions]:basis-full",
};
/** 표로 보이는 행: 그림 행처럼 접고, 같은 내용의 글자 본문은 숨기며, 넓은 표가 행 안에서 가로 스크롤되게 한다. */
const TABLE_ROW_CLASS_NAMES: DocumentElementListItemClassNames = {
  container:
    "[&>div:first-child]:flex-wrap **:data-[slot=document-element-list-actions]:min-w-0 **:data-[slot=document-element-list-actions]:basis-full **:data-[slot=document-element-list-body]:hidden",
};
const TEXT_ROW_CLASS_NAMES: DocumentElementListItemClassNames = {};

/**
 * 항목 id 묶음과 그 id 들이 속한 Parse 목록. 목록(`parseItems`)이 바뀌면 — Job 응답을 다시 받았을 때 —
 * 묶음을 버리도록 목록 정체에 묶어 둔다(effect 없이 렌더 중 파생).
 */
type ItemIds = {
  items: readonly ParseListItem[] | null;
  ids: ReadonlySet<string>;
};
const NO_ITEM_IDS: ItemIds = { items: null, ids: new Set() };

function idsOf(state: ItemIds, items: readonly ParseListItem[]) {
  return state.items === items ? state.ids : NO_ITEM_IDS.ids;
}

/** `id` 를 넣거나(`on`) 뺀 새 묶음. 바뀌는 것이 없으면 같은 객체를 돌려줘 다시 그리지 않는다. */
function withId(
  state: ItemIds,
  items: readonly ParseListItem[],
  id: string,
  on: boolean,
): ItemIds {
  const current = idsOf(state, items);
  if (current.has(id) === on && state.items === items) return state;
  const ids = new Set(current);
  if (on) ids.add(id);
  else ids.delete(id);
  return { items, ids };
}

/**
 * Parse 탭: 선택 문서 페이지의 Parse 요소를 뷰어 페이지 순서로 나열한다. 본문은 글자(`content.text`)이고,
 * Studio 의 Parse 결과 미리보기처럼 그림 요소는 응답의 이미지를, 표 요소는 `content.html` 로 만든 표를 보인다.
 * 그림은 BFF 가 떼어 둔 `figure_url` 을 보일 때만 받고(`loading="lazy"`), 받지 못하면(캐시 만료 404 등) 그
 * 자리를 숨긴다. 표는 원문을 DOM 에 넣지 않고 표 구조 태그와 칸 병합 속성만 허용 목록으로 다시 만든다
 * (Core `parse-table` item). 표 요소마다 원문(HTML 소스 글자) 보기로 바꿀 수 있고(탭 안에서만, 저장하지 않음),
 * 그릴 수 없는 표는 글자로 남는다. 항목·그림·표를 고르면 뷰어가 그 요소 위치로 가고, 뷰어에서 요소를 고르면
 * 목록이 그 항목을 보인다.
 * "현재 페이지만" 을 켜면 뷰어 페이지의 요소만 나열하고 페이지를 따라간다(긴 문서는 기본으로 켜지고,
 * 선택은 브라우저에 기억한다).
 */
export function ParseTab({ name }: { name: string }) {
  const t = useTranslations("review.parse");
  const { state, dispatch, parseItems, space, docPages } = useJobReview();
  const { selectedHighlightId, hoveredHighlightId, selectedPageIndex } = state;
  const switchId = useId();
  const [currentOnly, setCurrentOnly] = useState(
    () =>
      readStoredFlag(readStorageItem(PARSE_PAGE_FILTER_STORAGE_KEY)) ??
      defaultCurrentPageOnly(docPages.length),
  );
  // 받지 못한 그림(`<img onError>`)의 항목 id. 응답을 다시 받으면 처음부터 다시 시도한다.
  const [broken, setBroken] = useState<ItemIds>(NO_ITEM_IDS);
  const brokenImages = idsOf(broken, parseItems);
  const onImageError = useCallback(
    (id: string) => setBroken(prev => withId(prev, parseItems, id, true)),
    [parseItems],
  );
  // 그릴 수 없던 표(변환 결과에 표가 없음·변환 실패)의 항목 id — 그 행은 글자 행으로 둔다.
  const [unrenderable, setUnrenderable] = useState<ItemIds>(NO_ITEM_IDS);
  const unrenderableTables = idsOf(unrenderable, parseItems);
  const onTableUnrenderable = useCallback(
    (id: string) => setUnrenderable(prev => withId(prev, parseItems, id, true)),
    [parseItems],
  );
  // 원문 보기 중인 표 항목 id. 저장하지 않고, 응답을 다시 받으면 모두 표 보기로 돌아간다.
  const [source, setSource] = useState<ItemIds>(NO_ITEM_IDS);
  const sourceIds = idsOf(source, parseItems);
  const page = selectedPageIndex + 1;
  const pageItems = useMemo(
    () => (currentOnly ? itemsOnPage(parseItems, page) : parseItems),
    [currentOnly, parseItems, page],
  );
  // 원문 보기 중인 표 항목은 본문 글자를 표를 그린 원문(`content.html`)으로 바꾼다. 나머지 항목은 같은
  // 객체를 넘겨 행이 다시 그려지지 않게 한다.
  const items = useMemo(
    () =>
      sourceIds.size === 0
        ? pageItems
        : pageItems.map(item =>
            item.tableHtml !== null && sourceIds.has(item.id)
              ? { ...item, text: item.tableHtml }
              : item,
          ),
    [pageItems, sourceIds],
  );

  const labels = useMemo<DocumentElementListLabels>(
    () => ({
      empty: t(currentOnly ? "emptyPage" : "empty"),
      loadMore: t("loadMore"),
      page: page => t("page", { page }),
      item: n => t("item", { n }),
    }),
    [t, currentOnly],
  );
  const pageCount = useMemo(
    () => new Set(parseItems.map(item => item.page)).size,
    [parseItems],
  );
  const imageById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of parseItems) {
      if (item.image !== null) map.set(item.id, item.image);
    }
    return map;
  }, [parseItems]);
  const tableHtmlById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of parseItems) {
      if (item.tableHtml !== null) map.set(item.id, item.tableHtml);
    }
    return map;
  }, [parseItems]);
  const tableImageLabel = useCallback(
    (alt: string) => t("tableImage", { alt }),
    [t],
  );

  const onItemActivate = useCallback(
    (id: string) => {
      const item = parseItems.find(candidate => candidate.id === id);
      dispatch({
        type: "SELECT_HIGHLIGHT",
        id,
        source: "panel",
        pageIndex: item ? item.page - 1 : undefined,
      });
    },
    [dispatch, parseItems],
  );
  const onHoverChange = useCallback(
    (id: string | null) => dispatch({ type: "HOVER_HIGHLIGHT", id }),
    [dispatch],
  );
  const onRevealItem = useCallback((element: HTMLElement) => {
    element.scrollIntoView({ block: "nearest" });
  }, []);
  const toggleSource = useCallback(
    (id: string) =>
      setSource(prev =>
        withId(prev, parseItems, id, !idsOf(prev, parseItems).has(id)),
      ),
    [parseItems],
  );
  const renderItemActions = useCallback<
    NonNullable<DocumentElementListProps["renderItemActions"]>
  >(
    item => {
      const image = imageById.get(item.id);
      if (image === undefined || brokenImages.has(item.id)) {
        const tableHtml = tableHtmlById.get(item.id);
        if (tableHtml === undefined || unrenderableTables.has(item.id)) {
          return null;
        }
        const showSource = sourceIds.has(item.id);
        return (
          <div className="flex min-w-0 flex-col gap-2">
            {/* 전환 버튼은 원문·표 어느 보기에서나 행 오른쪽 위 같은 자리에 둔다. */}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="self-end text-muted-foreground"
              aria-pressed={showSource}
              onClick={() => toggleSource(item.id)}
              data-testid="job-review-parse-table-toggle"
            >
              {t(showSource ? "tableShowTable" : "tableShowSource")}
            </Button>
            {showSource ? null : (
              <ParseTable
                id={item.id}
                html={tableHtml}
                imageLabel={tableImageLabel}
                regionLabel={t("tableRegion")}
                onActivate={onItemActivate}
                onUnrenderable={onTableUnrenderable}
              />
            )}
          </div>
        );
      }
      // 보조 자리의 클릭은 행 선택이 되지 않으므로 그림 자체를 위치 이동 버튼으로 둔다.
      return (
        <button
          type="button"
          aria-label={t("imageLocate")}
          className="block cursor-pointer rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
          onClick={() => onItemActivate(item.id)}
          data-testid="job-review-parse-image"
        >
          {/* 같은 origin 의 BFF 경로(또는 응답의 data URL)라 next/image 최적화 대상이 아니다. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt={t("image")}
            loading="lazy"
            decoding="async"
            onError={() => onImageError(item.id)}
            className="max-h-64 w-auto max-w-full rounded-sm border border-border"
          />
        </button>
      );
    },
    [
      brokenImages,
      imageById,
      onImageError,
      onItemActivate,
      onTableUnrenderable,
      sourceIds,
      t,
      tableHtmlById,
      tableImageLabel,
      toggleSource,
      unrenderableTables,
    ],
  );
  const getItemClassNames = useCallback<
    NonNullable<DocumentElementListProps["getItemClassNames"]>
  >(
    item => {
      if (imageById.has(item.id) && !brokenImages.has(item.id)) {
        return IMAGE_ROW_CLASS_NAMES;
      }
      return tableHtmlById.has(item.id) &&
        !unrenderableTables.has(item.id) &&
        !sourceIds.has(item.id)
        ? TABLE_ROW_CLASS_NAMES
        : TEXT_ROW_CLASS_NAMES;
    },
    [brokenImages, imageById, sourceIds, tableHtmlById, unrenderableTables],
  );

  if (!space && docPages.length > 0) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t("noSpace")}
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="job-review-parse">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted-foreground">
          {currentOnly
            ? t("summaryPage", { name, page, count: items.length })
            : t("summary", {
                name,
                count: parseItems.length,
                pages: pageCount,
              })}
        </p>
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            size="sm"
            checked={currentOnly}
            onCheckedChange={on => {
              setCurrentOnly(on);
              writeStorageItem(
                PARSE_PAGE_FILTER_STORAGE_KEY,
                storedFlagValue(on),
              );
            }}
            data-testid="job-review-parse-switch-current-page"
          />
          <label
            htmlFor={switchId}
            className="text-xs text-muted-foreground select-none"
          >
            {t("currentPageOnly")}
          </label>
        </div>
      </div>
      {/* 필터를 켜고 끄거나 페이지가 바뀌면 "더 보기" 수를 처음으로 되돌린다. */}
      <DocumentElementList
        key={currentOnly ? `page-${page}` : "all"}
        items={items}
        selectedId={
          isParseHighlightId(selectedHighlightId) ? selectedHighlightId : null
        }
        hoveredId={
          isParseHighlightId(hoveredHighlightId) ? hoveredHighlightId : null
        }
        onItemActivate={onItemActivate}
        onHoverChange={onHoverChange}
        onRevealItem={onRevealItem}
        renderItemActions={renderItemActions}
        getItemClassNames={getItemClassNames}
        labels={labels}
      />
    </div>
  );
}
