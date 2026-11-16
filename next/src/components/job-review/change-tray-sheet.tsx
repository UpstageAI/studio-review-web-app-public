"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChangeTray } from "@/components/job-review/change-tray";
import type {
  ChangeTrayGroup,
  ChangeTrayStatus,
  ChangeTraySummaryItem,
} from "@/components/job-review/change-tray";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { requestLeaveConfirm } from "@/lib/leave-confirm";
import {
  MAX_INLINE_IMPORT_BYTES,
  STRUCTURE_GROUP_ID,
  buildUploadBody,
  hasBlockingIssues,
  stringifyJson,
  type IssueCode,
  type ValidationIssue,
} from "@/lib/review-model";
import {
  describeBatch,
  describeEntry,
  groupEntries,
  originNoteOf,
  type ChangeText,
} from "./describe-change";
import { useJobReview } from "./job-review-context";
import { formatBytes, isSaveErrorCode } from "./save-errors";
import { saveReadiness } from "./save-readiness";

const SUMMARY_ROWS: readonly {
  id: string;
  codes: readonly IssueCode[];
  okKey: "missingOk" | "overlapOk" | "valuesOk" | "limitOk";
}[] = [
  { id: "missing", codes: ["page_missing"], okKey: "missingOk" },
  {
    id: "overlap",
    codes: ["duplicate_review_page", "page_overlap"],
    okKey: "overlapOk",
  },
  {
    id: "values",
    codes: ["schema_violation", "result_not_editable"],
    okKey: "valuesOk",
  },
  {
    id: "limit",
    codes: ["package_limit_exceeded", "review_limit_exceeded"],
    okKey: "limitOk",
  },
];

const KNOWN_ISSUES: readonly IssueCode[] = [
  "page_missing",
  "duplicate_review_page",
  "page_overlap",
  "page_out_of_range",
  "label_not_in_config",
  "review_file_unavailable",
  "review_group_unavailable",
  "review_document_unavailable",
  "review_step_unavailable",
  "duplicate_review_file",
  "review_limit_exceeded",
  "schema_violation",
  "result_not_editable",
  "package_limit_exceeded",
];

function isKnownIssue(code: string): code is IssueCode {
  return (KNOWN_ISSUES as readonly string[]).includes(code);
}

/** 변경 사항 트레이(오른쪽 시트): 항목·되돌리기·저장 전 검증·저장 결과·업로드 본문 보기. */
export function ChangeTraySheet() {
  const t = useTranslations("review.tray");
  const { state, dispatch } = useJobReview();
  return (
    <Sheet
      open={state.trayOpen}
      onOpenChange={open =>
        dispatch({ type: open ? "OPEN_TRAY" : "CLOSE_TRAY" })
      }
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        onCloseAutoFocus={event => {
          // 트레이는 Sheet 트리거 없이 열리므로, 닫힐 때 헤더의 트레이 버튼으로 포커스를 돌린다.
          const opener = document.querySelector<HTMLElement>(
            '[data-testid="job-review-tray-button-open"]',
          );
          if (opener) {
            event.preventDefault();
            opener.focus();
          }
        }}
        className="w-full gap-0 sm:max-w-md"
        data-testid="job-review-tray"
      >
        <SheetHeader className="flex-row items-start justify-between gap-2 border-b border-border">
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle
              tabIndex={-1}
              className="outline-hidden"
              data-testid="job-review-tray-title"
            >
              {t("title")}
            </SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: "CLOSE_TRAY" })}
            data-testid="job-review-tray-button-close"
          >
            {t("close")}
          </Button>
        </SheetHeader>
        {state.trayOpen ? <TrayBody /> : null}
      </SheetContent>
    </Sheet>
  );
}

function TrayBody() {
  const t = useTranslations("review.tray");
  const ti = useTranslations("review.issues");
  const td = useTranslations("review.documents");
  const ts = useTranslations("review.save");
  const format = useFormatter();
  const conflictHintId = useId();
  const { state, dispatch, job, documents, issues, save, saving } =
    useJobReview();
  const { session, capabilities } = state;
  const entries = useMemo(() => session?.entries ?? [], [session?.entries]);
  const [showJson, setShowJson] = useState(false);

  const maxBytes =
    capabilities?.max_inline_import_bytes ?? MAX_INLINE_IMPORT_BYTES;
  const upload = useMemo(
    () =>
      session
        ? buildUploadBody(session.base, session.current, { maxBytes })
        : null,
    [session, maxBytes],
  );

  const flagged = useMemo(() => {
    const save = state.save;
    if (save.phase === "conflict") return new Set(save.conflict.entryIds);
    if (save.phase === "failed") return new Set(save.entryIds);
    return new Set<string>();
  }, [state.save]);

  const labelOf = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const item of documents) {
      map.set(item.document.document_id, item.document.label);
    }
    return map;
  }, [documents]);

  const fileNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const group of job?.file_groups?.groups ?? []) {
      for (const file of group.files) {
        names.set(file.file_ref, file.name || file.file_ref);
      }
    }
    return names;
  }, [job]);

  // 트레이 항목 → 되돌릴 변경 항목 id 들. 일괄 편집 묶음은 한 줄이고 묶음째 되돌린다.
  const { groups, revertIds } = useMemo(() => {
    const placeholders = {
      untitled: td("untitled"),
      empty: t("emptyValue"),
      nullValue: t("nullValue"),
      arrayIndex: (index: number) => t("fragments.arrayIndex", { index }),
      fileName: (ref: string) => fileNames.get(ref) ?? ref,
    };
    // 조각 목록은 조각마다 문구를 만들어 locale 의 나열 형식으로 이어 값으로 넣는다.
    const textOf = (text: ChangeText) => {
      const values: Record<string, string | number> = { ...text.values };
      for (const [name, fragments] of Object.entries(text.lists ?? {})) {
        values[name] = format.list(
          fragments.map(fragment =>
            t(`fragments.${fragment.key}`, fragment.values),
          ),
          { type: "conjunction" },
        );
      }
      return t(`items.${text.key}`, values);
    };
    const revertIds = new Map<string, readonly string[]>();
    const groups: ChangeTrayGroup[] = groupEntries(entries).map(group => {
      const current = labelOf.has(group.documentId)
        ? labelOf.get(group.documentId)
        : group.documentLabel;
      return {
        id: group.documentId || "\u0000none",
        documentLabel:
          group.documentId === ""
            ? t("noDocument")
            : group.documentId === STRUCTURE_GROUP_ID
              ? t("structureGroup")
              : (current ?? td("untitled")),
        items: group.units.map(unit => {
          if (unit.kind === "entry") {
            const text = describeEntry(unit.entry, placeholders);
            const note = originNoteOf(unit.entry);
            return {
              id: unit.entry.id,
              text: textOf(text),
              conflict: flagged.has(unit.entry.id),
              note: note
                ? note.key === "origin.revision"
                  ? t(note.key, note.values)
                  : t(note.key)
                : undefined,
            };
          }
          const id = `batch:${unit.batchId}`;
          revertIds.set(
            id,
            unit.entries.map(entry => entry.id),
          );
          const text = describeBatch(unit.entries, placeholders);
          return {
            id,
            text: textOf(text),
            conflict: unit.entries.some(entry => flagged.has(entry.id)),
          };
        }),
      };
    });
    return { groups, revertIds };
  }, [entries, labelOf, flagged, fileNames, format, t, td]);

  const allIssues = useMemo<ValidationIssue[]>(() => {
    const extra =
      upload?.issues.filter(issue => issue.code === "package_limit_exceeded") ??
      [];
    return [...issues, ...extra];
  }, [issues, upload]);

  const summary = useMemo<ChangeTraySummaryItem[]>(() => {
    const counts = new Map<string, { count: number; error: boolean }>();
    let coverageUnknown = false;
    for (const issue of allIssues) {
      if (issue.detail?.coverageUnknown) {
        coverageUnknown = true;
        continue;
      }
      const entry = counts.get(issue.code) ?? { count: 0, error: false };
      entry.count += 1;
      entry.error ||= issue.severity === "error";
      counts.set(issue.code, entry);
    }
    const text = (code: string, count: number) =>
      isKnownIssue(code) ? ti(code, { count }) : ti("other", { code, count });
    const rows: ChangeTraySummaryItem[] = [];
    const used = new Set<string>();
    for (const row of SUMMARY_ROWS) {
      const failing = row.codes.filter(code => counts.get(code)?.error);
      row.codes.forEach(code => used.add(code));
      const sizeDetail =
        row.id === "limit" && upload && upload.bytes > 0
          ? t("summary.size", {
              size: formatBytes(upload.bytes),
              limit: formatBytes(maxBytes),
            })
          : undefined;
      if (failing.length === 0) {
        rows.push({
          id: row.id,
          label: t(`summary.${row.okKey}`),
          ok: true,
          ...(sizeDetail ? { detail: sizeDetail } : {}),
        });
      } else {
        for (const code of failing) {
          rows.push({
            id: `${row.id}:${code}`,
            label: text(code, counts.get(code)?.count ?? 0),
            ok: false,
            ...(sizeDetail ? { detail: sizeDetail } : {}),
          });
        }
      }
    }
    for (const [code, entry] of counts) {
      if (used.has(code)) continue;
      rows.push({
        id: code,
        label: text(code, entry.count),
        ok: !entry.error,
      });
    }
    if (coverageUnknown) {
      rows.push({
        id: "coverage",
        label: t("summary.coverageUnknown"),
        ok: true,
      });
    }
    return rows;
  }, [allIssues, upload, maxBytes, t, ti]);

  const status = useTrayStatus();
  const readiness = saveReadiness({
    changeCount: entries.length,
    save: state.save,
    saving,
    blocking: hasBlockingIssues(allIssues),
  });
  const { blocking, conflicted } = readiness;
  const canSave =
    readiness.hasChanges &&
    !readiness.saving &&
    !readiness.blocking &&
    !readiness.conflicted;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex justify-end">
          <RevertAllButton count={entries.length} disabled={saving} />
        </div>
        <ChangeTray
          groups={groups}
          onRevert={id =>
            dispatch({ type: "REVERT", entryIds: revertIds.get(id) ?? [id] })
          }
          revertDisabled={saving}
          summary={summary}
          status={status}
          emptyHint={[t("hint.structure"), t("hint.values"), t("hint.save")]}
          advanced={
            upload?.body ? (
              <details
                className="min-w-0 rounded-md border border-border"
                onToggle={event => setShowJson(event.currentTarget.open)}
              >
                <summary
                  className="cursor-pointer rounded-md px-3 py-2 text-xs font-medium text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden"
                  data-testid="job-review-tray-json-toggle"
                >
                  {t("advanced", { size: formatBytes(upload.bytes) })}
                </summary>
                {showJson ? (
                  <pre
                    className="max-h-96 overflow-auto border-t border-border p-3 font-mono text-xs"
                    data-testid="job-review-tray-json"
                  >
                    {stringifyJson(upload.body, { pretty: true })}
                  </pre>
                ) : null}
              </details>
            ) : null
          }
          labels={{
            changes: t("changes", { count: entries.length }),
            revert: t("revert"),
            revertItem: text => t("revertItem", { text }),
            conflict: t("conflict"),
            summary: t("summary.title"),
            passed: t("summary.passed"),
            failed: t("summary.failed"),
            emptyTitle: t("emptyTitle"),
          }}
          testId="job-review-tray-body"
        />
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-4">
        <Button
          type="button"
          disabled={!canSave}
          aria-describedby={conflicted ? conflictHintId : undefined}
          onClick={save}
          data-testid="job-review-tray-button-save"
        >
          {saving ? t("saving") : t("save")}
        </Button>
        {conflicted ? (
          <p
            id={conflictHintId}
            className="text-xs text-destructive"
            data-testid="job-review-tray-save-conflict-hint"
          >
            {ts("conflictHint")}
          </p>
        ) : blocking && entries.length > 0 ? (
          <p className="text-xs text-destructive">{t("blockedHint")}</p>
        ) : null}
      </div>
    </div>
  );
}

/** 트레이의 변경을 확인 뒤 한 번에 버린다. 항목이 없거나 저장 중이면 비활성. */
function RevertAllButton({
  count,
  disabled,
}: {
  count: number;
  disabled: boolean;
}) {
  const t = useTranslations("review.tray");
  const { dispatch } = useJobReview();
  const [open, setOpen] = useState(false);
  const confirmed = useRef(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="default"
        disabled={disabled || count === 0}
        onClick={() => {
          confirmed.current = false;
          setOpen(true);
        }}
        data-testid="job-review-tray-button-revert-all"
      >
        {t("revertAll")}
      </Button>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onCloseAutoFocus={event => {
          // 되돌린 뒤에는 버튼이 비활성이 되므로 트레이 제목으로 포커스를 옮긴다.
          if (!confirmed.current) return;
          const title = document.querySelector<HTMLElement>(
            '[data-testid="job-review-tray-title"]',
          );
          if (title) {
            event.preventDefault();
            title.focus();
          }
        }}
        data-testid="job-review-tray-revert-all-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t("revertAllConfirmTitle", { count })}</DialogTitle>
          <DialogDescription>{t("revertAllConfirmBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              data-testid="job-review-tray-button-revert-all-cancel"
            >
              {t("revertAllCancel")}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={disabled}
            onClick={() => {
              confirmed.current = true;
              dispatch({ type: "REVERT_ALL" });
              setOpen(false);
            }}
            data-testid="job-review-tray-button-revert-all-confirm"
          >
            {t("revertAll")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 저장 상태 → 트레이 상태 영역. 되돌리기 알림이 있으면 그것을 먼저 보인다. */
function useTrayStatus(): ChangeTrayStatus | null {
  const t = useTranslations("review.save");
  const te = useTranslations("review.errors");
  const tt = useTranslations("review.tray");
  const { state, reload, saving } = useJobReview();
  const { save, revertNotice, revertAllNotice, importNotice } = state;
  const savingRef = useRef(saving);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  const reloadAction = (testId: string) => ({
    label: t("reload"),
    disabled: saving,
    testId,
    onClick: () => {
      if ((state.session?.entries.length ?? 0) === 0) {
        reload();
        return;
      }
      void requestLeaveConfirm(t("reloadConfirm"), {
        title: t("reloadConfirmTitle"),
        confirmLabel: t("reloadConfirmAction"),
      }).then(ok => {
        // 묻는 동안 저장이 시작됐으면 다시 불러오지 않는다(버튼도 비활성이 된다).
        if (ok && !savingRef.current) reload();
      });
    },
  });
  const errorText = (code: string) =>
    isSaveErrorCode(code) ? te(code) : te("unknownCode", { code });

  if (revertAllNotice !== null && save.phase === "idle") {
    return {
      kind: "info",
      text: tt("revertAllDone", { count: revertAllNotice }),
    };
  }
  if (revertNotice !== null && save.phase === "idle") {
    return { kind: "info", text: t("alsoReverted", { count: revertNotice }) };
  }
  if (importNotice !== null && save.phase === "idle") {
    return {
      kind: "info",
      text:
        importNotice.source === "draft"
          ? t("restored", { count: importNotice.count })
          : t("imported", { count: importNotice.count }),
    };
  }
  switch (save.phase) {
    case "idle":
      return null;
    case "uploading":
      return { kind: "info", text: t("uploading") };
    case "polling":
      return {
        kind: "info",
        text: t("polling"),
        detail: t("importId", { id: save.importId }),
      };
    case "reloading":
      return {
        kind: "info",
        text: save.importId ? t("reloadingAfterSave") : t("reloading"),
      };
    case "saved": {
      const saved =
        save.revision === null
          ? t("savedNoRevision")
          : t("saved", { revision: save.revision });
      if (save.reloadFailed) {
        return {
          kind: "error",
          text: t("savedReloadFailed", { saved }),
          detail: t("code", { code: save.reloadFailed }),
          action: reloadAction("job-review-tray-button-reload"),
        };
      }
      return {
        kind: "success",
        text: save.partial ? t("savedPartial", { saved }) : saved,
      };
    }
    case "reloaded":
      return { kind: "success", text: t("reloaded") };
    case "no_change":
      return { kind: "info", text: t("noChange") };
    case "blocked":
      return save.reason === "package_limit_exceeded"
        ? {
            kind: "error",
            text: t("tooLarge", {
              size: formatBytes(save.bytes ?? 0),
              limit: formatBytes(save.limit ?? MAX_INLINE_IMPORT_BYTES),
            }),
          }
        : { kind: "error", text: t("blocked") };
    case "conflict":
      return {
        kind: "error",
        text: t("conflict", { count: save.conflict.count }),
        detail: t("importId", { id: save.importId }),
        action: reloadAction("job-review-tray-button-reload"),
      };
    case "failed":
      return {
        kind: "error",
        text: save.resultId
          ? `${errorText(save.code)} ${t("failedField")}`
          : errorText(save.code),
        detail: [
          t("code", { code: save.code }),
          save.importId ? t("importId", { id: save.importId }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    case "stopped":
      return {
        kind: "error",
        text: t(`stopped.${save.reason}`),
        detail: [
          t("importId", { id: save.importId }),
          save.code ? t("code", { code: save.code }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    default: {
      const unreachable: never = save;
      return unreachable;
    }
  }
}
