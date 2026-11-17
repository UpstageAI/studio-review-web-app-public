// GitHub Pages 데모(정적 export + 서비스 워커 mock)의 공용 설정. README "GitHub Pages 데모" 참고.

/** 데모 데이터셋 옵션(`mock/lib/dataset.mjs` 의 `generateDataset`). Job 3 개라 검수 큐·상태를 볼 수 있다. */
export const DEMO_DATASET_OPTIONS = Object.freeze({ jobs: 3 });

/** 서비스 워커 파일 이름(`out/` 바로 아래, scope = 사이트 base path). */
export const SW_FILE = "mock-sw.js";

/** 서비스 워커 안 mock upstream 의 경로 조각. 주소는 `{scope}{UPSTREAM_SEGMENT}` 이고 네트워크로 나가지 않는다. */
export const UPSTREAM_SEGMENT = "__mock-upstream";
