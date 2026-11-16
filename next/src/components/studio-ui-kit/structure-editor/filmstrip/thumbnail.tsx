import type { DragEvent, MouseEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { StructureMenuItem } from "../shared/menu";
import { tid } from "../shared/test-id";
import type { FilmstripLabels } from "./filmstrip";
import type { StructurePage } from "../shared/types";

/**
 * 페이지 썸네일: 누르면 뷰어가 그 페이지로 가고, 끌어서 옮기며, 메뉴로 같은 일을 키보드로 한다.
 * 이미지는 뷰어와 같은 페이지 이미지를 줄여 쓴다. `onClick` 이 없으면 썸네일은 버튼이 아니고, 메뉴
 * 항목이 없으면(또는 `labels.pageMenu` 가 없으면) ⋯ 버튼도 없다.
 */
export function Thumbnail({
  page,
  selected,
  insertBefore,
  insertAfter,
  disabled,
  draggable,
  labels,
  testId,
  onClick,
  onDragStart,
  onDragEnd,
  menu,
}: {
  page: StructurePage;
  selected: boolean;
  /** drop 위치 표시(앞·뒤 세로 막대). */
  insertBefore: boolean;
  insertAfter: boolean;
  disabled: boolean;
  /** 끌어서 옮길 수 있나(받을 콜백이 있을 때). `disabled` 면 끌 수 없다. */
  draggable: boolean;
  labels: FilmstripLabels;
  testId?: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  menu: readonly StructureMenuItem[];
}) {
  const name = labels.page(page);
  const issue =
    page.issue === "overlap"
      ? labels.overlap
      : page.issue === "missing"
        ? labels.missing
        : null;
  const label = issue ? `${name} · ${issue}` : name;
  const canDrag = draggable && !disabled;
  const menuName = menu.length > 0 ? labels.pageMenu?.(page) : undefined;
  const frame =
    page.issue === "missing"
      ? "border-2 border-dashed border-destructive"
      : page.issue === "overlap"
        ? "border-2 border-destructive"
        : selected
          ? "border-2 border-primary"
          : "border border-border";
  const image = page.thumbnailUrl ? (
    // 원본 페이지 이미지를 CSS 로 줄인다(썸네일 API 가 따로 없다).
    <img
      src={page.thumbnailUrl}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      className="size-full object-contain"
    />
  ) : (
    <span className="px-1 text-center text-xs text-muted-foreground">
      {labels.noImage}
    </span>
  );

  return (
    <div
      data-filmstrip-page={page.key}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
      className={cn(
        "relative flex w-16 shrink-0 flex-col items-center gap-1",
        canDrag && "cursor-grab",
      )}
    >
      {insertBefore ? (
        <span
          aria-hidden="true"
          className="absolute top-0 -left-1.5 h-20 w-0.5 rounded-full bg-primary"
        />
      ) : null}
      {insertAfter ? (
        <span
          aria-hidden="true"
          className="absolute top-0 -right-1.5 h-20 w-0.5 rounded-full bg-primary"
        />
      ) : null}
      {onClick ? (
        <button
          type="button"
          aria-label={label}
          aria-current={selected ? "true" : undefined}
          title={issue ?? name}
          onClick={onClick}
          data-testid={tid(testId, "thumbnail-select")}
          className={cn(
            "flex h-20 w-16 cursor-pointer items-center justify-center overflow-hidden rounded-md bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden",
            frame,
          )}
        >
          {image}
        </button>
      ) : (
        <div
          role="img"
          aria-label={label}
          aria-current={selected ? "true" : undefined}
          title={issue ?? name}
          className={cn(
            "flex h-20 w-16 items-center justify-center overflow-hidden rounded-md bg-muted",
            frame,
          )}
        >
          {image}
        </div>
      )}
      <div className="flex w-full min-w-0 items-center gap-0.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {name}
        </span>
        {menuName !== undefined ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={disabled}>
              <button
                type="button"
                aria-label={menuName}
                data-testid={tid(testId, "thumbnail-menu-open")}
                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {menu.map(item =>
                item.children ? (
                  <DropdownMenuSub key={item.id}>
                    <DropdownMenuSubTrigger
                      disabled={item.disabled}
                      data-testid={tid(testId, `page-menu-${item.id}`)}
                    >
                      {item.label}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {item.children.length === 0 ? (
                        <DropdownMenuItem disabled>
                          {item.empty}
                        </DropdownMenuItem>
                      ) : (
                        item.children.map(child => (
                          <DropdownMenuItem
                            key={child.id}
                            onSelect={child.onSelect}
                            data-testid={tid(
                              testId,
                              `page-menu-${item.id}-select`,
                            )}
                          >
                            {child.label}
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : (
                  <DropdownMenuItem
                    key={item.id}
                    disabled={item.disabled}
                    onSelect={item.onSelect}
                    data-testid={tid(testId, `page-menu-${item.id}`)}
                  >
                    {item.label}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
