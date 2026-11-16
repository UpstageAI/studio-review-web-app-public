"use client";

import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { ApiError, getJobFiles, isAbortError } from "@/lib/review-api/client";
import { cn } from "@/lib/utils";
import { errorCodeOf } from "./error-message";
import {
  MAX_QUERY_LENGTH,
  filterQueryOf,
  isJobIdInput,
  isTooShortQuery,
} from "./search-query";
import { jobHref } from "./links";

const DEBOUNCE_MS = 300;

type JumpState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "not_found" }
  | { kind: "error"; code: string };

/**
 * Collection 안 검색창 하나. 파일명은 300 ms 뒤 목록 필터(`q`)로 넘기고,
 * `job_…` 형식이면 그 Job 이 이 Collection 에 속하는지 확인한 뒤 검수 화면으로 연다.
 */
export function JobSearchBox({
  collectionId,
  onQueryChange,
}: {
  collectionId: string;
  onQueryChange: (query: string | undefined) => void;
}) {
  const t = useTranslations("collections.search");
  const router = useRouter();
  const [value, setValue] = useState("");
  const [jump, setJump] = useState<JumpState>({ kind: "idle" });
  const controllerRef = useRef<AbortController | null>(null);

  const trimmed = value.trim();
  const isJobId = isJobIdInput(value);
  const filterQuery = filterQueryOf(value);
  const tooShort = isTooShortQuery(value);

  const notify = useEffectEvent(onQueryChange);
  useEffect(() => {
    const timer = setTimeout(() => notify(filterQuery), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filterQuery]);

  // 화면을 떠나면 진행 중인 확인 요청을 취소한다.
  useEffect(() => () => controllerRef.current?.abort(), []);

  const openJob = async () => {
    if (!isJobId || jump.kind === "checking") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setJump({ kind: "checking" });
    try {
      await getJobFiles(collectionId, trimmed, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setJump({ kind: "idle" });
      router.push(jobHref(collectionId, trimmed));
    } catch (err) {
      if (controller.signal.aborted || isAbortError(err)) return;
      setJump(
        err instanceof ApiError && err.status === 404
          ? { kind: "not_found" }
          : { kind: "error", code: errorCodeOf(err) },
      );
    }
  };

  let hint: string | null = null;
  if (jump.kind === "not_found") hint = t("jobNotFound");
  else if (jump.kind === "error") hint = t("jobError", { code: jump.code });
  else if (isJobId) hint = t("hintJobId");
  else if (tooShort) hint = t("hintShort");
  const hintIsError = jump.kind === "not_found" || jump.kind === "error";

  // "바로 열기" 는 Job ID 를 입력했을 때만 입력칸 안 오른쪽에 나타난다(Enter 로도 연다). 안내 문구는
  // 줄을 차지하지 않고 입력칸 아래에 떠 있다가, 안내할 것이 없으면 사라진다. 화면 낭독기가 바뀐 안내를
  // 읽도록 live region(`aria-live`)은 늘 붙여 두고, 말풍선 모양은 안내가 있을 때만 안쪽에 그린다.
  const showOpen = isJobId || jump.kind === "checking";
  return (
    <form
      className="relative w-full min-w-0 sm:w-72"
      role="search"
      onSubmit={event => {
        event.preventDefault();
        void openJob();
      }}
    >
      <label htmlFor="job-search-input" className="sr-only">
        {t("label")}
      </label>
      <SearchIcon
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        id="job-search-input"
        className={cn("pl-8 shadow-xs", showOpen && "pr-24")}
        type="search"
        value={value}
        maxLength={MAX_QUERY_LENGTH}
        placeholder={t("placeholder")}
        autoComplete="off"
        aria-describedby="job-search-hint"
        aria-invalid={hintIsError || undefined}
        data-testid="job-search-box-input-search"
        onChange={event => {
          setValue(event.target.value);
          if (jump.kind !== "checking") setJump({ kind: "idle" });
        }}
      />
      {showOpen ? (
        <Button
          type="submit"
          size="xs"
          variant="secondary"
          disabled={jump.kind === "checking"}
          className="absolute top-1/2 right-1.5 -translate-y-1/2"
          data-testid="job-search-box-button-open"
        >
          {jump.kind === "checking" ? t("checking") : t("openJob")}
        </Button>
      ) : null}
      <div
        id="job-search-hint"
        aria-live="polite"
        className="absolute top-full left-0 z-20 mt-1.5"
      >
        {hint !== null ? (
          <p
            className={cn(
              "w-max max-w-80 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md",
              hintIsError ? "text-destructive" : "text-muted-dark",
            )}
          >
            {hint}
          </p>
        ) : null}
      </div>
    </form>
  );
}
