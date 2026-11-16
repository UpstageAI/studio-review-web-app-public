"use client";

import { useTranslations } from "next-intl";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useRouter, Link } from "@/i18n/navigation";
import type {
  CollectionLineage,
  CollectionLineageEdge,
  CollectionLineageNode,
  ReviewProgress,
} from "@/lib/review-api/types";
import { cn } from "@/lib/utils";
import { CopyIdButton } from "@/components/collections/copy-id-button";
import {
  LINEAGE_METRICS,
  layoutLineage,
  relatedCollections,
  type PlacedLabel,
} from "./lineage-layout";
import {
  ListEmpty,
  ListError,
  ListLoading,
} from "@/components/collections/list-state";
import {
  collectionHref,
  isRowNavigationClick,
} from "@/components/collections/links";
import { ReviewProgressCell } from "../review-overview/review-overview";
import { workflowName } from "@/components/collections/source-label";
import { SourceBadge } from "@/components/collections/source-badge";
import { useCollectionLineage } from "./use-collection-lineage";
import { useReviewOverview } from "../review-overview/use-review-overview";

/** `/api/review-progress` 가 한 번에 받는 Collection 수. */
const MAX_REVIEW_COUNT_IDS = 100;

/**
 * Collection 관계 보기. 왼쪽 Collection 의 결과를 이어 받아 오른쪽 Collection 이 만들어진 흐름을
 * 화살표로 그린다. 페이지·필터와 상관없이 서버가 찾은 연결 전체를 보이고, 연결이 없는 Collection 은
 * 수만 알린다. 목록에 없는 기본 Collection 은 다른 Collection 의 원본일 때만 나온다. 카드에 마우스를 올리거나 포커스하면 그 카드의 원본과 결과만 진하게 남는다.
 */
export function CollectionLineageView() {
  const t = useTranslations("collections");
  const lineage = useCollectionLineage();

  if (lineage.phase === "loading") {
    return (
      <div className="flex flex-col gap-2">
        <ListLoading label={t("lineage.loading")} />
        <p className="text-xs text-muted-dark">{t("lineage.loadingHint")}</p>
      </div>
    );
  }
  if (lineage.phase === "error") {
    return (
      <ListError
        error={lineage.error}
        onRetry={lineage.retry}
        testId="collections-lineage-button-retry"
      />
    );
  }
  const { data, retry } = lineage;
  if (data.edges.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <ListEmpty
          title={t("lineage.emptyTitle")}
          description={t("lineage.emptyDescription")}
        />
        {data.unverified_count > 0 ? (
          <p className="text-xs text-muted-dark">
            {t("lineage.unverified", { count: data.unverified_count })}
          </p>
        ) : null}
        {data.partial ? <PartialNotice onRetry={retry} /> : null}
      </div>
    );
  }
  return <LineageGraph lineage={data} onRetry={retry} />;
}

function PartialNotice({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("collections.lineage");
  return (
    <div
      role="status"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-dark"
      data-testid="collections-lineage-partial"
    >
      <span>{t("partial")}</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        data-testid="collections-lineage-button-retry-partial"
      >
        {t("partialRetry")}
      </Button>
    </div>
  );
}

function LineageGraph({
  lineage,
  onRetry,
}: {
  lineage: CollectionLineage;
  onRetry: () => void;
}) {
  const t = useTranslations("collections.lineage");
  const {
    nodes,
    edges,
    unrelated_count: unrelated,
    unverified_count: unverified,
    partial,
  } = lineage;
  const layout = useMemo(() => layoutLineage(nodes, edges), [nodes, edges]);
  const nodeById = useMemo(
    () => new Map(nodes.map(node => [node.id, node])),
    [nodes],
  );
  const [active, setActive] = useState<string | null>(null);
  const related = useMemo(
    () => (active === null ? null : relatedCollections(active, edges)),
    [active, edges],
  );
  const reviewable = useMemo(
    () => nodes.filter(node => !node.missing).map(node => node.id),
    [nodes],
  );
  const review = useReviewOverview(
    reviewable.length <= MAX_REVIEW_COUNT_IDS ? reviewable : [],
  );
  const counts =
    reviewable.length <= MAX_REVIEW_COUNT_IDS ? review.collections : null;
  const arrowId = useId();
  const activeArrowId = `${arrowId}-active`;

  const isDimmed = (id: string) => related !== null && !related.has(id);
  const isEdgeActive = (from: string, to: string) =>
    related !== null && related.has(from) && related.has(to);

  return (
    <div className="flex flex-col gap-2 lg:min-h-0">
      <div
        className="min-h-48 overflow-auto rounded-lg border border-border lg:min-h-0"
        data-testid="collections-lineage-graph"
      >
        <div
          className="relative"
          style={{ width: layout.width, height: layout.height }}
        >
          <svg
            aria-hidden="true"
            className="absolute inset-0"
            width={layout.width}
            height={layout.height}
          >
            <defs>
              <ArrowMarker id={arrowId} className="fill-muted-foreground/70" />
              <ArrowMarker id={activeArrowId} className="fill-primary" />
            </defs>
            {layout.edges.map(edge => {
              const highlighted = isEdgeActive(edge.from, edge.to);
              return (
                <path
                  // id 에 "-" 가 들어갈 수 있어 이어 붙이면 다른 쌍과 겹친다.
                  key={JSON.stringify([edge.from, edge.to])}
                  d={edge.path}
                  fill="none"
                  strokeWidth={highlighted ? 2 : 1.5}
                  markerEnd={`url(#${highlighted ? activeArrowId : arrowId})`}
                  className={cn(
                    "transition-opacity",
                    highlighted
                      ? "stroke-primary"
                      : "stroke-muted-foreground/70",
                    related !== null && !highlighted && "opacity-25",
                  )}
                  data-testid="collections-lineage-edge"
                />
              );
            })}
          </svg>
          {layout.labels.map(label => (
            <EdgeLabel
              key={JSON.stringify([label.to, label.kind])}
              label={label}
              dimmed={isDimmed(label.to)}
            />
          ))}
          <ul aria-label={t("graphLabel")}>
            {layout.nodes.map(placed => {
              const node = nodeById.get(placed.id);
              if (!node) return null;
              return (
                <li
                  key={placed.id}
                  className={cn(
                    "absolute transition-opacity",
                    isDimmed(placed.id) && "opacity-40",
                  )}
                  style={{
                    left: placed.x,
                    top: placed.y,
                    width: LINEAGE_METRICS.nodeWidth,
                    height: LINEAGE_METRICS.nodeHeight,
                  }}
                  onMouseEnter={() => setActive(placed.id)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(placed.id)}
                  onBlur={event => {
                    // 같은 카드 안에서 링크와 복사 버튼 사이를 오가면 강조를 유지한다.
                    const next = event.relatedTarget as Node | null;
                    if (!event.currentTarget.contains(next)) setActive(null);
                  }}
                  data-testid="collections-lineage-node"
                  data-collection-id={placed.id}
                >
                  <NodeCard
                    node={node}
                    edges={edges}
                    nodeById={nodeById}
                    counts={counts}
                    loading={review.loading}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="shrink-0 text-xs text-muted-dark">
        {t("hint")}
        {unrelated > 0 ? ` ${t("unrelated", { count: unrelated })}` : ""}
        {unverified > 0 ? ` ${t("unverified", { count: unverified })}` : ""}
      </p>
      {partial ? <PartialNotice onRetry={onRetry} /> : null}
    </div>
  );
}

function ArrowMarker({ id, className }: { id: string; className: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 8 8"
      refX="8"
      refY="4"
      markerWidth="8"
      markerHeight="8"
      markerUnits="userSpaceOnUse"
      orient="auto"
    >
      <path d="M 0 0 L 8 4 L 0 8 z" className={className} />
    </marker>
  );
}

/**
 * 연결 이름. 어떤 Workflow 가 이었는지는 마우스를 올리면 보인다. 화면 낭독기는 카드의 원본과 이어진 곳
 * 설명으로 관계를 읽으므로 여기서는 읽지 않는다.
 */
function EdgeLabel({ label, dimmed }: { label: PlacedLabel; dimmed: boolean }) {
  const t = useTranslations("collections");
  const text =
    label.kind === "import"
      ? t("lineage.importEdge")
      : t("lineage.resultImportEdge");
  const title =
    label.workflows.length > 0
      ? t("lineage.importEdgeTitle", { workflows: label.workflows.join(", ") })
      : text;
  return (
    <div
      aria-hidden="true"
      className={cn(
        "absolute flex justify-center transition-opacity",
        dimmed && "opacity-25",
      )}
      style={{ left: label.x, top: label.y, width: label.width }}
    >
      {/* 다른 연결선이 지나가도 글자가 읽히도록 바탕을 깐다. */}
      <span
        title={title}
        className="truncate rounded-sm bg-background px-1 text-xs text-muted-dark"
        data-testid="collections-lineage-edge-label"
      >
        {text}
      </span>
    </div>
  );
}

function NodeCard({
  node,
  edges,
  nodeById,
  counts,
  loading,
}: {
  node: CollectionLineageNode;
  edges: readonly CollectionLineageEdge[];
  nodeById: ReadonlyMap<string, CollectionLineageNode>;
  counts: Record<string, ReviewProgress> | null;
  loading: boolean;
}) {
  const t = useTranslations("collections");
  const router = useRouter();
  if (node.missing) {
    return (
      // 링크와 버튼이 없어 이 자리로 포커스를 받아야 키보드로도 연결 강조를 볼 수 있다.
      <div
        tabIndex={0}
        className="flex h-full flex-col justify-center gap-1 rounded-lg border border-border bg-muted/50 p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="collections-lineage-card-missing"
      >
        <p className="text-sm text-muted-dark">{t("lineage.missing")}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {node.id}
        </p>
      </div>
    );
  }
  const href = collectionHref(node.id);
  const name = node.name || t("untitled");
  const workflow = workflowName(node.source);
  const nameOf = (id: string) => {
    const other = nodeById.get(id);
    return other?.missing ? id : other?.name || t("untitled");
  };
  // 두 Workflow 가 같은 두 Collection 을 이으면 연결은 둘이어도 이름은 한 번만 읽는다.
  const namesOf = (ids: string[]) => [...new Set(ids.map(nameOf))].join(", ");
  const sources = edges
    .filter(edge => edge.to === node.id)
    .map(edge => edge.from);
  const results = edges
    .filter(edge => edge.from === node.id)
    .map(edge => edge.to);
  return (
    <div
      className="flex h-full cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-3 shadow-xs transition-colors hover:bg-muted-light"
      onClick={event => {
        if (isRowNavigationClick(event)) router.push(href);
      }}
      data-testid="collections-lineage-card-open"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Link
          href={href}
          className="truncate text-sm font-medium text-foreground hover:underline"
          title={name}
          data-testid="collections-lineage-link-open"
        >
          {name}
        </Link>
        <CopyIdButton
          id={node.id}
          testId="collections-lineage-button-copy-id"
        />
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-dark">
        <SourceBadge collection={node} />
        {workflow ? (
          <span className="truncate" title={workflow}>
            {workflow}
          </span>
        ) : null}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 text-xs text-muted-dark">
        <span className="shrink-0">
          {/* 개수를 모르면 0 개로 보이지 않게 목록 표처럼 "—" 로 둔다. */}
          {typeof node.total_job_count === "number"
            ? t("lineage.jobs", { count: node.total_job_count })
            : `${t("columns.jobs")} —`}
        </span>
        <div className="flex min-w-0 flex-1 justify-end">
          <ReviewProgressCell
            row={node}
            counts={counts}
            loading={loading}
            compact
          />
        </div>
      </div>
      {sources.length > 0 ? (
        <span className="sr-only">
          {t("lineage.srSources", { names: namesOf(sources) })}
        </span>
      ) : null}
      {results.length > 0 ? (
        <span className="sr-only">
          {t("lineage.srResults", { names: namesOf(results) })}
        </span>
      ) : null}
    </div>
  );
}
