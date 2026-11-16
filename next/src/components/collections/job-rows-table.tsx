"use client";

import { useLocale, useTranslations } from "next-intl";
import { STUDIO_TABLE_CLASS } from "@/components/studio-table";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link, useRouter } from "@/i18n/navigation";
import { isNewTabClick } from "@/lib/links";
import { cn } from "@/lib/utils";
import { formatDateTime, sumPages } from "@/lib/format";
import type { JobRow } from "@/lib/review-api/types";
import { isRowNavigationClick, jobHref } from "./links";
import { ReviewStatusBadge } from "./review-status-badge";

const STATUS_VARIANT = {
  completed: "secondary",
  failed: "destructive",
  in_progress: "outline",
  cancelled: "outline",
} as const;

type KnownStatus = keyof typeof STATUS_VARIANT;

function isKnownStatus(status: string | undefined): status is KnownStatus {
  return status !== undefined && Object.hasOwn(STATUS_VARIANT, status);
}

/** 카드 안에 꽉 차게 둘 때 첫, 끝 열을 카드 안쪽 여백(20px)에 맞춘다. */
const CARD_EDGE_CLASS = [
  "[&_[data-slot=table-head]:first-child]:pl-5",
  "[&_[data-slot=table-cell]:first-child]:pl-5",
  "[&_[data-slot=table-head]:last-child]:pr-5",
  "[&_[data-slot=table-cell]:last-child]:pr-5",
].join(" ");

/**
 * Job 행 표. 행 하나 = Job 하나, 누르면 그 Job 의 검수 화면으로 간다.
 * `onOpen` 은 이 탭에서 이동하기 직전에 동기로 불린다(검수 큐 저장).
 */
export function JobRowsTable({
  collectionId,
  rows,
  onOpen,
}: {
  collectionId: string;
  rows: readonly JobRow[];
  onOpen?: (jobId: string) => void;
}) {
  const t = useTranslations("jobRow");
  const locale = useLocale();
  const router = useRouter();

  return (
    <Table
      className={cn(STUDIO_TABLE_CLASS, CARD_EDGE_CLASS)}
      data-testid="job-rows-table"
    >
      <TableHeader>
        <TableRow>
          <TableHead>{t("columns.file")}</TableHead>
          <TableHead>{t("columns.size")}</TableHead>
          <TableHead>{t("columns.status")}</TableHead>
          <TableHead>{t("columns.review")}</TableHead>
          <TableHead>{t("columns.config")}</TableHead>
          <TableHead>{t("columns.created")}</TableHead>
          <TableHead>{t("columns.updated")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => {
          const href = jobHref(collectionId, row.job_id);
          const files = row.files ?? [];
          const fileCount = row.file_count ?? files.length;
          const pages = sumPages(files);
          const names = files
            .map(file => file.filename)
            .filter((name): name is string => Boolean(name));
          const first = names[0] ?? t("noFile");
          const extra = fileCount - 1;

          return (
            <TableRow
              key={row.job_id}
              className="cursor-pointer"
              data-testid="job-rows-table-row-open"
              onClick={event => {
                if (!isRowNavigationClick(event)) return;
                onOpen?.(row.job_id);
                router.push(href);
              }}
            >
              <TableCell className="max-w-80 2xl:max-w-[28rem]">
                <div
                  className="flex items-center gap-2"
                  title={names.join("\n") || undefined}
                >
                  <Link
                    href={href}
                    className="truncate text-foreground hover:underline"
                    data-testid="job-rows-table-link-open"
                    onClick={event => {
                      if (!isNewTabClick(event)) onOpen?.(row.job_id);
                    }}
                  >
                    {first}
                  </Link>
                  {extra > 0 && (
                    <Badge variant="outline">
                      {t("moreFiles", { count: extra })}
                    </Badge>
                  )}
                </div>
                <div className="truncate font-mono text-xs text-muted-foreground">
                  {row.job_id}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-dark">
                {pages === null
                  ? t("filesOnly", { files: fileCount })
                  : t("filesAndPages", { files: fileCount, pages })}
              </TableCell>
              <TableCell>
                {isKnownStatus(row.status) ? (
                  <Badge
                    variant={STATUS_VARIANT[row.status]}
                    data-testid="job-rows-table-badge-status"
                  >
                    {t(`status.${row.status}`)}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    data-testid="job-rows-table-badge-status"
                  >
                    {row.status ?? "—"}
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <ReviewStatusBadge
                  status={row.review_status}
                  completedAt={row.review_completed_at}
                  testId="job-rows-table-badge-review-status"
                />
              </TableCell>
              <TableCell>
                {row.config ? (
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-xs text-muted-dark"
                      title={row.config.name ?? undefined}
                    >
                      {row.config.external_id ?? row.config.id}
                    </span>
                    {row.config.is_latest && (
                      <Badge variant="secondary">{t("latestBadge")}</Badge>
                    )}
                  </div>
                ) : (
                  t("noConfig")
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-dark">
                {formatDateTime(row.created_at, locale) ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-dark">
                {formatDateTime(row.updated_at, locale) ?? "—"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
