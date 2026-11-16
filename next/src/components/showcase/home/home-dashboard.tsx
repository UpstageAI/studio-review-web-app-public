"use client";

import { ArrowRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { jobHref } from "@/components/collections/links";
import { ReviewStatusBadge } from "@/components/collections/review-status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/format";
import type { ReviewActivityResponse } from "@/lib/review-api/activity";
import { formatRelativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";
import type { DashboardJob } from "./dashboard-model";

/** 최근 검수 목록 줄 수. 줄이 적어도 이만큼 자리를 잡아 카드 높이가 바뀌지 않는다. */
export const RECENT_ROWS = 5;

const CARD = "rounded-xl border border-border bg-card shadow-xs";

type HomeDashboardProps = {
  /** 받기 전이면 `undefined`, 받지 못했으면 `null`. */
  overview: ReviewActivityResponse["overview"] | null | undefined;
  /** 받기 전이면 `undefined`. */
  continueJob: DashboardJob | null | undefined;
  /** 받기 전이면 `undefined`. */
  recent: readonly DashboardJob[] | undefined;
  /** 검수 상태를 받지 못해 브라우저 기록만 보이는지. */
  failed: boolean;
  /** 상대 시각의 기준(epoch 밀리초). */
  now: number;
};

/**
 * 검수 기록이 있을 때 홈 소개 아래에 보이는 대시보드: 검수 현황 카드 셋, 이어서 검수하기, 최근 검수.
 * 수는 앱 DB 전체(이 서버를 쓰는 모든 사람)의 기록이고, 이름은 이 브라우저에서 연 Job 만 안다.
 */
export function HomeDashboard({
  overview,
  continueJob,
  recent,
  failed,
  now,
}: HomeDashboardProps) {
  const t = useTranslations("home.dashboard");
  return (
    <section
      aria-label={t("label")}
      className="flex flex-col gap-3"
      data-testid="home-dashboard"
    >
      <OverviewStats overview={overview} />
      <div className="grid gap-3 lg:grid-cols-3">
        <ContinueCard job={continueJob} now={now} />
        <RecentList
          rows={recent}
          failed={failed}
          now={now}
          className="lg:col-span-2"
        />
      </div>
    </section>
  );
}

function OverviewStats({
  overview,
}: {
  overview: HomeDashboardProps["overview"];
}) {
  const t = useTranslations("home.dashboard.stats");
  const locale = useLocale();
  const stats = [
    { key: "inProgress", value: overview?.in_progress },
    { key: "done", value: overview?.done },
    { key: "collections", value: overview?.collections_in_progress },
  ] as const;
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {stats.map(stat => (
        <div
          key={stat.key}
          className={cn(CARD, "flex min-w-0 flex-col gap-1 p-4")}
          data-testid={`home-dashboard-stat-${stat.key}`}
        >
          <dt className="text-xs font-medium text-muted-dark">{t(stat.key)}</dt>
          <dd className="flex h-8 items-center text-2xl font-semibold text-foreground">
            {overview === undefined ? (
              <Skeleton className="h-8 w-12" />
            ) : overview === null || stat.value === undefined ? (
              <span className="text-sm font-normal text-muted-foreground">
                {t("failed")}
              </span>
            ) : (
              stat.value.toLocaleString(locale)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** 이름을 모르면 ID 를 고정폭 글꼴로 보인다. */
function NameOrId({
  name,
  id,
  className,
}: {
  name: string | null;
  id: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "truncate",
        name === null && "font-mono text-xs",
        className,
      )}
      title={name === null ? id : `${name}\n${id}`}
    >
      {name ?? id}
    </span>
  );
}

function TimeText({
  at,
  now,
  className,
}: {
  at: number | null;
  now: number;
  className?: string;
}) {
  const locale = useLocale();
  if (at === null) return <span className={className} />;
  return (
    <time
      dateTime={new Date(at).toISOString()}
      title={formatDateTime(at, locale) ?? undefined}
      className={className}
    >
      {formatRelativeTime(at, locale, now)}
    </time>
  );
}

function ContinueCard({
  job,
  now,
}: {
  job: DashboardJob | null | undefined;
  now: number;
}) {
  const t = useTranslations("home.dashboard.continue");
  return (
    <section
      aria-labelledby="home-continue-title"
      className={cn(CARD, "flex min-w-0 flex-col gap-3 p-4")}
      data-testid="home-dashboard-continue"
    >
      <h2
        id="home-continue-title"
        className="text-sm font-medium text-foreground"
      >
        {t("title")}
      </h2>
      {job === undefined ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-20" />
        </div>
      ) : job === null ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <NameOrId
            name={job.jobName}
            id={job.jobId}
            className="text-base font-medium text-foreground"
          />
          <NameOrId
            name={job.collectionName}
            id={job.collectionId}
            className="text-sm text-muted-dark"
          />
          <TimeText
            at={job.at}
            now={now}
            className="text-xs text-muted-foreground"
          />
        </div>
      )}
      <div className="mt-auto pt-1">
        {job ? (
          <Button asChild variant="outline">
            <Link
              href={jobHref(job.collectionId, job.jobId)}
              data-testid="home-continue-link-open"
            >
              {t("open")}
              <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
            </Link>
          </Button>
        ) : job === null ? (
          <Button asChild variant="outline">
            <Link
              href="/collections"
              data-testid="home-continue-link-collections"
            >
              {t("emptyAction")}
            </Link>
          </Button>
        ) : (
          <Skeleton className="h-8 w-24" />
        )}
      </div>
    </section>
  );
}

function RecentList({
  rows,
  failed,
  now,
  className,
}: {
  rows: readonly DashboardJob[] | undefined;
  failed: boolean;
  now: number;
  className?: string;
}) {
  const t = useTranslations("home.dashboard.recent");
  const hint = failed ? t("failed") : t("hint");
  return (
    <section
      aria-labelledby="home-recent-title"
      className={cn(CARD, "flex min-w-0 flex-col overflow-hidden", className)}
      data-testid="home-dashboard-recent"
    >
      <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border px-4 py-3">
        <h2
          id="home-recent-title"
          className="shrink-0 text-sm font-medium text-foreground"
        >
          {t("title")}
        </h2>
        <p
          className={cn(
            "min-w-0 truncate text-xs",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
          title={hint}
        >
          {hint}
        </p>
      </div>
      {/* 줄이 적어도 다섯 줄 자리를 잡아, 기록을 받은 뒤 카드 높이가 바뀌지 않게 한다. */}
      <ul className="flex min-h-51 flex-col divide-y divide-border">
        {rows === undefined
          ? Array.from({ length: RECENT_ROWS }, (_, index) => (
              <li key={index} className="flex h-10 items-center gap-4 px-4">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="hidden h-4 w-32 sm:block" />
                <Skeleton className="ml-auto h-5 w-14" />
              </li>
            ))
          : rows.map(row => (
              <li key={row.key}>
                <Link
                  href={jobHref(row.collectionId, row.jobId)}
                  className="grid h-10 grid-cols-[minmax(0,1fr)_auto_4.5rem] items-center gap-4 px-4 text-sm outline-none hover:bg-muted-light focus-visible:bg-muted-light focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)_auto_4.5rem]"
                  data-testid="home-recent-link-job"
                >
                  <NameOrId
                    name={row.jobName}
                    id={row.jobId}
                    className="text-foreground"
                  />
                  <NameOrId
                    name={row.collectionName}
                    id={row.collectionId}
                    className="hidden text-muted-dark sm:block"
                  />
                  <ReviewStatusBadge
                    status={row.status}
                    completedAt={row.completedAt}
                    testId="home-recent-badge-review-status"
                  />
                  <TimeText
                    at={row.at}
                    now={now}
                    className="truncate text-right text-xs text-muted-foreground"
                  />
                </Link>
              </li>
            ))}
      </ul>
    </section>
  );
}
