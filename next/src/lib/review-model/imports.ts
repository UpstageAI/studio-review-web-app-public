import { isExactNumber } from "./json";
import {
  isResult,
  type OutputItem,
  type ReviewDocument,
  type ReviewJob,
} from "./types";

/** 가져오기 리소스 `units[]` 항목 중 이 모델이 읽는 부분. */
export type ImportUnit = {
  readonly status: string;
  readonly job_ids?: readonly string[];
  /** `s:<job_id>` → 구조 version, `v:<결과 id>` → 값 version. */
  readonly applied_versions?: Readonly<Record<string, unknown>> | null;
  /** 파일 이동으로 결과가 복사되어 id 가 바뀌었으면 비어 있지 않다. */
  readonly copy_id_map?: Readonly<Record<string, unknown>> | null;
  readonly error?: unknown;
};

export type ImportConflict = {
  readonly target: {
    readonly kind: "structure" | "value";
    readonly job_id: string;
    readonly occurrence_id?: string;
  };
  readonly base: number | null;
  readonly current: number | null;
};

export type ImportOutcome =
  | {
      readonly kind: "applied" | "no_change" | "partially_applied";
      readonly units: readonly ImportUnit[];
    }
  | { readonly kind: "conflict"; readonly conflicts: readonly ImportConflict[] }
  | {
      readonly kind: "failed";
      readonly code: string;
      readonly pointer?: string;
      readonly message?: string;
    }
  | { readonly kind: "cancelled"; readonly code?: string }
  | { readonly kind: "pending"; readonly status: string };

export const TERMINAL_IMPORT_STATUSES = [
  "applied",
  "partially_applied",
  "no_change",
  "failed",
  "cancelled",
] as const;

/** 더 polling 하지 않을 상태인가(`apply=auto` 기준 — `ready` 는 manual 승인 대기라 제외). */
export function isTerminalStatus(status: unknown): boolean {
  return (
    typeof status === "string" &&
    (TERMINAL_IMPORT_STATUSES as readonly string[]).includes(status)
  );
}

const ACTIVE_STATUSES = new Set([
  "uploading",
  "pending",
  "preparing",
  "ready",
  "applying",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function asVersion(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (isExactNumber(value)) {
    const parsed = Number(value.raw);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function readUnits(value: unknown): ImportUnit[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(asRecord)
    .filter(
      (unit): unit is Record<string, unknown> =>
        unit !== null && typeof unit.status === "string",
    )
    .map(unit => unit as unknown as ImportUnit);
}

function readConflicts(value: unknown): ImportConflict[] {
  if (!Array.isArray(value)) return [];
  const out: ImportConflict[] = [];
  for (const raw of value) {
    const item = asRecord(raw);
    const target = asRecord(item?.target);
    const kind = target?.kind;
    const jobId = asString(target?.job_id);
    if (!item || (kind !== "structure" && kind !== "value") || !jobId) continue;
    const occurrenceId = asString(target?.occurrence_id);
    out.push({
      target:
        occurrenceId === undefined
          ? { kind, job_id: jobId }
          : { kind, job_id: jobId, occurrence_id: occurrenceId },
      base: asVersion(item.base),
      current: asVersion(item.current),
    });
  }
  return out;
}

/**
 * 가져오기 리소스(`GET …/review-imports/{id}` 본문)를 화면이 쓸 결과로. 문구는
 * 만들지 않는다. 알 수 없는 모양·상태는 `failed`(`invalid_import_resource`·
 * `unknown_import_status`)로 끝내 polling 이 끝나지 않는 일을 막는다.
 */
export function parseImportOutcome(resource: unknown): ImportOutcome {
  const body = asRecord(resource);
  const status = body?.status;
  if (!body || typeof status !== "string") {
    return { kind: "failed", code: "invalid_import_resource" };
  }
  switch (status) {
    case "applied":
    case "no_change":
    case "partially_applied":
      return { kind: status, units: readUnits(body.units) };
    case "cancelled": {
      const code = asString(asRecord(body.error)?.code);
      return code === undefined
        ? { kind: "cancelled" }
        : { kind: "cancelled", code };
    }
    case "failed": {
      const error = asRecord(body.error);
      const details = asRecord(error?.details);
      const code = asString(error?.code);
      if (code === "base_version_conflict") {
        return {
          kind: "conflict",
          conflicts: readConflicts(details?.conflicts),
        };
      }
      const first = Array.isArray(details?.errors)
        ? asRecord(details.errors[0])
        : null;
      const pointer =
        typeof details?.pointer === "string"
          ? details.pointer
          : typeof first?.pointer === "string"
            ? first.pointer
            : undefined;
      const message = asString(first?.message) ?? asString(error?.message);
      return {
        kind: "failed",
        code: code ?? asString(first?.code) ?? "unknown",
        ...(pointer === undefined ? {} : { pointer }),
        ...(message === undefined ? {} : { message }),
      };
    }
    default:
      return ACTIVE_STATUSES.has(status)
        ? { kind: "pending", status }
        : { kind: "failed", code: "unknown_import_status" };
  }
}

/**
 * `Retry-After` 헤더 → 대기 ms. 정수 초만 읽고(HTTP-date 등은 `fallbackMs`),
 * `capMs` 를 넘지 않는다.
 */
export function retryAfterMs(
  header: string | null | undefined,
  options: { fallbackMs?: number; capMs?: number } = {},
): number {
  const fallbackMs = options.fallbackMs ?? 2000;
  const capMs = options.capMs ?? 10_000;
  const text = header?.trim() ?? "";
  const ms = /^\d+$/.test(text) ? Number(text) * 1000 : fallbackMs;
  return Math.min(ms, capMs);
}

function withVersion<T extends { readonly base_version: number }>(
  item: T,
  version: number,
): T {
  return item.base_version === version
    ? item
    : { ...item, base_version: version };
}

/**
 * 반영된 unit 의 `applied_versions` 를 다음 업로드의 `base_version` 으로 넣는다
 * (입력 불변, 새 문서 반환). `s:` 는 그 Job 의 `file_groups` 와 모든 문서 배치 보기
 * (서버가 둘이 같기를 요구), `v:` 는 결과. 반영되지 않은 unit·`copy_id_map`·짝 없는
 * 키가 있으면 `current: false` — 다시 불러와야 한다.
 */
export function adoptAppliedVersions(
  doc: ReviewDocument,
  units: readonly ImportUnit[] | null | undefined,
): { doc: ReviewDocument; current: boolean; unmatched: string[] } {
  let current = true;
  const unmatched: string[] = [];
  const structure = new Map<string, number>();
  const values = new Map<string, number>();
  for (const unit of units ?? []) {
    if (unit.status !== "applied") {
      current = false;
      continue;
    }
    if (unit.copy_id_map && Object.keys(unit.copy_id_map).length > 0) {
      current = false;
    }
    for (const [key, raw] of Object.entries(unit.applied_versions ?? {})) {
      const version = asVersion(raw);
      const kind = key.slice(0, 2);
      const id = key.slice(2);
      if (version === null || id === "" || (kind !== "s:" && kind !== "v:")) {
        unmatched.push(key);
        continue;
      }
      (kind === "s:" ? structure : values).set(id, version);
    }
  }
  const seenStructure = new Set<string>();
  const seenValues = new Set<string>();
  const jobs = doc.jobs.map((job): ReviewJob => {
    const structureVersion = structure.get(job.id);
    let next = job;
    if (structureVersion !== undefined && job.file_groups) {
      seenStructure.add(job.id);
      next = {
        ...next,
        file_groups: withVersion(job.file_groups, structureVersion),
      };
    }
    const output = next.output.map((item: OutputItem): OutputItem => {
      if (isResult(item)) {
        const version = values.get(item.id);
        if (version === undefined) return item;
        seenValues.add(item.id);
        return withVersion(item, version);
      }
      return structureVersion !== undefined && job.file_groups
        ? withVersion(item, structureVersion)
        : item;
    });
    return { ...next, output };
  });
  for (const id of structure.keys()) {
    if (!seenStructure.has(id)) unmatched.push(`s:${id}`);
  }
  for (const id of values.keys()) {
    if (!seenValues.has(id)) unmatched.push(`v:${id}`);
  }
  if (unmatched.length > 0) current = false;
  return { doc: { ...doc, jobs }, current, unmatched };
}
