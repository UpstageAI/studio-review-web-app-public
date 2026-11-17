import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaderRoutes } from "./src/lib/security-headers";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return securityHeaderRoutes();
  },
};

// GitHub Pages 데모 빌드(`pnpm pages:build`, README "GitHub Pages 데모"): 서버 없이 도는 정적 export.
// `pageExtensions` 를 `tsx` 로 좁혀 서버가 있어야 하는 `route.ts`(BFF)와 `proxy.ts` 를 빌드에서 뺀다 —
// BFF 는 서비스 워커가, locale 판단은 `out/index.html` 이 대신한다. 응답 헤더(`headers()`)는 정적
// 호스팅에서 붙일 수 없어 두지 않는다. `route.ts` 가 빠지면 Next 가 만드는 `RouteContext` 타입도 없어져
// 그 파일들의 타입 검사가 깨지므로 이 빌드에서는 검사를 건너뛴다(타입은 평소 빌드가 검사한다).
const pagesDemoConfig: NextConfig = {
  poweredByHeader: false,
  output: "export",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  pageExtensions: ["tsx"],
  typescript: { ignoreBuildErrors: true },
};

export default withNextIntl(
  process.env.NEXT_PUBLIC_PAGES_DEMO === "1" ? pagesDemoConfig : nextConfig,
);
