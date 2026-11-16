import {
  findResult,
  isJsonObject,
  isValueEntry,
  parseJson,
  stringifyJson,
  toDraft,
  utf8Length,
  type ChangeDraft,
  type ReviewDocument,
  type ReviewSession,
} from "@/lib/review-model";

// 저장하지 않은 변경 항목을 브라우저에 임시 저장하는 순수 규칙: 저장 모양(`StoredDraft`)·키·
// 직렬화·역직렬화·복원 가능 판정. 저장소 I/O 는 `draft-storage.ts`, 저장·읽기 시점은
// `draft-persister.ts`·`use-draft-persistence.ts` 가 맡는다.

/** 저장 모양 버전. 모양이 바뀌면 올리고, 다른 버전은 읽지 않는다(버린다). */
export const DRAFT_FORMAT_VERSION = 1;

/** 임시 저장 본문 상한. 넘으면 저장하지 않고 안내한다(localStorage 는 origin 당 5 MiB 안팎). */
export const DRAFT_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 저장소에 두는 모양. 변경 항목(`drafts`)과 그 항목이 기대는 서버 version 을 함께 두어, 다시 열었을
 * 때 불러온 문서가 같은 version 일 때만 복원한다.
 */
export type StoredDraft = {
  readonly version: typeof DRAFT_FORMAT_VERSION;
  /** 저장 시각(ISO 8601). */
  readonly savedAt: string;
  readonly jobId: string;
  /** 불러온 문서(base)의 `file_groups.base_version`. 구성 정보가 없는 Job 은 `null`. */
  readonly structureVersion: number | null;
  /** 값 항목이 고치는 결과마다 base 의 `base_version`. */
  readonly resultVersions: Readonly<Record<string, number>>;
  readonly drafts: readonly ChangeDraft[];
};

export type DraftCompatibility =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "job_mismatch"
        | "structure_version"
        | "result_version"
        | "result_missing";
    };

/** 브라우저 저장소 키. Job 마다 하나. */
export function draftStorageKey(collectionId: string, jobId: string): string {
  return `review-draft:${collectionId}:${jobId}`;
}

/** 세션의 변경 항목을 저장 모양으로. version 은 불러온 문서(base) 기준이다. */
export function buildStoredDraft(
  session: ReviewSession,
  savedAt: string,
): StoredDraft {
  const baseJob = session.base.jobs[0] ?? null;
  const resultVersions = new Map<string, number>();
  for (const entry of session.entries) {
    if (!isValueEntry(entry) || resultVersions.has(entry.resultId)) continue;
    const result = baseJob ? findResult(baseJob, entry.resultId) : null;
    if (result) resultVersions.set(entry.resultId, result.base_version);
  }
  return {
    version: DRAFT_FORMAT_VERSION,
    savedAt,
    jobId: baseJob?.id ?? "",
    structureVersion: baseJob?.file_groups?.base_version ?? null,
    resultVersions: Object.fromEntries(resultVersions),
    drafts: session.entries.map(toDraft),
  };
}

export type SerializedDraft =
  | { ok: true; text: string; bytes: number }
  | { ok: false; reason: "too_large"; bytes: number };

/** 저장 텍스트로. `ExactNumber` 를 지키려고 `stringifyJson` 을 쓰고, 상한을 넘으면 쓰지 않는다. */
export function serializeStoredDraft(draft: StoredDraft): SerializedDraft {
  const text = stringifyJson(draft);
  const bytes = utf8Length(text);
  return bytes > DRAFT_MAX_BYTES
    ? { ok: false, reason: "too_large", bytes }
    : { ok: true, text, bytes };
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * 저장 텍스트 → 저장 모양. 깨진 JSON·다른 버전·모양이 다른 것은 `null`(버린다). 항목 하나하나의
 * 내용은 여기서 검사하지 않고 복원할 때 `addChange` 가 검증한다(하나라도 안 되면 전부 거부).
 */
export function parseStoredDraft(text: string): StoredDraft | null {
  let parsed: unknown;
  try {
    parsed = parseJson(text, { maxBytes: DRAFT_MAX_BYTES });
  } catch {
    return null;
  }
  if (!isJsonObject(parsed)) return null;
  const { version, savedAt, jobId, structureVersion, resultVersions, drafts } =
    parsed;
  if (version !== DRAFT_FORMAT_VERSION) return null;
  if (typeof savedAt !== "string" || typeof jobId !== "string") return null;
  if (structureVersion !== null && !isVersion(structureVersion)) return null;
  if (
    !isJsonObject(resultVersions) ||
    !Object.values(resultVersions).every(isVersion)
  ) {
    return null;
  }
  if (
    !Array.isArray(drafts) ||
    !drafts.every(
      draft =>
        isJsonObject(draft) &&
        typeof draft.kind === "string" &&
        draft.jobId === jobId,
    )
  ) {
    return null;
  }
  return {
    version: DRAFT_FORMAT_VERSION,
    savedAt,
    jobId,
    structureVersion,
    resultVersions: resultVersions as Record<string, number>,
    drafts: drafts as unknown as ChangeDraft[],
  };
}

/**
 * 불러온 문서(`doc`, 세션 base)에 이 임시 저장을 복원할 수 있는가. Job 이 다르거나, 구성 version 이
 * 다르거나, 값 항목이 고치는 결과가 없어졌거나 version 이 달라졌으면 복원하지 않는다(서버 내용이
 * 바뀐 뒤 옛 값을 덧씌우지 않도록).
 */
export function draftCompatibility(
  draft: StoredDraft,
  doc: ReviewDocument,
  jobId: string,
): DraftCompatibility {
  const job = doc.jobs.find(item => item.id === jobId);
  if (!job || draft.jobId !== jobId) {
    return { ok: false, reason: "job_mismatch" };
  }
  if ((job.file_groups?.base_version ?? null) !== draft.structureVersion) {
    return { ok: false, reason: "structure_version" };
  }
  for (const [resultId, version] of Object.entries(draft.resultVersions)) {
    const result = findResult(job, resultId);
    if (!result) return { ok: false, reason: "result_missing" };
    if (result.base_version !== version) {
      return { ok: false, reason: "result_version" };
    }
  }
  return { ok: true };
}
