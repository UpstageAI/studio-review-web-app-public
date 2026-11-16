"use client";

import {
  ChevronDownIcon,
  DownloadIcon,
  FileCodeIcon,
  FileUpIcon,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MAX_JSON_FILE_BYTES,
  downloadText,
  editedText,
  readJsonFile,
  reviewFileName,
} from "./download";
import { useJobReview } from "./job-review-context";
import { JsonSheet, type JsonBasis, type JsonSheetSeed } from "./json-sheet";
import { formatBytes } from "./save-errors";

/** 메뉴 항목 안의 아이콘, 이름, 한 줄 설명. */
function ItemText({
  icon: Icon,
  label,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
}) {
  return (
    <>
      <Icon aria-hidden="true" className="mt-0.5 self-start" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </>
  );
}

/**
 * 머리의 "JSON" 메뉴: 원본과 편집본 다운로드, 전체 JSON 편집 시트 열기, 파일에서 가져오기. 메뉴 위에
 * 무엇을 다루는 메뉴인지 제목과 설명을 두고, 항목마다 한 줄 설명을 붙인다. 저장 중에는 막고, 충돌을
 * 받은 뒤에는 편집과 가져오기를 막는다(다운로드는 된다).
 */
export function JsonMenu() {
  const t = useTranslations("review.json");
  const { state, dispatch, saving } = useJobReview();
  const { session, sourceText, jobId, jsonSheetOpen } = state;
  const conflicted = state.save.phase === "conflict";
  const fileInput = useRef<HTMLInputElement>(null);
  const [seed, setSeed] = useState<JsonSheetSeed>({
    key: 0,
    text: "",
    basis: { kind: "edited" },
  });
  const [fileError, setFileError] = useState<string | null>(null);

  // 파일 읽기는 비동기다. 나중에 시작한 읽기가 있거나, 읽는 동안 시트가 닫혔으면 결과를 버린다.
  const readToken = useRef(0);
  useEffect(() => {
    if (!jsonSheetOpen) readToken.current += 1;
  }, [jsonSheetOpen]);

  const openWith = (text: string, basis: JsonBasis, notice?: string) => {
    setSeed(previous => ({ key: previous.key + 1, text, basis, notice }));
    setFileError(null);
    dispatch({ type: "OPEN_JSON" });
  };

  const pickFile = () => fileInput.current?.click();

  const onFile = async (file: File) => {
    const token = ++readToken.current;
    const read = await readJsonFile(file);
    if (token !== readToken.current) return;
    if (!read.ok) {
      setFileError(
        read.reason === "too_large"
          ? t("fileTooLarge", { limit: formatBytes(MAX_JSON_FILE_BYTES) })
          : t("fileUnreadable"),
      );
      dispatch({ type: "OPEN_JSON" });
      return;
    }
    openWith(read.text, { kind: "file", name: read.name }, t("fileLoaded"));
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={!session || saving}>
          <Button
            type="button"
            variant="outline"
            size="default"
            aria-label={t("menuLabel")}
            title={t("menuDescription")}
            data-testid="job-review-json-menu-trigger"
            className="cursor-pointer"
          >
            {t("menu")}
            <ChevronDownIcon aria-hidden="true" className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="flex flex-col gap-1 py-2">
            <span className="text-sm font-semibold text-foreground">
              {t("menuTitle")}
            </span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("menuDescription")}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={sourceText === null}
            onSelect={() => {
              if (sourceText !== null) {
                downloadText(reviewFileName(jobId, "original"), sourceText);
              }
            }}
            data-testid="job-review-json-menu-download-original"
          >
            <ItemText
              icon={DownloadIcon}
              label={t("downloadOriginal")}
              hint={t("downloadOriginalHint")}
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!session}
            onSelect={() => {
              if (session) {
                downloadText(
                  reviewFileName(jobId, "edited"),
                  editedText(session.current),
                );
              }
            }}
            data-testid="job-review-json-menu-download-edited"
          >
            <ItemText
              icon={DownloadIcon}
              label={t("downloadEdited")}
              hint={t("downloadEditedHint")}
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!session || conflicted}
            onSelect={() => {
              if (session) {
                openWith(editedText(session.current), { kind: "edited" });
              }
            }}
            data-testid="job-review-json-menu-edit"
          >
            <ItemText
              icon={FileCodeIcon}
              label={t("edit")}
              hint={t("editHint")}
            />
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!session || conflicted}
            onSelect={pickFile}
            data-testid="job-review-json-menu-import"
          >
            <ItemText
              icon={FileUpIcon}
              label={t("importFile")}
              hint={t("importFileHint")}
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={event => {
          const file = event.currentTarget.files?.[0];
          // 같은 파일을 다시 골라도 change 가 나도록 비운다.
          event.currentTarget.value = "";
          if (file) void onFile(file);
        }}
        data-testid="job-review-json-input-file"
      />
      <JsonSheet seed={seed} onPickFile={pickFile} fileError={fileError} />
    </>
  );
}
