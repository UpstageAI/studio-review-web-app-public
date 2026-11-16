import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { buildRows, listWindow, scrollTopToReveal, type ListRow } from "./rows";
import { CircleXIcon, TriangleAlertIcon, PencilIcon, ScanEyeIcon, LockIcon, BanIcon } from "lucide-react";

/** 문서 상태 아이콘: 바뀜, 재확인 필요, 편집 불가, 제외(행도 흐려진다). */
export type DocumentListStatus = "changed" | "recheck" | "locked" | "excluded";

/** 먼저 볼 문서 아이콘: 실패(`danger`)가 경고(`warning`)보다 강하다. */
export type DocumentListFlag = "danger" | "warning";

/** 행 표식 종류: 판정 아이콘, 상태 아이콘, 열어 보지 않은 문서 점. */
// prettier-ignore
export type DocumentListMarker =
  DocumentListFlag | DocumentListStatus | "unvisited";

export interface DocumentListItem {
  /** 선택 키. 화면이 정한 문자열을 그대로 `onSelect` 로 돌려준다. */
  id: string;
  /** 문서 라벨. `null` 이면 `labels.untitled`. */
  label: string | null;
  pageCount: number;
  /** 상태 아이콘(쪽수 앞). 문구는 `labels.status`. */
  status?: DocumentListStatus;
  /** 판정 아이콘(상태 아이콘 앞). 문구는 `labels.flags`. */
  flag?: DocumentListFlag;
  /**
   * 검수자가 이미 열어 본 문서인가. `false` 면 행 왼쪽 여백에 점을 찍는다(메일의 안 읽음 점처럼).
   * 넘기지 않으면 구분하지 않는다.
   */
  visited?: boolean;
  /** 보이는 번호. 거른 목록에서도 원래 자리를 보이려면 넘긴다. 없으면 배열 위치 + 1. */
  ordinal?: number;
  /** 그룹 머리 문구. 직전 문서와 다르면 그 앞에 머리 행이 들어간다. */
  groupLabel?: string;
}

export interface DocumentListLabels {
  /** 목록 접근성 이름 */
  list: string;
  /** 라벨이 없는 문서 */
  untitled: string;
  /** 제외 페이지 묶음 이름 */
  excluded: string;
  /** 페이지 수 표기(예: n => `${n}쪽`) */
  pageCount: (count: number) => string;
  /** 상태 아이콘 이름(화면 낭독기가 읽는다) */
  status: Record<DocumentListStatus, string>;
  /** 판정 아이콘 이름. `flag` 를 쓰는 항목이 있으면 넘긴다. */
  flags?: Record<DocumentListFlag, string>;
  /** 열어 보지 않은 문서의 접근성 설명(라벨 뒤에 화면 낭독기로만 읽힌다). */
  unvisited?: string;
  /** 표식에 마우스를 올리면 보이는 설명. 없는 표식은 이름(`status`, `flags`, `unvisited`)을 보인다. */
  hints?: Partial<Record<DocumentListMarker, string>>;
}

/** 루트 `ref` 는 받지 않는다(내부에서 루트를 직접 잡는다). */
export interface DocumentListProps extends Omit<
  ComponentProps<"nav">,
  "onSelect" | "ref"
> {
  items: readonly DocumentListItem[];
  /** 제외 페이지 묶음. 페이지가 없으면 넘기지 않는다. */
  excluded?: { pageCount: number } | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  labels: DocumentListLabels;
  /** 루트 `data-testid`. 문서 버튼은 `<testId>-button-select`, 그룹 머리는 `-group-header`, 윈도잉 창은 `-viewport`. */
  testId?: string;
  /** 행(머리·제외 포함)이 이보다 많으면 보이는 행만 그린다. 기본 100. */
  virtualizeAbove?: number;
  /** 윈도잉할 때 행 하나의 높이(px). 기본 40. */
  rowHeight?: number;
  /** 윈도잉할 때 스크롤 창의 최대 높이(CSS 길이). 기본 `"60vh"`. */
  maxHeight?: string;
  /**
   * 표식 색 클래스(아이콘은 글자색, 점은 `bg-current` 라 역시 글자색). 넘긴 표식은 기본값
   * (`MARKER_TONE`) 대신 이 클래스를 쓴다. 시맨틱 토큰에 없는 색(경고의 노랑 등)은 host 가 넘긴다.
   */
  markerClassNames?: Partial<Record<DocumentListMarker, string>>;
}

const MARKER_TONE: Record<DocumentListMarker, string> = {
  danger: "text-destructive",
  warning: "text-foreground",
  changed: "text-primary",
  recheck: "text-muted-foreground",
  locked: "text-muted-foreground",
  excluded: "text-muted-foreground",
  unvisited: "text-primary",
};

const ICON_CLASS = "size-3.5";

function MarkerIcon({
  kind,
}: {
  kind: Exclude<DocumentListMarker, "unvisited">;
}) {
  switch (kind) {
    case "danger":
      return <CircleXIcon aria-hidden="true" className={ICON_CLASS} />;
    case "warning":
      return <TriangleAlertIcon aria-hidden="true" className={ICON_CLASS} />;
    case "changed":
      return <PencilIcon aria-hidden="true" className={ICON_CLASS} />;
    case "recheck":
      return <ScanEyeIcon aria-hidden="true" className={ICON_CLASS} />;
    case "locked":
      return <LockIcon aria-hidden="true" className={ICON_CLASS} />;
    case "excluded":
      return <BanIcon aria-hidden="true" className={ICON_CLASS} />;
  }
}

const OVERSCAN = 5;

/**
 * 문서 배치 순서대로 문서를 나열하고 하나를 고르게 한다(제어형). 라벨, 판정 아이콘과 상태 아이콘, 페이지
 * 수를 보이고(아이콘과 안 읽음 점에 마우스를 올리면 설명), 제외 페이지 묶음은 맨 아래 흐리게 둔다. 넓은 화면에서는 세로 목록, 좁은 화면에서는
 * 가로로 스크롤되는 줄이 된다. `groupLabel` 이 바뀌는 자리에는 그룹 머리를 넣는다.
 *
 * 행이 `virtualizeAbove` 를 넘으면 행 높이를 `rowHeight` 로 고정한 자체 스크롤 창(`maxHeight`)
 * 안에 보이는 행과 위·아래 여유 행만 그리고 나머지는 스페이서로 채운다. 이때는 좁은 화면에서도
 * 세로 목록이다. 선택 문서가 바뀌면 그 행이 보이도록 창(또는 페이지)을 가장 가까운 쪽으로 옮긴다.
 */
export function DocumentList({
  items,
  excluded,
  selectedId,
  onSelect,
  labels,
  testId,
  virtualizeAbove = 100,
  rowHeight = 40,
  maxHeight = "60vh",
  markerClassNames,
  className,
  ...props
}: DocumentListProps) {
  const rows = useMemo(() => buildRows(items, excluded), [items, excluded]);
  const virtual = rows.length > virtualizeAbove;
  const selectedIndex =
    selectedId === null
      ? -1
      : rows.findIndex(
          row => row.kind === "item" && row.item.id === selectedId,
        );

  const hintIdBase = useId();
  const rootRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLUListElement>(null);
  const frameRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // 스크롤 이벤트는 프레임당 한 번만 상태로 옮긴다.
  const onScroll = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const viewport = viewportRef.current;
      if (viewport) setScrollTop(viewport.scrollTop);
    });
  };
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // 창 높이는 붙을 때 한 번 재고 그 뒤 변화는 ResizeObserver 로 따라간다.
  useEffect(() => {
    if (!virtual) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setViewportHeight(viewport.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [virtual]);

  // 선택 문서(또는 그 자리)가 바뀌면 그 행을 보이게 한다. 상태 점만 바뀌는 재렌더에는 움직이지
  // 않는다. 윈도잉 창은 자기 스크롤만 옮기므로 처음 붙을 때와 거른 뒤 자리가 바뀔 때도 옮기지만,
  // 비가상 목록은 페이지 전체를 움직이므로 선택이 실제로 바뀐 때만 옮긴다(처음 열 때·거를 때 제외).
  const lastSelectedRef = useRef(selectedId);
  useEffect(() => {
    const selectionChanged = lastSelectedRef.current !== selectedId;
    lastSelectedRef.current = selectedId;
    if (selectedIndex < 0) return;
    if (virtual) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const next = scrollTopToReveal({
        index: selectedIndex,
        rowHeight,
        scrollTop: viewport.scrollTop,
        viewportHeight: viewport.clientHeight,
      });
      if (next !== null) {
        viewport.scrollTop = next;
        setScrollTop(next);
      }
    } else if (selectionChanged) {
      const current = rootRef.current?.querySelector('[aria-current="true"]');
      if (current && typeof current.scrollIntoView === "function") {
        current.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }, [selectedIndex, selectedId, virtual, rowHeight]);

  const toneOf = (kind: DocumentListMarker) =>
    markerClassNames?.[kind] ?? MARKER_TONE[kind];

  // 판정 아이콘과 상태 아이콘. 이름은 화면 낭독기용 글자로 행 이름에 들어가고, 설명은 마우스를 올리면 보인다.
  const renderMarker = (
    kind: Exclude<DocumentListMarker, "unvisited">,
    name: string,
  ): ReactNode => (
    <Tooltip key={kind}>
      <TooltipTrigger asChild>
        <span
          className={cn("flex shrink-0 items-center", toneOf(kind))}
          data-marker={kind}
        >
          <MarkerIcon kind={kind} />
          <span className="sr-only">{name}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{labels.hints?.[kind] ?? name}</TooltipContent>
    </Tooltip>
  );

  // 툴팁 문구(`hints.unvisited`·`unvisited`)가 둘 다 없으면 빈 툴팁을 띄우지 않고 점만 그린다.
  const renderUnvisitedDot = (tip: string | undefined) => {
    const dot = (
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-y-0 left-0 flex w-3 items-center justify-center",
          toneOf("unvisited"),
        )}
        data-marker="unvisited"
      >
        <span className="size-1.5 rounded-full bg-current" />
      </span>
    );
    if (!tip) return dot;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{dot}</TooltipTrigger>
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
    );
  };

  const renderRow = (row: ListRow<DocumentListItem>): ReactNode => {
    const rowStyle = virtual ? { height: rowHeight } : undefined;
    const liClass = virtual ? "shrink-0" : "shrink-0 xl:shrink";
    if (row.kind === "header") {
      return (
        <li
          key={row.key}
          role="presentation"
          style={rowStyle}
          data-testid={testId ? `${testId}-group-header` : undefined}
          className={cn(
            "px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground",
            liClass,
            virtual && "flex items-end truncate whitespace-nowrap",
          )}
        >
          {row.label}
        </li>
      );
    }
    if (row.kind === "excluded") {
      return (
        <li key={row.key} style={rowStyle} className={liClass}>
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground opacity-70",
              virtual && "h-full py-0",
            )}
          >
            <span className="w-5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{labels.excluded}</span>
            <span className="shrink-0 text-xs tabular-nums">
              {labels.pageCount(row.pageCount)}
            </span>
          </div>
        </li>
      );
    }
    const { item, ordinal } = row;
    const selected = item.id === selectedId;
    const unvisited = item.visited === false;
    const flagName = item.flag ? labels.flags?.[item.flag] : undefined;
    // 표식 설명(마우스를 올리면 보이는 문구)을 키보드와 화면 낭독기에도 행 버튼의 설명으로 읽힌다.
    const hintKinds: DocumentListMarker[] = [];
    if (item.flag && flagName) hintKinds.push(item.flag);
    if (item.status) hintKinds.push(item.status);
    if (unvisited && labels.unvisited) hintKinds.push("unvisited");
    const hints = hintKinds.flatMap(kind => {
      const text = labels.hints?.[kind];
      return text
        ? [
            {
              id: `${hintIdBase}-${row.key.replace(/\s+/g, "_")}-${kind}`,
              text,
            },
          ]
        : [];
    });
    return (
      <li key={row.key} style={rowStyle} className={liClass}>
        <Button
          type="button"
          aria-describedby={
            hints.length > 0 ? hints.map(hint => hint.id).join(" ") : undefined
          }
          variant="ghost"
          aria-current={selected ? "true" : undefined}
          onClick={() => onSelect(item.id)}
          data-testid={testId ? `${testId}-button-select` : undefined}
          data-document-id={item.id}
          className={cn(
            // `relative`: 화면 낭독기 전용 문구(`sr-only`, absolute)가 행 안에 머물러 스크롤 창 밖으로 빠져 페이지를 늘리지 않게 한다.
            "relative w-full cursor-pointer justify-start gap-2 border-l-2 px-3 text-left focus-visible:ring-ring motion-reduce:transition-none",
            virtual ? "h-full py-0" : "h-auto py-2 whitespace-normal",
            selected
              ? // 고른 행은 중립 회색 바탕과 진한 글자(Studio 사이드 메뉴의 고른 항목처럼). 색은 상태 표식에만 쓴다.
                "border-l-foreground bg-muted font-medium text-foreground hover:bg-muted"
              : "border-l-transparent",
            item.status === "excluded" && "opacity-60",
          )}
        >
          {unvisited
            ? // 안 읽음 점: 행 왼쪽 여백(번호 앞)에 둬 행 배치가 바뀌지 않는다. 문구는 라벨 뒤 sr-only 가 읽는다.
              renderUnvisitedDot(labels.hints?.unvisited ?? labels.unvisited)
            : null}
          <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
            {ordinal}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              virtual && "whitespace-nowrap",
              item.label === null && "text-muted-foreground italic",
            )}
          >
            {item.label ?? labels.untitled}
            {unvisited && labels.unvisited ? (
              <span className="sr-only"> {labels.unvisited}</span>
            ) : null}
          </span>
          {(item.flag && flagName) || item.status ? (
            <span
              className="flex shrink-0 items-center gap-1"
              data-flag={item.flag}
            >
              {item.flag && flagName ? renderMarker(item.flag, flagName) : null}
              {item.status
                ? renderMarker(item.status, labels.status[item.status])
                : null}
            </span>
          ) : null}
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {labels.pageCount(item.pageCount)}
          </span>
        </Button>
        {hints.map(hint => (
          <span key={hint.id} id={hint.id} hidden>
            {hint.text}
          </span>
        ))}
      </li>
    );
  };

  let list: ReactNode;
  if (virtual) {
    const visible = listWindow({
      count: rows.length,
      rowHeight,
      scrollTop,
      viewportHeight,
      overscan: OVERSCAN,
    });
    list = (
      <ul
        role="list"
        ref={viewportRef}
        onScroll={onScroll}
        style={{ maxHeight }}
        className="flex flex-col overflow-y-auto"
        data-testid={testId ? `${testId}-viewport` : undefined}
      >
        <li
          key="top"
          aria-hidden
          className="shrink-0"
          style={{ height: visible.topSpacer }}
        />
        {rows.slice(visible.start, visible.end).map(renderRow)}
        <li
          key="bottom"
          aria-hidden
          className="shrink-0"
          style={{ height: visible.bottomSpacer }}
        />
      </ul>
    );
  } else {
    list = (
      <ul
        // 목록 표식을 지운 목록은 Safari 가 목록으로 읽지 않아 role 을 명시한다.
        role="list"
        className="flex gap-1 overflow-x-auto pb-1 xl:flex-col xl:overflow-x-visible xl:pb-0"
      >
        {rows.map(renderRow)}
      </ul>
    );
  }

  return (
    <nav
      {...props}
      ref={rootRef}
      aria-label={labels.list}
      data-testid={testId}
      className={cn("min-w-0", className)}
    >
      <TooltipProvider delayDuration={200}>{list}</TooltipProvider>
    </nav>
  );
}
