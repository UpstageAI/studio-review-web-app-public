// GitHub Pages 데모 빌드(`pnpm pages:build`, 정적 export + 서비스 워커 mock) 여부와 그때 쓰는 값.
// 평소 빌드(`pnpm build`)에서는 `PAGES_DEMO` 가 `false` 이고 아래 값은 쓰이지 않는다. README "GitHub Pages 데모".

/** 빌드 때 굳는다(`pages-demo/build.mjs` 가 `NEXT_PUBLIC_PAGES_DEMO=1` 로 `next build` 를 돌린다). */
export const PAGES_DEMO = process.env.NEXT_PUBLIC_PAGES_DEMO === "1";

/** 사이트 base path(예: `/저장소-이름`). 루트에 올리면 빈 문자열. */
export const PAGES_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/**
 * 정적 export 는 동적 경로를 미리 알아야 하므로 mock 데이터셋의 Collection·Job 경로를 돌려준다.
 * 평소 빌드에서는 `undefined` 라 그 화면들은 지금처럼 요청 때 그려진다.
 */
export const demoCollectionParams = PAGES_DEMO
  ? async () =>
      (await import("../../pages-demo/static-params.mjs")).collectionParams()
  : undefined;

export const demoJobParams = PAGES_DEMO
  ? async () => (await import("../../pages-demo/static-params.mjs")).jobParams()
  : undefined;

/** 정적 export 에서 catch-all(`[...rest]`)이 요구하는 자리 채움 경로. 그 주소는 404 화면이 된다. */
export const demoCatchAllParams = PAGES_DEMO
  ? () => [{ rest: ["not-found"] }]
  : undefined;
