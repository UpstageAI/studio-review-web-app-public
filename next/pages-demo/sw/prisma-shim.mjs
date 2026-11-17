// `@/lib/prisma` 자리. 검수 상태 표(`job_review_status`) 하나를 메모리 + IndexedDB 로 흉내 낸다.
// `src/lib/review-status.ts`·`review-status-aggregate.ts` 가 쓰는 질의 모양만 지원한다.
import { putStatus, statusRows } from "./store.mjs";

function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some(item => matches(row, item));
    if (condition !== null && typeof condition === "object") {
      if (Array.isArray(condition.in)) return condition.in.includes(row[key]);
      throw new Error(`prisma shim: unsupported filter on ${key}`);
    }
    return row[key] === condition;
  });
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function sortRows(rows, orderBy = []) {
  return [...rows].sort((a, b) => {
    for (const order of orderBy) {
      const [[key, direction]] = Object.entries(order);
      const result = compare(a[key], b[key]);
      if (result !== 0) return direction === "desc" ? -result : result;
    }
    return 0;
  });
}

const jobReviewStatus = {
  async findMany({ where, orderBy, take } = {}) {
    const rows = sortRows(
      statusRows.filter(row => matches(row, where)),
      orderBy,
    );
    return (take === undefined ? rows : rows.slice(0, take)).map(row => ({
      ...row,
    }));
  },

  async upsert({ where, create, update }) {
    const { collectionId, jobId } = where.collectionId_jobId;
    const now = new Date();
    let row = statusRows.find(
      item => item.collectionId === collectionId && item.jobId === jobId,
    );
    if (!row) {
      row = { completedAt: null, ...create, startedAt: now, updatedAt: now };
      statusRows.push(row);
    } else if (Object.keys(update).length > 0) {
      Object.assign(row, update, { updatedAt: now });
    } else {
      return { ...row };
    }
    await putStatus(row);
    return { ...row };
  },

  async groupBy({ by, where }) {
    const groups = new Map();
    for (const row of statusRows) {
      if (!matches(row, where)) continue;
      const key = JSON.stringify(by.map(name => row[name]));
      const group =
        groups.get(key) ??
        Object.fromEntries([
          ...by.map(name => [name, row[name]]),
          ["_count", { _all: 0 }],
        ]);
      group._count._all += 1;
      groups.set(key, group);
    }
    return [...groups.values()];
  },
};

export const prisma = { jobReviewStatus };
export default prisma;
