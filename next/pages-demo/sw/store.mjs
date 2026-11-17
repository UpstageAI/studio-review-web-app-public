// 서비스 워커의 저장소(IndexedDB). 브라우저는 쉬는 서비스 워커를 수십 초 만에 내리므로, 메모리에만 두면
// 저장한 검수 내용이 사라진다. 가져오기(저장) 요청과 검수 상태 행을 여기에 남기고 다시 뜰 때 읽는다.
// IndexedDB 를 쓸 수 없으면(일부 사생활 보호 모드) 메모리로만 동작한다.

// 데이터셋 옵션·저장 형식이 바뀌면 숫자를 올려 예전 기록을 버린다.
const DB_NAME = "studio-review-demo-v1";
const IMPORTS = "imports";
const STATUSES = "reviewStatus";

/** 검수 상태 행(앱 DB 의 `job_review_status` 표 자리). `prisma-shim.mjs` 가 읽고 쓴다. */
export const statusRows = [];

let db = null;

const done = request =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function open() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(IMPORTS, { autoIncrement: true });
      request.result.createObjectStore(STATUSES, {
        keyPath: ["collectionId", "jobId"],
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** 저장된 가져오기를 순서대로 돌려주고, 검수 상태 행을 `statusRows` 에 채운다. */
export async function loadSaved() {
  try {
    db = await open();
    const tx = db.transaction([IMPORTS, STATUSES]);
    const [imports, statuses] = await Promise.all([
      done(tx.objectStore(IMPORTS).getAll()),
      done(tx.objectStore(STATUSES).getAll()),
    ]);
    statusRows.push(...statuses);
    return imports;
  } catch (err) {
    console.warn("demo: IndexedDB unavailable, keeping state in memory", err);
    db = null;
    return [];
  }
}

async function write(store, action) {
  if (!db) return;
  try {
    await done(action(db.transaction(store, "readwrite").objectStore(store)));
  } catch (err) {
    console.warn("demo: could not persist", store, err);
  }
}

export const appendImport = record =>
  write(IMPORTS, store => store.add(record));
export const clearImports = () => write(IMPORTS, store => store.clear());
export const putStatus = row => write(STATUSES, store => store.put(row));
