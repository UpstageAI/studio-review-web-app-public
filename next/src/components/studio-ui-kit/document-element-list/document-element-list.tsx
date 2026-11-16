"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useItemReveal } from "./use-item-reveal";

export type DocumentElementListItem = {
  id: string;
  page: number;
  text: string;
  type?: string;
  label?: string;
  interactionDisabled?: boolean;
};

export type DocumentElementListItemState = {
  selected: boolean;
  hovered: boolean;
};

export type DocumentElementListLabels = {
  empty: string;
  loadMore: string;
  page: (page: number) => string;
  item: (position: number) => string;
};

export type DocumentElementListItemClassNames = {
  container?: string;
  label?: string;
};

export type DocumentElementListItemDragProps = Pick<
  HTMLAttributes<HTMLElement>,
  "draggable" | "onDragStart" | "onDragEnd"
>;

export type DocumentElementListProps = {
  items: readonly DocumentElementListItem[];
  selectedId?: string | null;
  hoveredId?: string | null;
  onItemActivate?: (id: string) => void;
  onHoverChange?: (id: string | null) => void;
  onRevealItem?: (element: HTMLElement, item: DocumentElementListItem) => void;
  labels: DocumentElementListLabels;
  renderPageHeader?: (page: number) => ReactNode;
  renderItemActions?: (item: DocumentElementListItem) => ReactNode;
  getItemDragProps?: (
    item: DocumentElementListItem,
  ) => DocumentElementListItemDragProps;
  getItemClassNames?: (
    item: DocumentElementListItem,
    state: DocumentElementListItemState,
  ) => DocumentElementListItemClassNames;
  className?: string;
};

const BATCH_SIZE = 50;

function hasBodySelection(body: HTMLElement | null): boolean {
  const selection = body?.ownerDocument.getSelection();
  if (!body || !selection || selection.isCollapsed || !selection.toString()) {
    return false;
  }
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(body)) return true;
  }
  return false;
}

const ElementRow = memo(function ElementRow({
  item,
  title,
  selected,
  hovered,
  onItemActivate,
  onHoverChange,
  renderItemActions,
  getItemDragProps,
  getItemClassNames,
  registerElement,
}: {
  item: DocumentElementListItem;
  title: string;
  selected: boolean;
  hovered: boolean;
  onItemActivate?: DocumentElementListProps["onItemActivate"];
  onHoverChange?: DocumentElementListProps["onHoverChange"];
  renderItemActions?: DocumentElementListProps["renderItemActions"];
  getItemDragProps?: DocumentElementListProps["getItemDragProps"];
  getItemClassNames?: DocumentElementListProps["getItemClassNames"];
  registerElement: (id: string, element: HTMLElement | null) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLElement | null>(null);
  const actionContainer = useRef<HTMLDivElement>(null);
  const setElement = useCallback(
    (element: HTMLDivElement | null) => registerElement(item.id, element),
    [item.id, registerElement],
  );
  const state = { selected, hovered };
  const actions = renderItemActions?.(item);
  const dragProps = getItemDragProps?.(item);
  const classNames = getItemClassNames?.(item, state);
  const canActivate = !item.interactionDisabled && !!onItemActivate;
  const labelClassName = cn(
    "text-left text-sm font-medium text-muted-foreground",
    state.selected && "text-primary",
    canActivate &&
      "cursor-pointer rounded-md focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    classNames?.label,
  );

  return (
    <div
      ref={setElement}
      data-slot="document-element-list-item"
      data-item-id={item.id}
      data-selected={state.selected}
      data-hovered={state.hovered}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border border-border bg-background p-3 text-foreground",
        canActivate && "cursor-pointer",
        state.hovered && "bg-muted",
        state.selected && "border-primary bg-accent",
        classNames?.container,
      )}
      draggable={dragProps?.draggable}
      onDragStart={dragProps?.onDragStart}
      onDragEnd={dragProps?.onDragEnd}
      onClick={event => {
        if (
          !canActivate ||
          !event.currentTarget.contains(event.target as Node) ||
          actionContainer.current?.contains(event.target as Node)
        ) {
          return;
        }
        if (
          !label.current?.contains(event.target as Node) &&
          hasBodySelection(body.current)
        ) {
          return;
        }
        onItemActivate?.(item.id);
      }}
      onMouseEnter={() => {
        if (!item.interactionDisabled) onHoverChange?.(item.id);
      }}
      onMouseLeave={() => {
        if (!item.interactionDisabled) onHoverChange?.(null);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        {canActivate ? (
          <button
            ref={node => {
              label.current = node;
            }}
            type="button"
            data-slot="document-element-list-label"
            className={labelClassName}
          >
            {title}
          </button>
        ) : (
          <span
            ref={node => {
              label.current = node;
            }}
            data-slot="document-element-list-label"
            className={labelClassName}
          >
            {title}
          </span>
        )}
        {actions != null ? (
          <div
            ref={actionContainer}
            data-slot="document-element-list-actions"
            className="shrink-0"
          >
            {actions}
          </div>
        ) : null}
      </div>
      <div
        ref={body}
        data-slot="document-element-list-body"
        className="whitespace-pre-wrap break-words text-sm leading-6"
      >
        {item.text}
      </div>
    </div>
  );
});

/** Controlled text rows. Hosts own state, actions and scroll policy. */
export function DocumentElementList({
  items,
  selectedId = null,
  hoveredId = null,
  onItemActivate,
  onHoverChange,
  onRevealItem,
  labels,
  renderPageHeader,
  renderItemActions,
  getItemDragProps,
  getItemClassNames,
  className,
}: Readonly<DocumentElementListProps>) {
  const [limit, setLimit] = useState(BATCH_SIZE);
  const elements = useRef(new Map<string, HTMLElement>());
  const loadMoreButton = useRef<HTMLButtonElement>(null);
  const selectedIndex = items.findIndex(item => item.id === selectedId);
  const expandedLimit = Math.max(limit, selectedIndex + 1);
  // Retain external selection's expanded range without a second effect commit.
  if (expandedLimit !== limit) setLimit(expandedLimit);
  const visibleCount = Math.min(items.length, expandedLimit);
  const hasMore = visibleCount < items.length;
  const registerElement = useCallback(
    (id: string, element: HTMLElement | null) => {
      if (element) elements.current.set(id, element);
      else elements.current.delete(id);
    },
    [],
  );
  const loadMore = useCallback(() => {
    setLimit(current =>
      Math.min(items.length, Math.max(current, selectedIndex + 1) + BATCH_SIZE),
    );
  }, [items.length, selectedIndex]);

  useEffect(() => {
    const button = loadMoreButton.current;
    if (!hasMore || !button || typeof IntersectionObserver === "undefined") {
      return;
    }
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (active && entries.some(entry => entry.isIntersecting)) loadMore();
    });
    observer.observe(button);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [hasMore, visibleCount, loadMore]);

  useItemReveal(selectedId, items, elements, onRevealItem);

  return (
    <div
      data-slot="document-element-list"
      className={cn("flex min-w-0 flex-col gap-4", className)}
    >
      {items.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {labels.empty}
        </p>
      ) : (
        <ul className="flex list-none flex-col gap-3 p-0">
          {items.slice(0, visibleCount).map((item, index) => {
            return (
              <li key={item.id} className="flex min-w-0 flex-col gap-3">
                {index === 0 || items[index - 1].page !== item.page ? (
                  <div
                    data-slot="document-element-list-page-header"
                    className="border-b border-border py-2 text-sm font-medium text-muted-foreground"
                  >
                    {renderPageHeader
                      ? renderPageHeader(item.page)
                      : labels.page(item.page)}
                  </div>
                ) : null}
                <ElementRow
                  item={item}
                  title={item.label ?? item.type ?? labels.item(index + 1)}
                  selected={item.id === selectedId}
                  hovered={item.id === hoveredId}
                  onItemActivate={onItemActivate}
                  onHoverChange={onHoverChange}
                  renderItemActions={renderItemActions}
                  getItemDragProps={getItemDragProps}
                  getItemClassNames={getItemClassNames}
                  registerElement={registerElement}
                />
              </li>
            );
          })}
        </ul>
      )}
      {hasMore ? (
        <button
          ref={loadMoreButton}
          type="button"
          data-slot="document-element-list-load-more"
          className="cursor-pointer self-center rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-muted focus-visible:[outline-style:solid] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={loadMore}
        >
          {labels.loadMore}
        </button>
      ) : null}
    </div>
  );
}
