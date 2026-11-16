"use client";

import { CircleAlertIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SearchCollectionDetail } from "@/lib/review-api/types";
import { CopyIdButton } from "./copy-id-button";
import { KindLabel } from "./kind-label";
import { SourceBadge } from "./source-badge";

/**
 * Collection 상세 머리: 이름, 출처 배지(문서가 아닌 종류면 종류 배지도), ID 툴팁(누르면 복사), 설명.
 * 그 아래 요약 카드 줄(검수 진행 카드 `progress` 를 맨 앞에 넓게, 이어서 Job 수와 최신 설정
 * (latest Config) 정보 카드). Job 수 카드는 라벨 옆 정보 버튼의 툴팁으로 무엇을 센 수인지 알리고,
 * 최신 설정 Job 카드는 `visibleRows` 가 있으면 아래 표에 지금 보이는 행 수를 보조 줄로 함께 보인다.
 */
export function CollectionSummary({
  collection,
  progress,
  visibleRows,
}: {
  collection: SearchCollectionDetail;
  /** 요약 카드 줄 맨 앞에 넓게 둘 검수 진행 카드(검수 미지원이면 없음). */
  progress?: ReactNode;
  /**
   * 아래 Job 표가 기본 보기일 때 이미 받은 행 수. `more` 면 더 받을 쪽이 남아 있다. 없으면 보조 줄을
   * 숨긴다(이 수를 얻으려 따로 요청하지 않는다).
   */
  visibleRows?: VisibleRows | null;
}) {
  const t = useTranslations("collections");
  const locale = useLocale();
  const number = (value: number) => value.toLocaleString(locale);

  const stats: Stat[] = [];
  if (typeof collection.total_job_count === "number") {
    stats.push({
      key: "totalJobs",
      label: t("summary.totalJobs"),
      value: collection.total_job_count,
      help: t("summary.totalJobsHelp"),
      hint: t("summary.totalJobsHint"),
    });
  }
  if (typeof collection.latest_config_job_count === "number") {
    stats.push({
      key: "latestConfigJobs",
      label: t("summary.latestConfigJobs"),
      value: collection.latest_config_job_count,
      help: t("summary.latestConfigJobsHelp"),
      hint: t("summary.latestConfigJobsHint"),
      sub: visibleRows
        ? visibleRows.more
          ? t("summary.visibleRowsMore", { count: number(visibleRows.count) })
          : t("summary.visibleRows", { count: number(visibleRows.count) })
        : undefined,
    });
  }
  if (Array.isArray(collection.latest_config_ids)) {
    stats.push({
      key: "latestConfigs",
      label: t("summary.latestConfigs"),
      value: collection.latest_config_ids.length,
    });
  }

  return (
    <div className="flex shrink-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {collection.name || t("untitled")}
          </h1>
          {/* 이 앱이 검수하는 대상은 문서 Collection 이라 그때는 종류를 보이지 않고, 주소로 들어온
              다른 종류(표 등)일 때만 보인다. */}
          {collection.kind && collection.kind !== "documents" ? (
            <Badge variant="outline">
              <KindLabel kind={collection.kind} />
            </Badge>
          ) : null}
          <SourceBadge collection={collection} />
          {/* ID 는 이름 옆 버튼의 툴팁으로 보이고, 누르면 복사한다. */}
          <CopyIdButton
            id={collection.id}
            testId="collection-detail-button-copy-id"
          />
        </div>
        {collection.description && (
          <p className="text-sm text-muted-dark">{collection.description}</p>
        )}
      </header>
      {progress || stats.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {progress}
          {stats.map(stat => (
            <dl
              key={stat.key}
              className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-xs"
              data-testid={`collection-detail-stat-${stat.key}`}
            >
              <dt className="flex items-center gap-1 text-xs font-medium text-muted-dark">
                {stat.label}
                {stat.help && stat.hint ? (
                  <StatInfo
                    statKey={stat.key}
                    label={stat.help}
                    hint={stat.hint}
                  />
                ) : null}
              </dt>
              <dd className="text-2xl font-semibold text-foreground">
                {number(stat.value)}
              </dd>
              {stat.sub ? (
                <dd
                  className="text-xs text-muted-foreground"
                  data-testid={`collection-detail-stat-${stat.key}-rows`}
                >
                  {stat.sub}
                </dd>
              ) : null}
            </dl>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface VisibleRows {
  count: number;
  more: boolean;
}

interface Stat {
  key: "totalJobs" | "latestConfigJobs" | "latestConfigs";
  label: string;
  value: number;
  /** 정보 버튼의 접근 이름 */
  help?: string;
  /** 정보 버튼 툴팁 문구 */
  hint?: string;
  /** 값 아래 회색 보조 줄 */
  sub?: string;
}

/** 카드 라벨 옆 정보 버튼. 가리키거나 초점을 주면 그 수가 무엇을 센 것인지 툴팁으로 보인다. */
function StatInfo({
  statKey,
  label,
  hint,
}: {
  statKey: Stat["key"];
  label: string;
  hint: string;
}) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex rounded-full text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            data-testid={`collection-detail-stat-button-info-${statKey}`}
          >
            <CircleAlertIcon aria-hidden className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-72">{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
