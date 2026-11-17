# studio-review-web-app

Upstage Collection 검수 API(review API)로 자기 검수 화면을 만들 때 참고할 수 있는 예시 웹 앱입니다. Collection 의 Job 처리 결과를 문서 뷰어와 함께 보여 주고, 사람이 고친 내용을 검수 API 로 저장하는 흐름을 구현합니다.

API 키 없이도 같은 화면을 볼 수 있도록 검수 API 를 흉내 내는 mock 서버와 데이터 생성기를 함께 둡니다.

## 구조

- `next/`: Next.js 앱(Next.js 16, Prisma, next-intl). 앱 실행·환경 변수·앱 서버 API(BFF) 계약·코드 구조·Studio UI Kit item 설치 안내는 [`next/README.md`](next/README.md) 에 있습니다.
- `docker-compose.yml`: 로컬 개발용 PostgreSQL(호스트 포트 5435).
- `scripts/setup.sh`: DB 컨테이너 → 의존성 설치 → 마이그레이션 → 개발 서버를 한 번에 실행합니다.

## 빠른 시작

Docker, Node.js(`>=22.23.4`), pnpm(`>=10.7.1`)이 필요합니다. 저장소 루트에서 실행합니다.

```bash
./scripts/setup.sh
```

끝나면 `http://localhost:3000` 을 엽니다. 이 스크립트는 개발 서버(`pnpm dev`)를 띄우는데, 개발 서버에서는 Job 검수 화면이 반복해서 새로 고쳐질 수 있습니다. Job 검수 화면은 프로덕션 빌드(`next/` 에서 `pnpm build && pnpm start`)로 확인합니다.

`next/.env` 가 없으면 `next/.env.example` 을 복사해 만듭니다. 실제 검수 API 를 부르려면 `next/.env` 의 `UPSTAGE_API_KEY` 에 Upstage 콘솔에서 발급한 키를 넣습니다. 키 없이 화면을 보려면 `next/README.md` 의 [mock 모드](next/README.md#mock-모드-api-키-없이-실행)를 따릅니다.

이 앱에는 로그인이 없고 서버가 API 키로 검수 API 를 대신 호출하므로, 로컬이나 신뢰된 네트워크에서만 띄웁니다(`next/README.md` 의 [환경 변수](next/README.md#환경-변수)).

## 데모

API 키·서버 없이 mock 데이터로 도는 데모를 GitHub Pages 에 둡니다: https://upstageai.github.io/studio-review-web-app-public/ (UI Kit 데모 화면은 `/ko/ui-kit-demo`). 저장한 내용은 방문자의 브라우저에만 남습니다. 빌드 방식은 `next/README.md` 의 [GitHub Pages 데모](next/README.md#github-pages-데모-서버-없이-mock-모드)를 봅니다.

## 데이터 전송 고지

이 앱에서 입력한 내용은 Upstage API(`api.upstage.ai`) 등 외부 API 로 전송됩니다. 개인정보 등 민감정보는 입력하지 마세요.

## UI 스택

shadcn/ui 기반이며, 검수 화면 부품은 Studio UI Kit item 을 공개 Registry 로 설치해 씁니다(shadcn CLI 4.21.0 · `radix-nova` · Tailwind 4). Studio UI Kit 은 Upstage 가 공개하는 UI 부품 모음이고, 설치 방법은 안내 페이지(https://console.upstage.ai/ui-kit)에 있습니다. 이 앱에서 쓰는 방식은 `next/README.md` 의 [UI 스택](next/README.md#ui-스택-shadcnui--studio-ui-kit-호환)을 봅니다.

## 지원·문의

사용 중 문의나 의견은 Upstage 피드백 페이지(https://feedback.upstage.ai)로 보내 주세요.

## 라이선스

이 저장소의 코드는 MIT 라이선스입니다([`LICENSE`](LICENSE)). 저장소에 복사되어 있는 제3자 코드와 Studio UI Kit item 은 각자의 고지를 따릅니다([`next/THIRD_PARTY_NOTICES.md`](next/THIRD_PARTY_NOTICES.md), item 별 `LICENSE.txt`). 앱 아이콘(`next/src/app/favicon.ico`, `next/src/app/icon.svg`)은 Upstage 브랜드 에셋으로 MIT 라이선스 대상이 아니며 권리는 Upstage 에 있습니다. 이 아이콘은 이 앱을 실행·확인하는 용도 외에는 재사용·재배포할 수 없습니다.
