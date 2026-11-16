"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DropReason } from "@/lib/review-model";
import { useJobReview } from "./job-review-context";
import { fileMoveOptions, isKnownDropReason } from "./structure-view";
import { useStructureActions } from "./use-structure-actions";

/** 모든 이동을 같은 사유로 막는 경우(파일 행 아래에 사유를 보인다). */
const FILE_BLOCKERS: readonly DropReason[] = [
  "mixed_file_document",
  "multi_layout_unsupported",
];

/**
 * 구성 모드의 "파일 그룹" 섹션: 그룹마다 파일 행, 파일마다 "다른 그룹으로 / 새 그룹으로
 * 분리" 메뉴. 옮길 수 없는 곳은 비활성 + 사유. 그룹이나 파일이 둘 이상일 때만 보인다.
 */
export function FileGroupSection() {
  const t = useTranslations("review.structure.fileGroups");
  const ts = useTranslations("review.structure");
  const { job, selected } = useJobReview();
  const actions = useStructureActions();
  const groups = useMemo(() => job?.file_groups?.groups ?? [], [job]);
  const options = useMemo(() => {
    const map = new Map<string, ReturnType<typeof fileMoveOptions>>();
    if (!job) return map;
    for (const group of groups) {
      for (const file of group.files) {
        map.set(file.file_ref, fileMoveOptions(job, file.file_ref));
      }
    }
    return map;
  }, [job, groups]);

  const fileCount = groups.reduce((sum, group) => sum + group.files.length, 0);
  if (!job || (groups.length < 2 && fileCount < 2)) return null;

  const reasonText = (reason: DropReason, newGroup: boolean): string => {
    if (reason === "group_mismatch") return t("reasons.layoutMismatch");
    if (newGroup && reason === "target_missing") return t("reasons.singleFile");
    return isKnownDropReason(reason)
      ? ts(`errors.${reason}`)
      : ts("errors.generic", { code: reason });
  };

  return (
    <section
      aria-labelledby="job-review-file-groups-title"
      className="flex flex-col gap-1.5"
      data-testid="job-review-file-groups"
    >
      <h3
        id="job-review-file-groups-title"
        className="text-xs font-medium text-muted-foreground"
      >
        {t("title")}
      </h3>
      <ol className="flex flex-col gap-2">
        {groups.map((group, groupIndex) => {
          const current = selected?.document.group_id === group.group_id;
          return (
            <li
              key={group.group_id}
              className="flex flex-col gap-1 rounded-md border border-border px-3 py-2"
              data-testid="job-review-file-groups-group"
            >
              <p className="text-xs font-medium">
                {t("group", { index: groupIndex + 1 })}
                {current ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {t("currentGroup")}
                  </span>
                ) : null}
              </p>
              <ul className="flex flex-col gap-1">
                {group.files.map(file => {
                  const name = file.name || file.file_ref;
                  const option = options.get(file.file_ref);
                  const blocker = option
                    ? FILE_BLOCKERS.find(
                        reason =>
                          option.newGroup === reason &&
                          option.targets.every(
                            target => target.reason === reason,
                          ),
                      )
                    : undefined;
                  return (
                    <li key={file.file_ref} className="flex flex-col gap-0.5">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm" title={name}>
                          {name}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            asChild
                            disabled={
                              !actions.editable || !option || Boolean(blocker)
                            }
                          >
                            <Button
                              type="button"
                              variant="outline"
                              size="default"
                              aria-label={t("moveMenu", { file: name })}
                              data-testid="job-review-file-groups-button-move"
                            >
                              {t("move")}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {option?.targets.map(target => (
                              <DropdownMenuItem
                                key={target.groupId}
                                disabled={target.reason !== null}
                                onSelect={() =>
                                  actions.onMoveFile(
                                    file.file_ref,
                                    target.groupId,
                                  )
                                }
                                data-testid="job-review-file-groups-menu-group"
                              >
                                <span className="flex flex-col">
                                  <span>
                                    {t("moveToGroup", {
                                      index: target.position,
                                    })}
                                  </span>
                                  {target.reason ? (
                                    <span className="text-xs text-muted-foreground">
                                      {reasonText(target.reason, false)}
                                    </span>
                                  ) : null}
                                </span>
                              </DropdownMenuItem>
                            ))}
                            {option && option.targets.length > 0 ? (
                              <DropdownMenuSeparator />
                            ) : null}
                            <DropdownMenuItem
                              disabled={!option || option.newGroup !== null}
                              onSelect={() =>
                                actions.onMoveFile(file.file_ref, null)
                              }
                              data-testid="job-review-file-groups-menu-new-group"
                            >
                              <span className="flex flex-col">
                                <span>{t("moveToNewGroup")}</span>
                                {option?.newGroup ? (
                                  <span className="text-xs text-muted-foreground">
                                    {reasonText(option.newGroup, true)}
                                  </span>
                                ) : null}
                              </span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                      {blocker ? (
                        <p className="text-xs text-muted-foreground">
                          {reasonText(blocker, false)}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
