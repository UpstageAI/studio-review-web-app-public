# studio-review-web-app / next

Upstage Studio 의 Collection 검수(Review) API 로 **검수 화면을 직접 만들려는 팀을 위한 예시 앱**입니다. 그대로 띄워 동작을 확인하고, 필요한 부분(검수 화면·편집 모델·BFF·Studio UI Kit item)을 자기 서비스로 가져가는 용도입니다. Next.js 16 (App Router) + Prisma (PostgreSQL) + next-intl 로 만들었습니다.

처음이라면 이 순서로 읽습니다.

1. [시작하기](#시작하기): 로컬 실행. API 키가 없으면 [mock 모드](#mock-모드-api-키-없이-실행)로 띄웁니다.
2. [화면](#화면): 어떤 화면이 있고 무엇을 하는지.
3. [코드 읽는 순서](#코드-읽는-순서): 가져갈 코드(1 층)와 이 앱 전용 코드(2·3 층).
4. [BFF 라우트](#bff-라우트)·[BFF HTTP 계약](#bff-http-계약검수-화면이-기대는-것): 자기 서버로 바꿀 때 맞출 계약.
5. "UI 스택" 과 [Studio UI Kit item 설치](#studio-ui-kit-item-설치): UI 부품을 자기 프로젝트에 설치하는 방법.

[스모크](#스모크-pnpm-mocksmoke)·[DOM 캡처](#dom-캡처-pnpm-mockdom)·[성능 측정](#성능-측정-pnpm-mockmeasure)은 이 앱 자체를 고칠 때 쓰는 도구라, 가져다 쓰기만 한다면 건너뛰어도 됩니다.

이 문서에서 자주 쓰는 말:

- **upstream**: Upstage API(기본 `https://api.upstage.ai`).
- **BFF**: 이 앱 서버의 `/api/...` Route Handler. 브라우저 대신 API 키를 들고 upstream 을 부릅니다.
- **Studio UI Kit item**: 공개 Registry 에서 shadcn CLI 로 설치하는 UI 부품. 설치된 소스(`src/components/studio-ui-kit/`)를 **vendor** 라고 부릅니다.
- **host**: item 을 가져다 쓰는 쪽의 코드. 이 저장소에서는 이 앱의 페이지·래퍼이고, 여러분의 프로젝트에서는 여러분의 코드입니다.

## 시작하기

레포 루트에서 한 번에 띄웁니다. Docker 가 필요합니다.

```bash
./scripts/setup.sh
```

Postgres 컨테이너 시작(`docker compose up -d --wait postgres`) → `.env` 가 없으면 `.env.example` 복사 → `pnpm install` → `pnpm migrate` → `pnpm dev` 순서로 실행합니다. 단계별로 하려면 같은 명령을 차례로 실행합니다.

- Node.js 는 `package.json` `engines` 의 `>=22.23.4` 를 씁니다(테스트 환경 jsdom 31 이 `^22.22.2 || ^24.15.0 || >=26` 을 요구하므로 23·25 는 피합니다). pnpm 은 `>=10.7.1`.
- DB 는 루트 `docker-compose.yml` 의 `postgres` 서비스(postgres:17)이며 호스트 포트 **5435** 를 씁니다(Postgres 기본 포트 5432 를 이미 쓰는 환경과 겹치지 않게 한 값). `.env.example` 의 `DATABASE_URL` 과 맞춰져 있으므로 포트를 바꾸면 둘을 함께 바꿉니다.
- 배포 환경(스테이징·운영)에서는 개발용 `pnpm migrate`(`prisma migrate dev`) 대신 앱을 시작하기 전에 `pnpm exec prisma migrate deploy` 로 `prisma/migrations/` 를 적용합니다. 검수 상태 테이블이 없으면 목록은 뜨지만 검수 열은 "—", 진행 현황은 오류 문구, 검수 완료는 실패 안내가 됩니다.
- 데이터는 Docker 볼륨에 남습니다. 컨테이너를 멈추려면 `docker compose stop postgres`, 데이터까지 지우려면 `docker compose down -v` 를 레포 루트에서 실행합니다.

| 스크립트         | 설명                                         |
| ---------------- | -------------------------------------------- |
| `pnpm dev`       | 개발 서버                                    |
| `pnpm build`     | 프로덕션 빌드                                |
| `pnpm format`    | ESLint + Prettier 검사 (`format:fix`로 수정) |
| `pnpm test`      | Vitest 단위·렌더 테스트 (`*.test.ts` node, `*.test.tsx` jsdom) |
| `pnpm migrate`   | `prisma migrate dev`                         |
| `pnpm generate`  | Prisma Client 생성                           |
| `pnpm db:studio` | Prisma Studio                                |
| `pnpm mock:gen`  | mock 데이터 생성 ([mock 모드](#mock-모드-api-키-없이-실행) 절) |
| `pnpm mock:serve` | mock upstream 서버                          |
| `pnpm mock:start` | `.env.mock` 으로 프로덕션 서버 시작         |
| `pnpm mock:measure` | 검수 화면 성능 측정 ([성능 측정](#성능-측정-pnpm-mockmeasure) 절) |
| `pnpm mock:smoke` | 검수 화면 스모크 ([스모크](#스모크-pnpm-mocksmoke) 절) |
| `pnpm mock:dom`   | 검수 화면 DOM 캡처 ([DOM 캡처](#dom-캡처-pnpm-mockdom) 절) |
| `pnpm pages:build` | GitHub Pages 데모 빌드 ([GitHub Pages 데모](#github-pages-데모-서버-없이-mock-모드) 절) |
| `pnpm pages:preview` | 위 빌드 결과(`out/`) 로컬 미리보기 |

## Collection 검수 API 연동

Collection 검수 API(검수 JSON 형식 `collection-results/11`)를 이 앱의 서버(Route Handler)가 대신 호출합니다. 브라우저는 같은 origin 의 `/api/...` 만 부릅니다. API 계약은 Collection 검수 API 의 Job 검수 JSON spec 을 따릅니다.

### 환경 변수

`next/.env` 에 넣습니다(`.env.example` 참고).

| 변수                      | 필수   | 설명                                                                                                    |
| ------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `UPSTAGE_API_KEY`         | 예     | Upstage 콘솔 API 키 페이지에서 발급한 키. 없으면 API 호출 시점에 `500 server_misconfigured` 를 돌려준다 |
| `UPSTAGE_CONSOLE_API_URL` | 아니오 | API 게이트웨이 origin. 비우면 `https://api.upstage.ai`. 끝에 `/` 를 붙이지 않는다. 키를 `Authorization` 헤더로 보내므로 `http:` 는 loopback(`127.0.0.1`·`localhost`·`[::1]`) 만 허용하고, 원격 `http:` 이거나 주소에 자격증명(`user:pass@`)이 있으면 API 호출 시점에 `500 server_misconfigured` 를 돌려준다 |
| `UPSTAGE_ALLOW_HTTP_IMAGE_URLS` | 아니오 | **개발 전용.** `1` 이면 loopback(`127.0.0.1`·`localhost`·`[::1]`) 호스트의 `http:` 페이지 이미지 URL 도 브라우저에 넘긴다([mock 모드](#mock-모드-api-키-없이-실행) 절). 켜져 있어도 loopback 이 아닌 `http:` 는 거른다. 기본은 비움. **운영·공개망에서는 켜지 않는다** |
| `REVIEW_UI_KIT_DEMO` | 아니오 | `1` 이면 UI Kit 데모 화면(`/{locale}/ui-kit-demo`)에 접근할 수 있다. 화면이 자동으로 뜨지는 않고, 이 경로로 직접 들어가야 한다([UI Kit 데모 화면](#ui-kit-데모-화면) 절). 서버가 요청 시점에 읽으므로 같은 빌드에서 env 만 바꿔 다시 띄우면 된다. 기본은 비움(그 경로는 404) |

- 이 앱에서 입력한 내용은 Upstage API(`api.upstage.ai`) 등 외부 API 로 전송됩니다. **개인정보 등 민감정보는 입력하지 마세요.**
- 키는 서버에서만 읽습니다(`server-only` 모듈, `NEXT_PUBLIC_` 아님). 브라우저에는 검수 JSON 과 처리 결과만 갑니다.
- 키는 빌드가 아니라 호출 시점에 읽으므로 키 없이도 `pnpm build` 가 됩니다.
- 이 앱에는 로그인이 없습니다. **이 서버에 접근할 수 있는 누구나 서버 키 권한으로 검수 API 를 호출할 수 있으므로** 로컬·신뢰된 네트워크에서만 띄웁니다. 상태를 바꾸는 요청(`POST`·`PUT`)은 다른 사이트에서 브라우저를 거쳐 오면 `403 forbidden` 으로 막습니다. 판정은 브라우저가 붙이는 `Sec-Fetch-Site` 를 우선하므로 리버스 프록시가 `Host` 를 바꿔도 됩니다(헤더가 없을 때만 `Origin` 과 `Host` 를 비교).

### BFF 라우트

경로는 upstream 경로를 그대로 따릅니다(`{id}` = Collection ID, `{jobId}` = Job ID). 예외는 upstream 에 없는 화면용 라우트로, 아래 "앱 DB 만 읽는 라우트" 의 `/api/review-progress`·`/api/review-activity` 와 "Collection 관계 라우트" 의 `/api/collection-lineage` 입니다.

| BFF (`/api/search-collections…`)   | upstream (`/v2/search-collections…`) | 용도                                                       |
| ---------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| `GET`                              | `GET`                                | Collection 목록                                            |
| `GET /{id}`                        | `GET /{id}`                          | Collection 상세(`total_job_count`·`latest_config_ids` 등) |
| `GET /{id}/source-jobs`            | `GET /{id}/source-jobs`              | Collection 에 결과를 낸 Job 행 목록. 행마다 앱 DB 의 검수 상태(`review_status`·`review_completed_at`)를 붙이고 `review_status` 로 거른다 |
| `PUT /{id}/source-jobs/{jobId}/review-status` | (없음 — 앱 DB)            | Job 검수 상태 바꾸기(`{ "action": "start" \| "complete" \| "reopen" }`) |
| `GET /{id}/review-progress`        | (없음 — 앱 DB)                       | Collection 의 검수 상태별 Job 수 `{ done, in_progress }`     |
| `GET /{id}/source-jobs/{jobId}/files` | `GET /{id}/source-jobs/{jobId}/files` | Job 의 입력 파일(`id`·`filename`·`num_pages`)           |
| `GET /{id}/source-jobs/{jobId}/response` | `GET /{id}/source-jobs/{jobId}/response` | Job 응답(추출값 좌표·Parse 요소, 검수값 반영본). 그림은 `figure_url` 로 바뀜 |
| `GET /{id}/source-jobs/{jobId}/revisions` | `GET /{id}/source-jobs/{jobId}/revisions` | Job 검수 변경 이력 한 페이지(변경 1 건 = 행 1 개, 다음 페이지는 `after` = 직전 `last_id`) |
| `GET /{id}/source-jobs/{jobId}/revisions/{revisionId}` | `GET /{id}/source-jobs/{jobId}/revisions/{revisionId}` | 변경 이력 한 건(변경 후 `content`·변경 전 `base_content`, `ETag`) |
| `GET /{id}/source-jobs/{jobId}/figures/{key}` | (없음 — 서버 메모리)             | 위 응답에서 떼어 둔 Parse 그림 요소 이미지(`key` = `f1` …)       |
| `GET /{id}/review-capabilities`    | `GET /{id}/review-capabilities`      | 검수 한도·지원 여부                                        |
| `GET /{id}/review-document?job_ids=…` | `GET /{id}/review-document?job_ids=…` | 검수 JSON 문서 받기                                     |
| `POST /{id}/review-imports`        | `POST /{id}/review-imports?apply=auto` | 고친 검수 JSON 올리기(가져오기 생성)                     |
| `GET /{id}/review-imports/{importId}` | `GET /{id}/review-imports/{importId}` | 가져오기 상태 조회                                      |

- 목록 라우트는 아래 쿼리만 upstream 으로 넘기고 나머지 이름은 무시합니다. 값이 틀리면 `400 invalid_value`(`param` = 쿼리 이름), 빈 값(`?q=`)은 보내지 않은 것으로 봅니다. Collection 목록 본문은 그대로 전달하고, Job 행 목록은 아래 검수 상태 항목처럼 행에 필드를 붙여 돌려줍니다.
  - Collection 목록: `kind`(`documents`·`table`) · `include_default`(`true`·`false`) · `is_default`(`true`·`false`) · `listed`(`true`·`false`) · `q`(2~200 자) · `after`·`before`(커서) · `limit`(1~100) · `order`(`asc`·`desc`)
  - Job 행: `q`(입력 파일명, 2~200 자) · `config_id` · `latest`(`true`·`false`) · `status`(`in_progress`·`completed`·`failed`·`cancelled`) · `after`·`before` · `limit`(1~100) · `order` · `group_by`(`input_files` = 같은 입력 파일 묶음당 최신 실행 1 행)
  - Job 변경 이력: `type`(`result`·`structure`) · `occurrence_id`·`job_result_id`·`operation_id` · `include`(`content`) · `after`(커서) · `limit`(1~100) · `order`(`asc`·`desc`). 본문은 그대로 전달하고, 단건은 `ETag` 를 전달하되 요청의 `If-None-Match` 는 넘기지 않습니다. 두 경로 모두 다른 사이트에서 온 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 `403 forbidden` 입니다.
  - 다음·이전 페이지는 응답의 `last_cursor`·`first_cursor` 를 `after`·`before` 에 넣습니다(`first_id`·`last_id` 는 커서가 아님). Job 행 목록에는 총 개수가 없으므로 상세의 `total_job_count` 를 씁니다.
  - 업로드·가져오기로 만든 Collection 의 Job 행은 upstream 이 `409 collection_source_type_unsupported` 를 돌려주며, 그대로 전달합니다.
- 검수 상태(검수 전·검수 중·검수 완료)는 Collection 검수 API 에 없어서 **이 앱의 Postgres**(`job_review_status` 표, (Collection, Job) 당 한 행, 행이 없으면 검수 전)에 둡니다. 로그인이 없으므로 사용자 구분 없이 이 서버를 쓰는 모든 사람에게 공유되고, 두 사람이 같은 Job 을 바꾸면 나중 요청이 남습니다.
  - `source-jobs` 는 upstream `200` 본문을 8 MiB 까지 읽어(넘으면 `502 response_too_large`, JSON 목록이 아니면 `502 upstream_error`) 행마다 `review_status`(`pending`·`in_progress`·`done`)·`review_completed_at`(ISO 8601 또는 `null`)를 붙입니다. 본문이 바뀌므로 upstream `ETag` 는 넘기지 않습니다. 오류 응답은 그대로 전달합니다.
  - `review_status` 쿼리(`pending`·`in_progress`·`done`·`unfinished` = 검수 전 + 검수 중)는 upstream 으로 보내지 않고 서버가 거릅니다. 거른 행이 `limit`(기본 20)보다 적고 다음 페이지가 있으면 `last_cursor` 로 다음 upstream 페이지를 **첫 페이지 포함 최대 5 페이지까지** 이어 받아 합칩니다. upstream 커서가 페이지 단위라 페이지를 통째로 합치므로 **한 응답의 행 수가 `limit` 를 넘거나 0 이면서 `has_more: true` 일 수 있습니다** — 호출하는 쪽은 페이지 크기를 가정하지 않고 `has_more`·`last_cursor` 로 이어 받습니다. 이어 받던 페이지가 실패하면 거기까지의 행과 직전 페이지의 `last_cursor` 를 돌려줍니다.
  - DB 를 읽지 못하면 `review_status` 쿼리가 없을 때는 두 필드 없이 목록만 돌려주고(서버 로그에 남김), 있을 때는 거를 수 없으므로 `503 review_status_unavailable` 입니다.
- `review-status`: 같은 origin 의 브라우저 요청만 받습니다(다른 사이트에서 오면 `403 forbidden`). 본문은 1 KiB 이하 JSON 이고(넘으면 `400 invalid_value`, `param: "body"`) `action` 이 아래 셋이 아니면 `400 invalid_value`(`param: "action"`). 응답은 `{ job_id, review_status, review_completed_at }` 입니다. upstream 에 Job 이 있는지는 확인하지 않습니다.
  - `start`: 행이 없을 때만 검수 중으로 만듭니다(검수 완료 Job 을 다시 열어도 그대로).
  - `complete`: 검수 완료, 완료 시각 = 지금.
  - `reopen`: 검수 중으로 되돌리고 완료 시각을 지웁니다.
- `{id}/review-progress`(Collection 하나, 상세 화면의 진행 현황): `{ done, in_progress }`(검수 전은 세지 않음). DB 오류는 `503 review_status_unavailable`. 여러 Collection 을 한 번에 세는 목록 화면용 `/api/review-progress` 와는 다른 라우트입니다(아래).
- `review-document`: `job_ids` 를 반복 쿼리(`?job_ids=a&job_ids=b`)로 1~100 개. `If-None-Match` 를 넘기면 내용이 같을 때 `304` 를 받습니다. 본문은 숫자 정밀도를 지키기 위해 서버가 파싱하지 않고 그대로 전달합니다.
- `review-imports`: 본문은 검수 JSON 파일 바이트 그대로, 8 MiB 이하(`Content-Length` 가 없어도 읽는 도중 넘으면 `413`). `Idempotency-Key` 헤더(1~200 자)가 필수이며 **브라우저가 만듭니다** — 같은 파일을 다시 보낼 때는 같은 키를, 파일을 고쳤으면 새 키를 씁니다. 반영 방식은 `apply=auto` 로 고정됩니다.
- 가져오기는 `202` + `Retry-After` 로 시작합니다. 끝날 때까지(`applied`·`partially_applied`·`no_change`·`failed`·`cancelled`) `Retry-After` 간격으로 상태를 다시 조회하는 것은 호출하는 쪽이 합니다. `429`·`503` 의 `Retry-After` 도 그대로 전달합니다.
- `source-jobs/{jobId}/response`: 본문을 64 MiB 까지 읽어(넘으면 `502 response_too_large`) Parse 그림 요소의 `base64_encoding` 만 떼어 내고 그 자리에 같은 origin 의 `figure_url`(`…/figures/f{n}`)을 넣어 돌려줍니다. 본문은 파싱하지 않고 정규식으로 그 쌍만 바꾸므로 숫자 토큰(큰 정수)은 그대로이고, `null`·빈 값·base64 가 아닌 값은 손대지 않습니다. 떼어 낸 그림은 서버 프로세스 메모리에 10 분·합계 128 MiB 까지 두며(넘으면 오래된 것부터 밀려남), 만료·재시작 뒤의 `figures/{key}` 는 `404 figure_not_found` 라 화면은 그 그림 자리를 숨깁니다(Job 응답을 다시 받으면 복구). 본문이 바뀌므로 이 응답에는 upstream `ETag` 를 넘기지 않습니다. 화면은 Extract 항목의 `additional_values`(필드별 `page`·`coordinates`)로 추출값 하이라이트를, Parse Step 출력의 `elements` 로 Parse 하이라이트를 그립니다(Collection 이 복사해 둔 파일은 파일 응답에 Parse 요소가 없어서). 두 좌표의 `page` 는 그 Job 입력 파일을 `input_index` 순으로 이어 붙인 1-based 번호입니다. 본문에는 Step 이 만든 결과 파일의 서명 URL 이 들어 있을 수 있어 페이지 이미지와 같은 전제가 적용됩니다. 다른 사이트에서 브라우저를 거쳐 온 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 upstream 을 부르지 않고 `403 forbidden` 입니다.
- `source-jobs/{jobId}/figures/{key}`: 위 응답이 떼어 둔 그림 바이트(`Content-Type` 은 바이트 앞머리로 가린 png·jpeg·gif·webp, 모르면 jpeg). upstream 을 부르지 않습니다. `key` 는 `f` + 숫자 1~6 자리만 받습니다.
- 오류는 upstream 과 같은 `{"error": {"code", "type", "message", "param"}}` 모양입니다. BFF 자체 오류 코드: `invalid_value`(400) · `forbidden`(403, 다른 사이트에서 온 요청) · `figure_not_found`(404) · `package_limit_exceeded`(413) · `server_misconfigured`(500) · `api_unreachable`(502) · `response_too_large`(502) · `upstream_error`(502) · `upstream_redirect`(502) · `review_status_unavailable`(503) · `upstream_timeout`(504, 응답 헤더나 본문을 제때 받지 못함).
- upstream 오류 응답은 본문을 64 KiB 까지만 읽어 메시지를 뽑습니다. envelope 모양의 JSON 이면 허용 필드만 다시 만들고, 아니면 `upstream_error` 로 감싸 태그를 지운 앞 800 자를 `message` 로 씁니다(64 KiB 를 넘으면 `Upstream responded with status N`).
- 모든 응답은 `Cache-Control: private, no-store` 이고, upstream 헤더는 `Content-Type`·`ETag`·`Retry-After` 만 전달합니다(Job 행 목록·Job 응답은 `ETag` 제외). 본문은 압축이 풀린 상태로 전달되므로 `Content-Length` 는 넘기지 않습니다.

**앱 DB 만 읽는 라우트**: 아래 두 라우트는 upstream 경로를 따르지 않는 이 앱의 화면용 경로입니다. upstream 을 부르지 않고 앱 DB 의 검수 상태 표(`job_review_status`)만 읽습니다.

| BFF | upstream | 용도 |
| --- | --- | --- |
| `GET /api/review-progress?collection_ids=a,b` | (없음, 앱 DB) | Collection 목록 화면: 한 페이지의 Collection 마다 검수 상태별 Job 수와 앱 전체 요약 |
| `GET /api/review-activity?limit=8&jobs=collectionId:jobId,…` | (없음, 앱 DB) | 홈 대시보드: 최근 검수 기록, 이 브라우저가 연 Job 의 기록, 앱 전체 요약 |

- `/api/review-progress` 는 Collection 상세가 부르는 `/api/search-collections/{id}/review-progress`(Collection 하나의 `{ done, in_progress }`)와 이름만 비슷한 다른 라우트입니다. 여러 Collection 을 한 번에 세고 앱 전체 요약을 더합니다.
- `review-progress`: `collection_ids` 는 쉼표로 이은 Collection id 최대 100 개입니다(같은 id 는 한 번만 셈). 응답은 `{ collections: { [collectionId]: { done, in_progress } }, overview: { done, in_progress, collections_in_progress } }` 이고, 기록이 없는 Collection 은 `collections` 에 없습니다(화면은 0 으로 봄). `collection_ids` 가 비면 `collections` 는 빈 객체이고 요약만 셉니다. `overview` 는 앱 DB 전체의 검수 완료 Job 수, 검수 중 Job 수, 검수 중 Job 이 하나라도 있는 Collection 수입니다. 100 개를 넘거나 형식이 틀린 id 는 `400 invalid_value`(`param: "collection_ids"`).
- `review-activity`: `limit`(1~20, 기본 8)과 `jobs`(`collectionId:jobId` 를 쉼표로 이은 목록, 최대 10 개)를 받아 `{ data, jobs, overview }` 를 돌려줍니다. `overview` 는 `/api/review-progress` 의 요약과 같고, 나머지 모양은 [홈 대시보드](#홈-대시보드) 절의 "데이터" 항목에 있습니다. 잘못된 쿼리는 `400 invalid_value`(`param` 은 `limit` 또는 `jobs`).
- 두 라우트 모두 DB 를 읽지 못하면 `503 review_status_unavailable` 이고, 응답은 `Cache-Control: private, no-store` 입니다. 코드: `src/app/api/review-progress/route.ts`, `src/app/api/review-activity/route.ts`(쿼리 검사 `query.ts`), DB 접근 `src/lib/review-status-aggregate.ts`.

**Collection 관계 라우트**: `GET /api/collection-lineage` 는 Collection 사이의 연결을 돌려줍니다. upstream 에는 이 관계를 한 번에 주는 API 가 없어서 여러 응답을 읽어 모으고, 화면이 쓰는 필드만 담은 본문을 새로 만듭니다. 쿼리는 없습니다. 탐색 비용이 커서 다른 사이트에서 온 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 `403 forbidden` 입니다.

```json
{
  "nodes": [{ "id": "scol_a", "name": "1차 결과", "source": { "type": "agent_export", "label": "1차 Workflow" }, "is_default": false, "total_job_count": 12, "pending_job_count": 0, "failed_job_count": 0 }],
  "edges": [{ "from": "scol_a", "to": "scol_b", "kind": "import", "workflow": "2차 Workflow" }],
  "unrelated_count": 40,
  "unverified_count": 0,
  "partial": false
}
```

- `kind: "import"`: 결과가 있는 Collection 마다 완료 결과를 쓴 Config 를 찾고, `GET /v2/agents/{agentId}/configs/{configId}` 의 Import Step(`collection_id`·`collection_ids`·`sources[].collection_id`)이 가리키는 Collection 에서 이 Collection 으로 잇습니다. Config 는 `GET /v2/search-collections/{id}/bindings` 에서 찾고, Workflow 에 연결된 Collection(`agent_link`)은 최근 완료 Job 100 개의 `config` 도 봅니다. 스키마 없는 결과(Import → Instruct 처럼 Extract 가 없는 경로, Merge 로 끝나는 경로)는 `bindings` 에 나오지 않기 때문입니다. 결과가 없는 Collection 은 upstream 을 부르지 않으므로, 아직 실행하지 않은 Workflow 의 연결은 나오지 않습니다.
- `kind: "result_import"`: 결과 JSON 을 고쳐 다시 가져온 Collection(`source.type: result_import`)은 숨은 Agent 의 Config 를 읽을 수 없어(`403`) Job 을 따라갑니다. `POST …/source-jobs/search`(읽기 전용 검색, 결과 유형이 여럿이면 `details.result_type_keys` 의 첫 유형으로 다시 검색)로 Job 하나를 찾고, `GET /v2/responses/{jobId}?include_deleted=true` 의 `source_job_id` 를 따라 다른 Agent 의 Job 이 나올 때까지 최대 8 단계 올라갑니다(내용을 교체하면 지워진 이전 세대 Job 을 거칩니다). 그 Job 의 `model`(실행한 Agent)이 결과를 쓴 Collection 중 `source-jobs/{jobId}/files` 가 `200` 인 곳이 원본입니다. 같은 Job 이 기본 Collection 과 Export Collection 에 함께 있으면 `table_key` 가 같은 쪽, 기본이 아닌 쪽을 먼저 봅니다.
- 목록과 같은 기준을 지키되 체인은 끊지 않습니다. Collection 목록은 `listed=true` 로 자동 생성 기본 Collection 을 숨기지만 이들도 Import 원본이 될 수 있어서, 이 라우트는 `include_default=true` 로 전부 읽고 목록에 없는 Collection(`listed: false`)으로 끝나는 연결만 지웁니다. 다른 Collection 의 원본으로 쓰이면 카드로 남습니다. 지운 뒤 다시 끝이 되는 곳이 없을 때까지 반복합니다. `unrelated_count` 도 목록에 보이는 Collection 만 셉니다.
- 기본 Collection 이 Export Collection 과 같은 결과의 사본이면(Config 에 Collection Export Step 이 있고 `boundary_kind: export_input` 이거나 Job 행에서 찾았을 때) 직접 만든 Collection 이어도 같은 규칙으로 지웁니다. Review, HTTP Export(`data.destination`)로 끝나는 Workflow 도 `export_input` 이지만 Export Collection 이 없어 사본이 아닙니다. 자기 자신을 잇는 연결은 버립니다.
- Import 원본이 목록에 없으면(삭제됐거나 권한 밖) `nodes` 에 `{ "id": "…", "missing": true }` 로 넣습니다. 연결이 없는 Collection 은 `nodes` 에 넣지 않고 `unrelated_count` 로만 셉니다.
- 다 읽지 못하면 두 가지로 알립니다. `partial: true` 는 상한에 걸렸거나 `5xx`·네트워크 오류·끝나지 않는 `429` 가 있었다는 뜻으로 다시 읽으면 나아질 수 있고, 받은 만큼 돌려줍니다. `unverified_count` 는 다시 읽어도 소용없는 이유로 연결을 확인하지 못한 Collection 수입니다(목록에 없는 Collection 은 카드로 나올 때만 셉니다). Config 를 볼 수 없거나(`4xx`, 지워진 Workflow, Collection 만 공유받은 경우) 결과 가져오기의 원본 Job 을 찾을 수 없는 경우입니다. 숨은 Agent 의 Config 거부는 정상이라 세지 않습니다. 원본을 찾지 못한 결과 가져오기는 어떤 Collection 인지 모르므로 `missing` 카드도 없습니다.
- 상한: 목록은 10 페이지(1,000 개), 결과가 있는 Collection 300 개, Collection 당 `bindings` 5 페이지(500 행), 동시 호출 6 입니다. 새 Collection 을 읽기 시작하는 시간은 목록을 다 읽은 뒤 30 초까지이고, 진행 중인 호출은 끝날 때까지 기다립니다(호출 하나의 시간 초과는 60 초). 목록과 다른 호출 모두 `429` 는 `Retry-After`(최대 3 초) 뒤 두 번 다시 부릅니다. 목록 첫 페이지가 실패하면 그 오류를 그대로 전달하고, 다음 페이지 실패는 받은 데까지로 `partial` 입니다.
- 서버 메모리 캐시: 전체 결과 1 분, Collection 별 결과 10 분(`updated_at`·`total_job_count` 가 바뀌면 다시 읽음), Config 1 시간(저장 뒤 바뀌지 않음). `partial` 결과는 전체 캐시에 넣지 않아 다음 요청이 읽은 곳부터 이어 갑니다. 앞 단계에서 읽지 못한 곳이 있을 때 결과 가져오기의 "원본 못 찾음" 은 캐시하지 않습니다. 동시 요청은 탐색 하나를 함께 씁니다. Collection 수백 개 계정에서는 첫 응답에 20 초 넘게 걸릴 수 있습니다.
- 코드: `src/app/api/collection-lineage/route.ts`, 탐색 `src/app/api/_lib/collection-lineage.ts`, upstream 호출 `src/lib/upstage/lineage.ts`.

파일 BFF 는 upstream 응답을 그대로 넘기지 않고 문서 뷰어용으로 바꿔 돌려줍니다.

| BFF                                             | upstream                                    | 용도                                                                 |
| ----------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/files/{fileId}[?refresh=1]`           | `GET /v2/files/{fileId}?view=all&pages=all` | 페이지 이미지 URL(Job 검수 화면 뷰어). 요소는 읽지 않아 바로 응답한다 |
| `GET /api/files/{fileId}/highlights?pages=a-b`  | (같은 upstream 응답의 서버 캐시)             | 파일 로컬 페이지 `a`..`b` 의 Parse 요소 하이라이트(Parse 탭)           |

- `/api/files/{fileId}` 응답 모양: `{ id, status, filename?, num_pages, pages: [{ image_url }] }`. `pages` 는 upstream `pages` 순서입니다.
- `/api/files/{fileId}/highlights` 는 `pages=a-b`(1-based, 양끝 포함, **한 번에 50 쪽까지**)가 필수이고, 응답은 `{ id, pages: [{ page, highlights }] }` 입니다 — 범위 안에서 파일에 있는 페이지만 페이지 순서로, 요소가 없는 페이지는 빈 `highlights`. 하이라이트의 `page` 는 그 파일 안에서 1 부터 세는 번호, `id` 는 `p{page}-{요소 id}`, `color` 는 요소 종류별 `var(--chart-1..5)`(표·그림·제목·본문·그 외), `_value` 는 요소 글자 앞 120 자입니다. 요소가 URL 로 온 페이지는 동시에 6 개까지만 읽습니다. 범위가 잘못되면 400 `invalid_value`(`param: "pages"`).
- 두 라우트는 응답이 클 수 있어 다른 사이트에서 브라우저를 거쳐 온 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 `403 forbidden` 입니다.
- 원본 파일 링크(`file_url`), 요소 원문(`elements`), 요소 이미지 URL 은 두 응답 모두에 넣지 않습니다. `image_url` 은 `https:` URL 만 남기고 나머지는 `null` 입니다(개발 전용 `UPSTAGE_ALLOW_HTTP_IMAGE_URLS=1` 이면 loopback `http:` 도 남깁니다 — 환경 변수 표 참고).
- `pages[].image_url` 은 upstream 이 만든 **서명 URL** 이라 URL 을 가진 누구나 만료 전까지 이미지를 읽을 수 있습니다. 이 화면을 공개망에 띄우지 않는다는 위 전제가 여기에도 적용됩니다.
- upstream 파일 응답(원본 JSON)은 64 MiB 까지 읽고(넘으면 `502 response_too_large`) 서버 메모리에 파일당 10 분(최대 50 파일 · 합계 256 MiB, 파싱한 객체를 감안해 원문 바이트의 3 배로 셈) 캐시하고, 이미지 응답과 하이라이트 범위 조회가 같은 캐시를 씁니다. 같은 파일을 동시에 조회하면(뷰어가 두 라우트를 함께 부르거나 여러 탭에서 열 때) upstream 호출 하나를 나눠 쓰고, `?refresh=1` 도 진행 중인 조회가 있으면 그 결과를 받습니다(upstream 파일 API 는 `pages=all|none` 뿐이라 범위는 서버에서 잘라 냅니다). `status` 가 `READY` 가 아니고 이미지가 빠진 페이지도 있으면 캐시하지 않습니다(Collection 이 복사해 둔 파일은 `UPLOADED` 로 남고 파싱 결과가 비어 있지만 페이지 이미지는 있어서 캐시합니다). `?refresh=1` 은 캐시를 건너뛰고 다시 조회합니다(서명 URL 이 만료돼 이미지가 안 보일 때).

#### BFF HTTP 계약(검수 화면이 기대는 것)

검수 화면(`components/job-review/`)이 부르는 BFF 연산은 `src/lib/review-api/review-screen.ts` 가 `client.ts` 의 함수를 이름 그대로 다시 내보낸 8 개입니다. 자기 BFF 로 바꿀 때는 이 표의 경로·헤더·응답 모양을 맞추거나 이 파일이 내보내는 함수를 바꿉니다. 위 표와 bullet 의 라우트 설명과 같은 내용은 여기서 다시 적지 않고 가리킵니다.

| 연산 | 메서드 · 경로(`/api/search-collections/{id}` = `…`) | 요청 헤더 | 응답에서 읽는 것 |
| --- | --- | --- | --- |
| `getCollection` | `GET …` | `Accept: application/json` | Collection 이름 등 상세 JSON(`SearchCollectionDetail`) |
| `getReviewCapabilities` | `GET …/review-capabilities` | 같음 | `ReviewCapabilities`(가져오기 한도 `max_inline_import_bytes`, 변경 이력 지원 `revisions_supported` 등) |
| `getReviewDocumentText` | `GET …/review-document?job_ids={jobId}` | 같음 | 본문 **문자열**(숫자 보존 파서로 읽음)과 `ETag` |
| `getJobResponse` | `GET …/source-jobs/{jobId}/response` | 같음 | Job 응답 JSON(하이라이트 좌표·Parse 요소, 그림은 `figure_url`) |
| `createReviewImport` | `POST …/review-imports` | `Content-Type: application/octet-stream`, `Idempotency-Key` | `202` 본문(가져오기 리소스)과 `Retry-After` |
| `getReviewImport` | `GET …/review-imports/{importId}` | `Accept: application/json` | 가져오기 리소스(상태)와 `Retry-After` |
| `getFilePages` | `GET /api/files/{fileId}[?refresh=1]` | 같음 | `{ id, status, filename?, num_pages, pages: [{ image_url }] }` |
| `getFileHighlights` | `GET /api/files/{fileId}/highlights?pages={from}-{to}` | 같음 | `{ id, pages: [{ page, highlights }] }` |

이 밖에 화면이 쓰는 앱 연산은 검수 상태 `setReviewStatus`(`PUT …/source-jobs/{jobId}/review-status`, `client.ts`, 2 층)와 변경 이력 `listJobRevisions`·`getJobRevision`(`…/source-jobs/{jobId}/revisions[/{revisionId}]`, `revisions.ts`)입니다. 모든 요청은 `cache: "no-store"` 이고 `AbortSignal` 을 받습니다. 성공이 아닌 응답은 `ApiError`(`status`·`code`·`param`·`retryAfter`)가 되며, 연결 실패는 `status` 0 · `code: "network_error"`, 본문이 오류 envelope 가 아니면 `http_error`, 성공 본문이 JSON 이 아니면 `invalid_response` 입니다.

코드만 봐서는 드러나지 않는 약속:

- **상대 URL 고정**: 클라이언트는 같은 origin 의 `/api/...` 만 부릅니다(API 키·upstream 주소는 서버에만 있음). BFF 를 다른 origin 에 두면 `client.ts`·`revisions.ts` 의 경로와 아래 same-origin 검사를 함께 바꿔야 합니다.
- **그림 URL 짝**: Job 응답 라우트가 Parse 그림의 `base64_encoding` 을 떼어 `figure_url` 로 바꾸고(본문 한도 `JOB_RESPONSE_MAX_BYTES` 64 MiB, 위 `source-jobs/{jobId}/response` bullet), 화면은 `FIGURE_URL_PATTERN`(`src/lib/review-api/parse-highlights.ts`)에 맞는 값만 `<img src>` 로 씁니다. 서버의 `figureUrl()`(`src/app/api/_lib/job-response-figures.ts`)과 패턴을 함께 바꿔야 합니다.
- **가져오기 요청**: 본문은 검수 JSON 문자열을 바이트 그대로 `Content-Type: application/octet-stream` 으로 보냅니다. `Idempotency-Key` 는 1~`IDEMPOTENCY_KEY_MAX_LENGTH`(200) 자이고 브라우저가 만듭니다 — 저장 컨트롤러(`components/job-review/save-controller.ts`)가 본문 SHA-256(`sha256Hex`) 별로 키를 기억해 같은 본문이면 같은 키를 다시 쓰고, `idempotency_key_reused` 거절을 받으면 그 키를 버립니다.
- **가져오기 본문 한도**: BFF 는 `MAX_INLINE_IMPORT_BYTES`(8 MiB, `src/lib/upstage/review.ts`)를 넘는 본문을 `413 package_limit_exceeded` 로 막습니다. 이 값은 서버 capabilities 와 따로 둔 BFF 상수입니다. 화면은 저장 전에 capabilities 의 `max_inline_import_bytes` 를, 없으면 모델 상수 `MAX_INLINE_IMPORT_BYTES`(`src/lib/review-model/upload.ts`, 같은 8 MiB)를 씁니다.
- **가져오기 polling**(`pollImport`, `src/lib/review-api/import-polling.ts`): 간격은 `Retry-After` 의 정수 초만 읽고(`retryAfterMs`, HTTP-date 등은 기본 간격) 하한 1 초 · 상한 10 초 · 없으면 2 초, 전체 제한 `IMPORT_POLL_TIMEOUT_MS`(10 분), 연속 오류 3 회에서 멈춥니다. 다시 조회하는 오류는 `isRetryableError` — `ApiError` 가 아닌 오류와 `status` 0 · 5xx · 429 · 408 이고, 그 밖의 4xx 는 바로 멈춥니다.
- **same-origin 검사**: 상태를 바꾸는 요청(`review-imports` POST, `review-status` PUT)은 `assertSameOrigin`(`src/app/api/_lib/same-origin.ts`)으로 `Sec-Fetch-Site`(없으면 `Origin`·`Host`)를 봅니다. 읽기 중 응답이 큰 라우트(`response`, `revisions`, `/api/files/*`, `collection-lineage`)는 `rejectCrossSite` 로 `cross-site`·`same-site` 만 막습니다.
- **중계 헤더**: upstream 헤더는 `RELAYED_HEADERS`(`content-type`·`etag`·`retry-after`, `src/app/api/_lib/upstream-relay.ts`)만 넘기고 모든 응답은 `Cache-Control: private, no-store` 입니다.
- **`review-document`**: `job_ids` 는 1~`MAX_DOCUMENT_JOBS`(100) 개입니다. BFF 는 `If-None-Match` → `304` 를 중계하지만 이 화면은 보내지 않고, 받은 `ETag` 를 상태(`job-review-state.ts` 의 `etag`)에 들고만 있습니다.
- **파일 라우트는 변환 DTO**: `/api/files/{id}` 는 upstream 파일 응답을 그대로 넘기지 않고 뷰어용 모양으로 바꿉니다(위 "BFF 라우트" 의 파일 BFF 표). `?refresh=1` 은 서버 캐시를 건너뜁니다. URL 로 온 요소는 `ELEMENTS_MAX_BYTES`(5 MiB, `src/app/api/_lib/viewer-document.ts`)까지 읽고, 하이라이트는 한 번에 `HIGHLIGHT_RANGE_MAX_PAGES`(50) 쪽입니다.
- **오류 envelope**: `{"error": {"code", "type", "message", "param"}}`. BFF 가 만든 오류는 `type` 이 `code` 와 같고(`errorResponse`), upstream 오류는 `type` 이 있으면 그 값을 둡니다. 클라이언트는 `code`·`message`·`param` 만 읽고 분기는 `code` 로 합니다.

### 로컬 확인

```bash
pnpm dev
curl -i "http://localhost:3000/api/search-collections/$COLLECTION_ID/review-capabilities"
curl -D - "http://localhost:3000/api/search-collections/$COLLECTION_ID/review-document?job_ids=$JOB_ID" -o review.json
curl -i -X POST "http://localhost:3000/api/search-collections/$COLLECTION_ID/review-imports" \
  -H "Idempotency-Key: $(uuidgen)" --data-binary @review.json
```

목록 화면은 `pnpm dev` 후 `/ko/collections` 에서 확인합니다.

- 첫 요청은 `limit=100&order=desc` 한 번이고(20 행 × 5 페이지), 1~5 페이지 사이 이동은 요청을 만들지 않습니다. 5 페이지에서 "다음" 을 누르면 `after=<last_cursor>` 로 다음 블록을 받습니다. `pnpm dev` 에서는 React Strict Mode 때문에 첫 요청이 한 번 더 나갔다가 취소(`ERR_ABORTED`)됩니다.
- 열 헤더는 현재 페이지 안에서만 오름차순 → 내림차순 → 해제로 정렬하고(`aria-sort`, 페이지가 여럿이면 표 아래 페이지 이동 줄 왼쪽에 그 안내), 제목 오른쪽 "정렬 순서" 셀렉트는 서버 `order` 를 바꿔 1 페이지부터 다시 받습니다. 이름 옆 복사 버튼은 hover 나 focus 하면 툴팁에 Collection ID 를 보이고, 누르면 ID 를 클립보드에 복사합니다(Collection 상세의 이름 옆에도 같은 버튼).
- 출처 열 머리의 깔때기 메뉴로 받은 페이지 안에서만 거릅니다(필터 빈 행에 "필터 지우기"). 메뉴는 "전체" 와 출처 다섯 종류의 체크 항목이고, 여러 출처를 함께 고를 수 있으며(고르는 동안 메뉴가 열려 있음, 고른 출처 중 하나라도 맞으면 보임) 항목마다 그 출처가 무엇인지 회색 한 줄 설명이 있습니다. 고른 수는 머리 라벨 뒤 `(n)` 으로 보이고, "전체" 를 누르면 비웁니다. 출처가 없거나 모르는 값인 행은 출처를 하나라도 고르면 빠집니다. 출처 열 칸은 출처 배지입니다. 머리 끝 `…`("열 보기 설정")에서 열을 숨기거나 보이고(이름 열은 늘 보임, 브라우저 `localStorage` `collections-list-hidden-columns` 에 기억), Workflow 열과 마지막 결과 열은 기본으로 숨겨져 있습니다. "검수" 열도 이 메뉴에서 숨길 수 있습니다. 열을 숨기면 그 열의 정렬과 필터도 풉니다.
- 표는 열마다 폭이 정해져 있어(`table-fixed` + `<colgroup>`, `src/components/collections/column-widths.ts`) 보이는 열이 같으면 필터·정렬·페이지를 바꿔도 열 폭이 그대로입니다. 이름 열이 남는 폭을 갖고, 보이는 열에 따라 표 최소 폭이 정해져 좁은 창에서는 가로로 스크롤합니다. 칸을 넘는 글자(이름, 출처 배지, Workflow, 날짜 등)는 말줄임되고 마우스를 올리면 브라우저 기본 툴팁(`title`)으로 전체가 보입니다.
- 정렬 순서·열 정렬·출처 필터·페이지는 주소 query(`order=asc`·`sort=<열>.<asc|desc>`·`source=<유형>[,<유형>…]`(여러 출처는 쉼표로, 값이 하나뿐인 주소도 그대로 읽음)·`page=<n>`·`cursor=<c>` 반복)에 `replaceState` 로 적혀, 상세에서 브라우저 뒤로 가기나 "Collection 목록" 링크(이 탭 `sessionStorage` `collections-list-search` 의 마지막 query 를 붙임)로 돌아와도 같은 화면이 됩니다. 기본값은 적지 않고 모르는 값은 버리며, `cursor` 수가 `page` 의 블록(5 페이지 단위)과 맞지 않으면 1 페이지로 엽니다. 숨긴 열의 정렬·필터는 주소에 있어도 풀고 엽니다. 커서는 같은 정렬 순서에서만 유효하므로 맞지 않으면 목록이 오류와 "다시 시도" 를 보입니다.

코드 위치: 서버 클라이언트는 `src/lib/upstage/`(경로는 `endpoints.ts`, 호출은 `upstageFetch`, 검수 API 함수는 `review.ts`), 라우트는 `src/app/api/search-collections/`·`src/app/api/files/`, 파일 응답 변환은 `src/app/api/_lib/viewer-document.ts`, 원본 JSON 캐시는 `file-source.ts`(`ttl-cache.ts`), relay·same-origin helper 는 `src/app/api/_lib/`.

### mock 모드 (API 키 없이 실행)

실제 키 없이 화면을 띄우고 저장까지 돌려 보는 모드입니다. `mock/` 의 생성기가 seed 고정 데이터(기본 **200 쪽 Job**: 파일 1 개, Classify 문서 ≈ 30 개 — index 10 은 60 쪽 긴 문서 `doc_long` —, 문서마다 Extract(송장형)·Validate 결과, 쪽당 Parse 요소 ≈ 60, Instruct 출력 3 개)를 만들고, `mock/server.mjs` 가 콘솔 API 의 `/v2/...` 경로를 그대로 흉내 냅니다. 큰 Job 에서 화면·BFF 성능을 재거나 파트너가 데모를 띄울 때 씁니다.

```bash
cp .env.mock.example .env.mock      # 한 번. UPSTAGE_CONSOLE_API_URL=http://127.0.0.1:4010 · UPSTAGE_ALLOW_HTTP_IMAGE_URLS=1 · DATABASE_URL=로컬 Postgres(5435)
docker compose up -d --wait postgres   # 레포 루트에서. 검수 상태를 두는 앱 DB
pnpm migrate                        # 한 번(스키마가 바뀌면 다시). Prisma 는 .env 의 DATABASE_URL 을 읽는다(없으면 cp .env.example .env) — .env.mock 과 같은 로컬 DB
pnpm mock:gen                       # mock/.generated/dataset.json (gitignore) + 모델 검사(vitest)
pnpm mock:serve                     # 터미널 A: mock upstream, http://127.0.0.1:4010
pnpm build && pnpm mock:start       # 터미널 B: .env.mock 으로 프로덕션 서버 (pnpm dev 는 Job 화면이 반복 새로 고침될 수 있다)
open http://localhost:3000/ko/collections/scol_mock_0001/jobs/job_mock_0001
```

- `pnpm mock:start` 는 `node --env-file=.env.mock` 으로 Next 를 띄웁니다. Next 는 `.env.mock` 을 읽지 않고 이미 있는 `process.env` 를 덮어쓰지 않으므로, `.env` 에 실제 키가 있어도 `.env.mock` 값이 우선하고 `.env.mock` 에 없는 키만 `.env` 를 씁니다. 3000 포트를 다른 프로세스가 쓰고 있으면 `PORT=3100 pnpm mock:start` 처럼 포트를 바꿉니다(`pnpm mock:start -- -p 3100` 은 pnpm 이 `--` 를 그대로 넘겨 동작하지 않습니다).
- **앱 DB**: Job 검수 상태(검수 중·검수 완료)는 mock 모드에서도 이 앱의 로컬 Postgres 에 둡니다([화면](#화면) 절의 "검수 상태" 항목). `.env.mock` 의 `DATABASE_URL` 이 `.env.example` 과 같은 `localhost:5435` 이므로 위처럼 컨테이너를 띄우고 마이그레이션을 적용해 둡니다. DB 가 없으면 화면은 뜨지만 검수 열이 "—", 진행 현황은 오류 문구, 검수 완료는 실패 안내가 됩니다. mock 서버를 재시작해도 검수 상태는 DB 에 남습니다.
- 고정 ID: Collection `scol_mock_0001`, Job `job_mock_0001`(`--jobs 3` 이면 `job_mock_0002`·`job_mock_0003` 도), 파일 `file_mock_0001`(파일 3 개면 `..0003`), Step `st_parse`·`st_classify`·`st_extract`·`st_validate`·`st_instruct`, 결과 `occ_ext_{n}`·`occ_val_{n}`.
- 페이지 이미지는 mock 서버가 만드는 SVG(1240×1754, `http://127.0.0.1:4010/pages/{fileId}/{n}.svg`)입니다. 파일 BFF 는 `https:` 이미지 URL 만 넘기므로 `.env.mock` 의 `UPSTAGE_ALLOW_HTTP_IMAGE_URLS=1` 이 loopback `http:` 를 예외로 허용합니다(위 환경 변수 표).
- **저장**: `review-imports` POST 는 mock 서버 메모리에 바로 반영되고(결과 `content` 교체 + `base_version + 1`, 구조를 보냈으면 구조·문서 배치 교체 + `base_version + 1`, Job 응답의 같은 결과 본문도 갱신), POST 응답은 `202` `pending` 이고 앱은 상태 조회로 polling 합니다 — 첫 번째 조회는 `applying`, 두 번째부터 `applied`(`units[].applied_versions`)이며, 보낸 내용이 지금 값과 같아 바뀐 것이 없으면 `applied` 대신 `no_change` 입니다. 반영될 때마다 바뀐 결과·구조마다 그 Job 의 변경 이력(아래 `revisions`)에 revision 행이 쌓입니다(같은 저장 = 같은 `operation`, 행 `published_at` = 가져오기 `published_at`, 행 id `rvn_mock_{6자리}`; 내용이 같아도 version 이 오르고 행이 남습니다). 디스크에 쓰지 않으므로 서버를 재시작하면 처음 상태로 돌아갑니다. `Idempotency-Key` 가 없으면 400, 같은 키는 같은 가져오기를 돌려줍니다. 보낸 결과·`file_groups` 의 `base_version` 이 지금 version 과 하나라도 다르면 실제 서버(`apply=auto`)처럼 아무것도 반영하지 않고 두 번째 조회부터 `failed` + `error.code` `base_version_conflict` + `error.details.conflicts[]`(`{ target: { kind, job_id, occurrence_id? }, base, current }`)로 끝납니다(두 탭에서 같은 값을 고쳐 저장하면 뒤 탭이 충돌). `POST /__mock/reset`(Bearer 필요, `204`)은 저장으로 바뀐 상태와 가져오기 이력·변경 이력을 처음(seed 이력)으로 되돌립니다 — 스모크·데모 뒤 서버를 재시작하지 않고 되돌릴 때 씁니다.
- **변경 이력**: `GET /v2/search-collections/scol_mock_0001/source-jobs/{jobId}/revisions` 와 `…/revisions/{revisionId}` 를 실제 서버 계약대로 흉내 냅니다(Job 마다 메모리 원장, `mock/lib/revisions.mjs`). 기본 데이터셋은 Job 1 에 seed 이력 7 행(`--history 3`: 묶음 `rvop_seed_1`·`rvop_seed_2`·`rvop_seed_3`, 마지막은 다른 Collection 의 `migration`; 행 id `rvn_seed_{4자리}`)을 둡니다 — 대상은 `occ_ext_2`(3 version)·`occ_ext_3`(2)·`occ_val_2`(1)·문서 구성(1)이고, 마지막 version 내용은 지금 문서 내용과 같습니다. 편집되지 않은 대상의 `base_version` 은 `0`(기계 출력)이고 `base_version: 0` 행의 `base_content` 가 기계 출력입니다(처음 저장되는 대상은 덮어쓰기 전 내용을 기계 출력으로 남김). 목록은 `published_at DESC, version DESC, id DESC` 순이고 `type`(`result`|`structure`)·`occurrence_id`·`job_result_id`(mock 규칙 `jres_{occurrence_id}`)·`operation_id`·`include=content`·`after`(직전 `last_id`)·`limit`(1~100, 기본 50)·`order`(`asc`|`desc`, 기본 `desc`)를 해석합니다. 잘못된 `type`·`include`·`limit`·`order` 는 `422`, `type=structure` 와 결과 필터를 함께 주면 `400 invalid_value`, 이 Job 결과가 아니면 `404 result_not_found`, 모르는 `after` 는 `400 invalid_cursor` 입니다. 단건은 `ETag: "rev-{id}"` 와 `If-None-Match` → 304, 없으면 `404 revision_not_found`. `POST /__mock/revisions-fail?status=429|500&count=N&retry_after=2`(Bearer 필요, `204`)는 그 뒤 revisions 요청 N 개를 그 상태(`429` 는 `operation_capacity_exceeded`)와 `Retry-After` 로 실패시킵니다(`reset` 이 함께 지움). Job 2..N 은 이력이 없습니다.
- 모든 `/v2/*` 는 비어 있지 않은 `Authorization: Bearer …` 가 있어야 하고(없으면 401), 인증 없이 받는 것은 `/pages/...` 이미지만입니다. `review-document` 는 Job 하나(`job_ids` 1 개)만 받고 `ETag: "mock-{jobId}-{version}"` 과 `If-None-Match` → 304 를 지원합니다. 저장 버전·문서·응답은 Job 마다 따로입니다.
- `source-jobs` 목록은 `limit`(1~100, 기본 20), `after`(이 서버가 낸 `cursor:{n}`), `order`(`updated_at` 기준, 기본 `desc`), `latest`(`true` 나 `false` 면 `config.is_latest` 로 거름, 그 밖의 값은 400)만 해석하고 `has_more`, `first_cursor`, `last_cursor` 를 채웁니다. `--jobs` 의 짝수 번째 Job 은 이전 Config 행이라 "표시 옵션" 의 "최신 설정 결과만 보기"(기본 켜짐)가 켜져 있으면 홀수 번째 Job 만 보이고, 끄면 모두 보입니다. `group_by`, `q`, `status` 는 **무시**하므로 검색어나 "이전 실행도 보기" 를 바꿔도 행이 같습니다(`--jobs` 의 Job 은 모두 같은 입력 파일이라 실제 upstream 의 `group_by=input_files` 라면 한 행으로 묶입니다). 검수 상태 필터는 BFF 가 거르므로 mock 에서도 동작합니다. Collection 목록은 `is_default`·`listed` 를 `true`/`false` 로 거르고(그 밖의 값은 400) 다른 쿼리는 무시합니다. 기본 Collection 은 관계 보기용 3 개이고 그중 instruct 결과 Collection 만 `listed: true` 입니다(`scol_mock_0001` 은 기본 Collection 이 아님).

생성 옵션(`pnpm mock:gen -- <옵션>`; 저장 뒤 `src/test/__tests__/mock-dataset.test.ts` 로 검사하며 `--no-check` 로 생략):

| 옵션                      | 기본               | 설명                                                                            |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------- |
| `--seed <n>`              | `1`                | 난수 seed. 같은 옵션이면 같은 바이트                                            |
| `--files <n>`             | `1`                | 입력 파일 수. `3` 이면 `100/60/40` 쪽(`mock-100p.pdf` …)으로 나눈다             |
| `--groups <n>`            | `1`                | 파일 그룹 수(`--files` 이하). 파일을 앞에서부터 균등하게 나눠 담고(`--files 3 --groups 2` → 파일 1·2 / 3), 문서는 그룹 경계를 넘지 않는다. `index.json` `documents[].group` 에 그룹 id |
| `--pages <n>`             | `200`              | 전체 페이지 수. `12` 처럼 작게 만들면 작은 Job 에서 쓰는 화면 경로(20 쪽 이하 전체 필름스트립, 윈도잉 없는 목록 등)를 확인할 수 있다 |
| `--elements-per-page <n>` | `60`               | 쪽당 Parse 요소 수(최소 `12`). heading 2·list 4·table 4·footer 1 고정, 짝수 쪽 figure 1, 나머지 paragraph |
| `--items-max <n>`         | `30`               | Extract 결과 `items[]` 최대 행 수(문서마다 5‥n). `120` 처럼 크게 하면 값 패널의 50 개 묶음·"더 보기" 경로를 확인할 수 있다 |
| `--jobs <n>`              | `1`                | Job 수. `2` 이상이면 Job 1 을 복제해 `job_mock_0002..n` 을 만든다(같은 입력 파일을 다시 실행한 Job — 파일 id 공유, `job_id`·`file_ref`·시각만 다름, 1 시간씩 뒤). 짝수 번째 Job 은 이전 Config(`is_latest: false`)로 돈 행이다. Collection `total_job_count` 는 n, `latest_config_job_count` 는 홀수 번째 Job 수. `index.json` `jobs` 에 Job id 목록. 검수 큐·상태 확인용(`--jobs 3 --pages 12`) |
| `--history <n>`           | `3`                | Job 1 에 미리 심는 변경 이력 version 수(0~1000, `0` 이면 이력 없음 — `dataset.json` `history: null`, `base_version` 전부 0). `3` → 7 행, `60` → 64 행(이력 목록 번호 페이지·오래된 순 여러 페이지 확인용). `index.json` `history` 에 `{ job, rows, operations, results, structure }` 요약 |
| `--copied`                | 꺼짐               | Collection 이 복사한 파일처럼 파일 응답의 요소를 비운다(Parse 는 Job 응답에서만) |
| `--extra-extract-step`    | 꺼짐               | 같은 타입 Extract Step 을 하나 더 둔다(`st_extract_2`, 결과 `occ_ext2_<n>` 는 첫 Extract 결과 복사). Extract 탭 둘에 긴 Step 이름이 보여 머리 줄 탭 이름 말줄임을 확인할 수 있다. 꺼져 있으면 출력 바이트 그대로 |
| `--no-split`              | 꺼짐               | Classify 가 문서를 나누지 않은 것처럼 그룹마다 문서 하나(그룹 파일 전체)만 둔다. 긴 문서는 없다. `index.json` `options.split` 이 `false` |
| `--out <dir>`             | `mock/.generated`  | 저장 폴더(`dataset.json`·`index.json`)                                          |

mock 서버 환경 변수: `MOCK_PORT`(기본 `4010`) · `MOCK_HOST`(`127.0.0.1`) · `MOCK_LATENCY_MS`(응답마다 지연, 기본 `0`) · `MOCK_DATA`(데이터 파일, 기본 `mock/.generated/dataset.json`) · `MOCK_REVISION_CONTENT_MAX_BYTES`(revision `content`·`base_content` 하나의 바이트 상한, 넘으면 `*_omitted: "too_large"`; 기본 무제한). 포트를 바꾸면 `.env.mock` 의 `UPSTAGE_CONSOLE_API_URL` 도 함께 바꿉니다.

확인용 요청:

```bash
curl -s -H "Authorization: Bearer x" http://127.0.0.1:4010/v2/search-collections/scol_mock_0001/review-capabilities
curl -s -D - -H "Authorization: Bearer x" "http://127.0.0.1:4010/v2/search-collections/scol_mock_0001/review-document?job_ids=job_mock_0001" -o /dev/null
curl -s -H "Authorization: Bearer x" "http://127.0.0.1:4010/v2/search-collections/scol_mock_0001/source-jobs/job_mock_0001/revisions?limit=2"
curl -I http://127.0.0.1:4010/pages/file_mock_0001/1.svg
curl -s http://127.0.0.1:4010/v2/search-collections            # 401
curl -s http://localhost:3000/api/files/file_mock_0001 | head -c 300   # image_url 이 http://127.0.0.1:4010/...
```

`mock/*.mjs` 는 ESLint 대상이지만 Prettier 검사(`src/**`)에는 들어가지 않으므로 고친 뒤 `npx prettier --write mock` 을 직접 실행합니다. 코드 위치: 생성기 `mock/lib/dataset.mjs`(순수 함수 `generateDataset`·`pageSvg`), CLI `mock/generate.mjs`, 서버 `mock/server.mjs`(Node HTTP 로 감싸기)·본체 `mock/lib/upstream.mjs`(라우팅·저장, 전송 계층과 무관), 변경 이력 원장 `mock/lib/revisions.mjs`, 모델 검사 `src/test/__tests__/mock-dataset.test.ts`, 원장 테스트 `src/test/__tests__/mock-revisions.test.ts`.

#### 스모크 (`pnpm mock:smoke`)

mock 모드로 띄운 Job 화면을 Chromium(Playwright)으로 열어 사람이 손으로 확인하던 읽기·조작 동작을 시나리오별로 되풀이합니다. 시나리오마다 새 브라우저 컨텍스트(빈 localStorage — 구성 탭 필름스트립만 펼침으로 시작하고, 측정 하네스도 펼친 화면으로 잽니다)를 쓰고 `[PASS]/[FAIL] <시나리오>/<확인>` 을 찍으며, FAIL 이 하나라도 있으면 exit 1 입니다. 데이터가 맞지 않는 시나리오는 `[SKIP]` 으로 이유만 찍고, 고른 시나리오가 모두 SKIP 이라 PASS·FAIL 이 하나도 없으면 "실행된 시나리오가 없습니다" 와 함께 exit 2 입니다. 시간 초과(`--timeout`)로 끝난 시나리오가 그 뒤에 남기는 확인은 버립니다. **CI 에서는 돌지 않습니다** — 화면 동작을 바꾼 뒤 로컬에서 돌립니다. 저장(`review-imports` POST)은 `save`·`history`·`queue` 시나리오만 하며 끝에(실패해도) `--mock` 서버의 `/__mock/reset` 으로 되돌립니다. 실제 upstream 에 쓰지 않도록 시작할 때 mock Collection 의 `review-capabilities` 가 200 인지 확인해, 아니면 "대상이 mock 모드가 아닙니다" 로 멈춥니다(쓰기 요청은 mock 서버에만 보냅니다). Job 화면을 열면 검수 상태가 앱 DB 에 "검수 중" 으로 남고 `queue` 시나리오는 검수 완료·되돌리기를 씁니다(`queue` 는 시작할 때 모든 Job 을 검수 중으로 맞추므로 여러 번 돌려도 됩니다).

```bash
pnpm mock:gen && pnpm mock:serve                       # 터미널 A
pnpm build && PORT=3100 pnpm mock:start                # 터미널 B
pnpm mock:smoke -- --base http://localhost:3100        # 터미널 C: 전체 (기본 데이터에서 values 는 SKIP)
pnpm mock:smoke -- --base http://localhost:3100 --only viewer,draft
```

옵션: `--base http://localhost:3000` · `--mock http://127.0.0.1:4010`(mock 서버, `save` 의 reset 용 — `MOCK_PORT` 를 바꿨으면 함께) · `--locale ko` · `--index mock/.generated/index.json` · `--only <a,b>` · `--headed` · `--timeout 60000`(시나리오 하나의 상한) · `--list`.

| 시나리오            | 확인하는 것                                                                                                          | 필요한 데이터                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `defaults`          | 설정을 건드리지 않은 기본 화면(빈 `localStorage`): Parse, Instruct 탭과 JSON 메뉴 · 변경 이력 버튼이 없음, 구성 탭에 페이지 썸네일 토글은 보이고(기본 켜짐) 문서가 나뉜 Job 이라 띠가 펼친 채 시작하며 페이지 편집 도구, 페이지 정리는 없음, 설정에서 페이지 편집 도구를 켜 페이지와 문서를 제외한 뒤 끄면 문서 되돌리기는 남고, 페이지 썸네일도 끄면 토글이 사라지고 문서 목록 아래 제외 페이지 안내의 "페이지 썸네일 켜기" 로 썸네일과 제외 칸이 보임 | 모두(`--no-split` 데이터에서는 띠가 접힌 채 시작하는지를 대신 확인) |
| `viewer`            | 연속 스크롤 기본, PageDown, End, Home, Alt+↓, PageDown 직후 PageUp, 키 반복이 마지막 입력을 따름(뷰어 `select-page` 마크 없음), 주소창이 300 ms 뒤 갱신, `pagehide` 에 즉시 기록, `aria-keyshortcuts`, 화면 낭독기용 설명, 보기 방식 토글이 아래 툴바의 쪽 번호 오른쪽에 있고 한 장씩 보기와 이어서 스크롤을 오감, 설정 메뉴로 언어를 바꿔도 `?doc&page` 와 뷰어 쪽 유지 | 모두                              |
| `position-bar`      | 13 쪽 이상 문서에서 위치 바, 끝 쪽 ◀/▶ `aria-disabled`(눌러도 그대로, 포커스 유지), ▶ 직후 ◀ 가 1 쪽으로(5 회, 뷰어 `select-page` 마크 없음) | 13 쪽 이상 문서                   |
| `document-list`     | 100 문서 초과면 윈도잉(아니면 전체 행), 검색 필터는 입력 직후 그대로이고 300 ms 뒤 적용·요약 줄, 선택이 가려진 안내와 "필터 지우기"(기다리지 않고 전체로), 결과 메뉴를 Esc 로 닫으면 포커스가 메뉴 버튼으로 | 모두                              |
| `filmstrip`         | 이웃 보기 띠 3 개, 접힌 띠 썸네일 메뉴 2 항목(펼친 띠 4), "위치 지정…" 범위 문구, 범위 밖 거부, 합성 DnD 3 종(페이지 → 제외 띠, 페이지 → 이웃 띠, 띠 → 띠 합치기), 빠진 페이지가 생기면 빠진 띠 펼침, 필름스트립 접기(접으면 페이지 넘침 0), 다시 펼치기, 펼쳐도 토글이 제자리이고 띠가 뷰어 칼럼 폭 안이며 페이지 넘침 0(창 높이 맞춤 유지) | 20 쪽 넘는 Job                    |
| `structure-toolbar` | 경계 버튼 `aria-disabled` 와 포커스 유지, 1 쪽 문서 "앞 문서로" 뒤 앞 문서 선택, "페이지 옮기기…" 의 "특정 페이지 앞" 범위 문구와 옮긴 뒤 대상 문서 선택, "페이지 옮기기…" 로 보던 2 쪽만 새 문서로 분리(`move-pages-new-document`, 라벨 필드가 보이고 위치 라디오가 없으며, 새 문서 1 쪽 선택, 변경 +1), 나누기 뒤 새 문서 선택 | 모두                              |
| `structure-label`   | 구조 패널 라벨 칸: 라벨 select 를 바꾸면 변경 사항 +1, 원래 라벨로 되돌리면 원래대로(원래 "라벨 없음" 이면 건너뜀), "새 문서로 분리…" 대화 상자 라벨 select 에서 고른 값이 보이고 취소하면 변경 수 그대로, 라벨 목록이 없는 문서의 자유 입력은 Enter 로 확정(앞뒤 공백 제거, 변경 +1, 입력이 다시 만들어져 포커스가 입력을 떠남)·200 자 제한·Esc 로 되돌림 | 모두 |
| `organizer`         | 페이지 정리 화면: 열면 작업 패널 자리에 격자, 띠와 띠 토글 숨김, 창 높이 맞춤 유지, 보이는 행만 그림(끝까지 내려도 셀 수 < 전체 쪽수, 마지막 문서 머리 보임), 셀 클릭 → 뷰어, 주소창, 마크 `organizer`, S → M 셀 폭과 `localStorage` 기억, 셀 메뉴 5 항목, 메뉴 제외 → 제외 칸 셀 메뉴 "문서로 되돌리기 ▸", 합성 DnD 2 종(뒤 문서 머리에 놓기, 제외 칸 머리에 놓기), 머리 메뉴 "위치 지정…" 범위, 라벨 select 변경 → 변경 사항 수, 여러 장 선택(셀 클릭 + 두 칸 뒤 Shift+클릭 → 바 `3장`, 눌림 셀 3, 일괄 제외 → 제외 칸 셀 +3, 바 사라짐, 그 일괄 제외가 트레이에서 한 줄(변경 +2, 트레이 줄 +1)이고 그 줄 되돌리기로 변경 개수, 제외 칸이 원래대로, 두 문서 첫 장 ⌘/Ctrl+클릭 → "새 문서로 분리…" → 대화상자에 라벨 필드 → 옮기기 → 변경 +2, 주소창이 새 문서 1 쪽, 2 장 → "다른 문서로 옮기기…" 대화상자에 범위 입력 없이 요약 → 첫 문서 끝으로 → 셀 +2, Esc → 바 사라짐, 선택이 없을 때 힌트 줄이 있고 ⌘/Ctrl+클릭으로 바가 생기거나 Esc 로 비워도 같은 셀의 y 가 그대로), 셀 사이 ✂(문서 첫 셀에는 없고 둘째 셀부터 있음, `tabindex=-1`, ✂ 에서 마우스로 끌어도 셀 끌기가 시작되지 않고 변경 없음, 누르면 그 문서가 첫 쪽만 남고 바로 뒤 새 문서 머리, 변경 +1, 눌림 셀 그대로, 트레이에서 그 나누기 되돌리기로 원래대로), 파일 그룹이 둘 이상이면 그룹 경계 표시(둘째 그룹 첫 문서 머리 행에 하나), 앞 그룹 끝 장과 둘째 그룹 첫 장을 함께 고르면 그룹 섞임 안내와 옮기기, 새 문서로 분리 막힘(제외는 됨), 다른 그룹 문서 머리로 끌면 거부 사유가 보이고 변경 없음, 여러 장 끌기(⌘/Ctrl+클릭 2 장을 제외 칸 머리로 → 둘 다 제외, 변경 +1, 바 사라짐, Shift 범위 2 장을 앞 문서 머리로 → 그 문서 끝에 +2, 주소창이 그 문서, 같은 문서 둘째, 넷째 장을 첫 장 자리로 → 문서 순서로 맨 앞에 모임, 자리가 그대로인 drop 은 안내 없이 변경 없음, 선택 유지, 그룹 섞인 선택은 어느 문서 머리에도 거부; 끄는 동안 바닥 상태 줄에 `2장을 함께 옮기는 중`), 닫으면 구성 패널, 띠 토글 복귀, 머리 줄 "완료" 로 닫아도 같고 포커스가 툴바의 페이지 정리 토글로 감 | 20 쪽 넘는 Job. 그룹 확인 4 개는 `--files 3 --groups 2`(단일 그룹이면 건너뜀) |
| `values`            | 50 번째 뒤 항목 선택 → 다른 값을 골라도 한도 유지, 더 보기, "현재 페이지 값만" 중 항목 추가가 보이고 포커스, 숫자 입력 오류가 `aria-invalid` 와 `aria-describedby` 로 입력에 연결, 마지막 배열 항목을 메뉴로 지우면 포커스가 이전 항목으로, 비운 배열이 "바뀐 값만" 에서 보임, JSON 으로 넣은 schema 에 없는 필드 행에 오류 문구, 10,000 자를 넘는 문자열이 요약 위젯, 고정한 값 행과 Instruct 인용 칩이 뷰어 빈 곳 클릭에는 남고 머리글 클릭에 풀림, 다른 칩을 누르면 고정이 옮겨 감, "설명 보기" 와 "규칙 보기" 가 기본 꺼짐이고 켜면 설명과 Config 규칙이 보이며(원본 판정 근거는 늘 보임) 다시 열어도 기억, 한글 조합 중(`compositionstart` 뒤 `isComposing` keydown) Enter 는 값을 확정하지 않고 조합이 끝난 뒤 Enter 가 확정(변경 사항 수), 배열 표 칸에서 Tab 이 같은 행 다음 칸·행 끝이면 행 메뉴 버튼·바뀐 칸이면 그 칸 되돌리기 버튼으로 가고, Enter 확정 뒤 다음 칸(행 끝이면 다음 행 첫 칸)으로 포커스, 되돌리기로 원래 값, 빠진 칸 "＋" 를 누르면 새 칸 입력에 포커스(빠진 칸이 없으면 결과 JSON 편집으로 만든다) | `pnpm mock:gen -- --items-max 120` |
| `draft`             | 임시 저장 500 ms 디바운스, `pagehide` 에 즉시 기록, 새로 고침 뒤 배너·힌트, 첫 편집에 배너가 사라지고 새 편집만 저장, 복원·버리기 | 모두                              |
| `save`              | 첫 문서 Extract 결과의 문자열 칸 하나를 고쳐 헤더 "저장" → 저장됨(저장 상태 `title`) → 새로 고침 뒤에도 바뀐 값 → 원래 값으로 되돌려 다시 저장, `base_version` 을 하나 낮춘 본문을 BFF 에 직접 보내면 `failed`·`base_version_conflict`·`details.conflicts`, 끝에 `POST /__mock/reset` 이 `204` | 모두 |
| `history`           | `review-capabilities` 의 `revisions_supported` 를 `false` 로 바꾼 창에서 헤더 "변경 이력" 비활성 + 래퍼 hover 툴팁, 결과 메뉴 항목 비활성 → 기본 창에서 버튼 활성, 시트 행 수 = min(이력, 20)이고 20 행 이하면 페이지 버튼 없음, 머리줄 있는 묶음은 상자 · 머리줄 ! 툴팁, (20 행 초과) 2 페이지 이동 · 다음 · 이전이 요청 없이 행 집합을 바꾸고, 100 행 이하면 마지막 페이지 끝에 기계 응답 행, 100 행 초과면 받은 마지막 페이지(5)에서 다음 → `after` 요청 1 회로 6 페이지, 이전으로 돌아갈 때 요청 0 → 오래된 순에서 묶음 `rvop_seed_2` "모두 불러오기" → 요약 `data-loaded=1`·`data-total=2`(contract 는 지금 반영본) · 변경 수 1 · 트레이 항목에 "이력 vN에서 불러옴" → 되돌리기 → 값 행 펼침 → 상세 표 행 · JSON `<pre>` → 현재 반영본이 아닌 값 행 "편집에 불러오기" → 불러옴 표시 · 시트 유지 · 트레이 닫힘 · 변경 수 1 → 닫기 뒤 포커스가 헤더 버튼 → 저장 → 다시 열면 맨 위 새 행에 현재 반영본, 그 결과의 이전 반영본은 뱃지 없음 → 오래된 순(`order=asc` 요청) 1 페이지 처음이 기계 응답 행, 첫 행 `v0→v1`, 기계 행 대상 → 결과 대상 한 번 클릭으로 편집에 불러옴(변경 수 1) · 같은 버튼 비활성 · 트레이 "최초 원본에서 불러옴" → 되돌리기 → 받는 동안(`page.route` 로 최초 원본 요청 `order=asc&limit=1` 을 붙잡음) 같은 결과의 이력 행을 불러오면 늦게 온 출력은 넣지 않고 안내(`machine-skipped`) · 변경 수 1, 다시 누르면 다시 받지 않고 불러옴 → 받는 동안 기계 행을 접으면 넣지 않고, 펼쳐 누르면 불러옴 → 받는 동안 시트를 닫으면 요청이 끊김(`ERR_ABORTED`) · 변경 수 0 → `/__mock/revisions-fail` 429(`retry_after=2`) → 대상 줄 오류가 "2초 → 1초" 로 줄고 그동안 다시 시도 비활성 → 다시 시도로 불러옴 → "문서 구성" 대상은 펼칠 때 받아 두어 누르기 전 영향 경고(`machine-impact[data-state=pending]`) · 변경 수 0 → 누르면 불러온 뒤 영향 요약(`machine-impact[data-state=applied]`, 문서 집합이 그대로면 둘 다 SKIP) · 트레이 구조 항목 1 개 "최초 원본에서 불러옴" → 결과 메뉴 "이 결과의 변경 이력" → 결과 칩 · 모든 행이 그 결과 → 칩 지우기(결과 조건 없는 요청), 닫으면 포커스가 결과 메뉴 버튼 · `body` pointer-events 복구 → `/__mock/revisions-fail` 429 → 오류 · 다시 시도 비활성 → 대기 뒤 성공 → BFF 로 결과 둘을 한 번에 저장 → 맨 위에 같은 저장 머리줄 → (40 행 초과) 3 페이지에서 값 행 불러오기 → 시트를 연 채 ⌘/Ctrl+S → 다시 받은 뒤에도 3 페이지(새 행만큼 한 칸 밀림), (100 행 초과) 6 페이지에서도 같은 확인(블록을 다시 이어 받음), 끝에 `POST /__mock/reset`. 트레이 출처 문구는 실행 locale 의 `src/messages/<locale>.json` 에서 읽어 맞춥니다 | `--history 1` 이상(기본 7 행). 번호 페이지는 `pnpm mock:gen -- --history 60`(64 행), 다음 블록은 `pnpm mock:gen -- --history 120 --no-check`(124 행) |
| `highlights-retry`  | 긴 문서 10 쪽이 속한 하이라이트 묶음(파일 로컬 20 쪽 단위, 기본 데이터는 `pages=41-60`) 첫 응답을 500 으로 바꿔 실패 문구·"다시 시도" → 한 번만 다시 요청해 복구 | 긴 문서(`index.json` `longDocumentIndex`)가 있는 Job(기본 데이터. `--no-split` 이나 작은 `--pages` 는 SKIP) |
| `parse`             | 입력 파일이 둘 이상인 Job 에서 둘째 이후 파일마다 그 파일에서 시작하는 문서를 Parse 탭으로 열어, 목록 항목을 누르면 뷰어가 같은 id(`parse:{file_ref}:p{파일 로컬 쪽}-{요소 id}`)의 영역을 고르고, 같은 쪽의 다른 뷰어 영역을 누르면 목록이 그 항목을 고르고 보이게 스크롤. 첫 문서에서는 표 요소가 표로 보이고(mock 표 `html` 에 심은 `<script>`·`onclick`·`javascript:` 링크·`onerror` 그림이 DOM 에 없고 `window.__parseTableXss` 가 비어 있음, `td[colspan]` 있음), 전환 버튼으로 원문 글자 ↔ 표가 바뀌며, 표 영역을 누르면 그 행이 선택되는지 | `pnpm mock:gen -- --files 3`(파일이 하나면 SKIP) |
| `small-job`         | 20 쪽 이하 Job 에서 필름스트립 전체 띠(`-scroller` 없음), 비가상 목록, 값 탭 짧은 문서는 뷰어 툴바에 그 문서 쪽수가 뜬 뒤에도 위치 바 없음 | `pnpm mock:gen -- --pages 12`     |
| `header-actions-one-row` | 머리 줄이 세 칸 격자가 되는 가장 좁은 폭(1280)에서 탭이 가장 많은 문서: 저장, 검수 완료 버튼이 한 줄이고 첫 Step 탭과 같은 줄(±12px), 끝나면 뷰포트 복원 | 모두 |
| `review-status`     | Collection 상세: 기본 보기에서 진행 현황 기준 문구(`collection-detail-progress-basis`)·전체 Job 카드와 최신 설정 Job 카드의 정보 버튼·"표에 보이는 행 N" 보조 줄(숫자 = 표 행 수), 검수 상태 필터를 걸면 보조 줄이 사라지고 "전체" 로 돌아오면 다시 보임, Job 행마다 검수 배지, 진행 현황·정렬 select, 검수 상태 필터 "검수 완료" → 행 수 = 검수 완료 배지 수, "전체" 로 복귀 | `pnpm mock:gen -- --jobs 3 --pages 12` |
| `queue`             | 모든 Job 을 검수 중으로 맞춘 뒤 "차례로 검수하기" → 표 첫 행 Job, 큐 바(남은 2, 이전 `aria-disabled`), 큐 바와 완료 안내가 상단 바 자리(`app-header-slot`) 안에 있고 Job 화면 머리 안에는 없음(새로 고침 첫 프레임부터), "완료 후 다음 Job"(`data-advance`) → 둘째(배지 `done` → 완료 안내 → 주소 순서, 안내가 둘째 Job 에서도 남았다 6 초 뒤 사라짐), 이전 → 첫 Job 검수 완료(되돌리기 버튼) → 다음, 둘째 Job 에서 값을 고친 채 "다음 Job" → 이탈 확인 Dialog → "머무르기" 면 같은 Job·변경 1 그대로 → 다시 "다음 Job" → "나가기" 면 셋째 → 이전으로 둘째, 둘째 Job 에서 값을 고친 채 ⌘/Ctrl+Enter("저장하고 다음", `data-save-first`) → 셋째, 마지막 Job 에서 다음 `aria-disabled`, 남은 0 → 검수 완료 → "새 Job 확인" 안내 → 되돌리기, 상세 배지 완료 2, 검수 중 1, 진행 막대 `aria-valuenow` 2 / `aria-valuemax` 3, 필터 2 행, 끝에 `POST /__mock/reset` | `pnpm mock:gen -- --jobs 3 --pages 12`(Job 이 정확히 3 개 — 기대값이 3 기준이라 그 밖의 수는 SKIP) |
| `shell`             | 앱 껍데기: Job 을 불러오면 `review-recent-jobs` 에 그 Job(이름 = 첫 파일명)이 남고 홈 대시보드 최근 목록에 보임, 변경이 없으면 상단 바 홈 링크·돌아가기 링크가 묻지 않고(브라우저 창·이탈 확인 Dialog 모두 없음) 옮김, Collection 상세 머리와 진행 카드 수, 전체 JSON "직접 편집…" 시트의 기준 줄이 열 때 현재 편집본(`data-basis=edited`, 직접 고침 아님) → "원본 불러오기" 뒤 원본, 변경이 있으면 홈 링크·설정 메뉴 언어 바꾸기·돌아가기 링크가 이탈 확인 Dialog(`leave-confirm-dialog`, 첫 포커스 "머무르기", 브라우저 창 없음)를 띄우고 "머무르기" 면 주소·변경이 그대로이며 `body` 를 다시 누를 수 있고 설정 메뉴가 다시 열림, 돌아가기 링크에서 "나가기" 면 Collection 상세로 옮김, 설정 메뉴의 JSON 메뉴·Parse 단계 토글이 새로 고침 없이 바로 반영되고 `review-features`·`review-steps` 가 기대한 JSON, 큐 안의 Job 에서 "완료하면 다음 Job 열기" 를 끄면 주 동작이 바로 바뀌고(`data-advance`) `review-queue-advance` 가 `"0"` | 모두(마지막 확인은 `--jobs 3 --pages 12`, 아니면 그 확인만 SKIP) |
| `collections-list`  | Collection 목록 출처 필터에서 두 출처를 고름(첫 항목을 골라도 메뉴가 열려 있음) → 주소 `source=agent_export,agent_link`·필터 버튼 `data-active=true`, 고르기 전후 표 머리 칸 폭이 같음(±1px), "전체" 로 비우면 주소에서 `source` 가 빠짐 | 모두 |
| `lineage`           | 설정 메뉴로 언어를 바꿔도 목록 주소 `?order=asc` 유지, Collection 목록의 "관계" 토글 → 주소 `view=lineage`, 카드 10 개·연결 8 개, 스키마 없는 기본 Collection 과 세대를 교체한 결과 가져오기 연결, 기본 Collection 사본과 연결 없는 Collection 숨김, 목록에 자동 기본 Collection 이 없음, 원본이 왼쪽, 건너뛰는 연결이 사이 카드를 피함, hover 강조, 키보드 포커스 강조(볼 수 없는 Collection 카드, 같은 카드 안 이동), 새로 고침·상세에서 뒤로 가도 관계 보기 유지, 목록으로 돌아가기 | 모두 |
| `ui-kit-demo`       | UI Kit 데모 화면(`/{locale}/ui-kit-demo`): item 섹션이 하나씩 그려짐, 읽기 전용 Filmstrip·PageGrid 에 끌기·✂·라벨 편집·메뉴 열기가 없고 격자 메뉴 버튼은 모두 비활성, 편집 Filmstrip 의 ✂ 로 나눈 문서가 읽기 전용 view 에도 보임, 문서 위치 대화 상자로 옮기면 순서가 바뀌고 메뉴 버튼으로 포커스 복귀, 판정 칸을 누르면 값이 바뀌고 근거가 사라짐, 규칙 카드 5 개(모르는 연산자 원문), 페이지 옮기기 제출 → 요청 JSON·실패 응답이면 문구를 보이고 닫히지 않음, Parse 표는 `table` 하나에 `script`·`iframe`·`img`·인라인 핸들러 0 이고 누르면 횟수 1, Instruct 칩 3 개 중 첫 칩 선택·Provider 밖은 칩·`†` 표식 0, `InstructStructured` 문자열에도 칩, 저장·완료 버튼 줄의 저장 → 변경 배지가 사라지고 저장 문구·저장 비활성, "충돌" 이면 오류 문구, 문서 라벨 select 변경·입력 Enter 확정(앞뒤 공백 제거), 배열 표의 오류·경고·＋·바뀐 칸 각 1, 칸 Enter → 값 줄과 다음 칸 포커스, 되돌리기 | 모두. 앱을 `REVIEW_UI_KIT_DEMO=1` 로 띄웠을 때만(아니면 SKIP) |

데이터를 바꿀 때는 `pnpm mock:gen -- <옵션>` 뒤 `pnpm mock:serve`(데이터를 시작할 때 읽음)와 `pnpm mock:start`(BFF 캐시)를 다시 띄웁니다. 윈도잉 경로는 `--pages 660`(문서 ≈ 125 개)처럼 문서가 100 개를 넘는 데이터에서 확인합니다. 화면은 testid·data 속성으로만 찾으므로(문구는 locale 마다 다르다 — 예외는 `organizer` 의 트레이 변경 종류 문구 2 곳(일괄 제외·나누기)으로, en/ko/ja 문구를 모두 받는 정규식이라 `src/messages/*.json` 의 그 문구를 바꾸면 함께 고칩니다) testid 를 바꾸면 `mock/lib/smoke-scenarios.mjs` 도 함께 고칩니다. `viewer`·`position-bar` 는 앱 마크 `review:select-page` 도 읽으므로 마크 이름을 바꾸면 스모크도 함께 고치고, 연속 스크롤 뷰어 item 의 스크롤 요소 testid(`job-review-viewer-scroll`)가 바뀌어 래퍼의 스크롤 상태 재동기화가 꺼지면 두 시나리오의 빠른 연속 이동 확인이 FAIL 합니다. 코드 위치: 실행기 `mock/smoke.mjs`, 시나리오 `mock/lib/smoke-scenarios.mjs`.

#### DOM 캡처 (`pnpm mock:dom`)

화면 코드를 고치기 전후에 실제 브라우저 DOM 이 같은지 보는 도구입니다. 스모크와 같은 mock 모드·저장소 초기값으로 Job 화면을 열어 화면 상태마다 지정한 루트 요소의 `outerHTML` 을 `<상태>--<루트>.html` 로 씁니다. jsdom 렌더 테스트(`*.test.tsx`)가 흉내만 내는 레이아웃·가상화 창·Radix 포털 결과를 덮습니다.

| 화면 상태   | 여는 화면                                          | 루트                                                                     |
| ----------- | -------------------------------------------------- | ------------------------------------------------------------------------ |
| `values`    | 값 탭, 긴 문서(`index.json` `longDocumentIndex`) 1 쪽 | 문서 목록 칼럼(필터 바·요약·안내·목록을 감싼 섹션), `job-review-position-bar`, 값 패널(`[data-value-panel]`) |
| `filmstrip` | 구성 탭, 긴 문서 1 쪽(필름스트립 이웃 보기)         | 문서 목록 칼럼, `job-review-filmstrip`                                    |
| `organizer` | 위 화면에서 페이지 정리를 연 상태                   | `job-review-organizer`                                                   |

```bash
pnpm mock:dom -- --base http://localhost:3100 --out /tmp/dom-before   # 바꾸기 전
pnpm mock:dom -- --base http://localhost:3100 --out /tmp/dom-after    # 바꾼 뒤(같은 데이터·빌드 조건)
diff -r /tmp/dom-before /tmp/dom-after                                # 비어 있어야 같다
```

옵션: `--out <dir>`(필수) · `--base http://localhost:3000` · `--locale ko` · `--index mock/.generated/index.json` · `--only values,filmstrip,organizer` · `--headed` · `--timeout 60000`. 루트 HTML 이 600 ms 동안 바뀌지 않을 때 읽고, 실행마다 달라지는 값(React `useId`·Radix 가 만든 id 와 그것을 가리키는 `aria-*`·`for`, blob URL)은 나온 순서대로 번호를 붙인 자리 표시로 바꾸며, 태그 사이에 줄바꿈을 넣어 diff 를 줄 단위로 읽게 합니다. 긴 문서가 있는 20 쪽 넘는 Job 데이터(기본 데이터)가 필요합니다. 데이터·빌드가 같으면 두 번 뜬 결과의 diff 가 0 입니다. 코드 위치: `mock/dom-snapshot.mjs`(화면 이동은 `mock/lib/smoke-scenarios.mjs` 의 helper 를 씁니다).

#### 성능 측정 (`pnpm mock:measure`)

mock 모드로 띄운 Job 화면을 headless Chromium(Playwright, devDependency `playwright`)으로 열어 시간·네트워크 바이트·JS heap·DOM 수를 재고 `mock/results/{label}-{YYYYMMDD-HHmmss}.json` + `.md`(stdout 에도 출력)로 남깁니다. CI 에서는 돌지 않고 `src/` 는 Playwright 를 import 하지 않습니다. Chromium 이 없으면 `pnpm exec playwright install chromium` 을 한 번 실행합니다.

```bash
pnpm mock:gen && pnpm mock:serve                       # 터미널 A
pnpm build && pnpm mock:start                          # 터미널 B (측정은 반드시 프로덕션 빌드로 — pnpm dev 는 HMR 새로 고침으로 수치가 흔들린다)
pnpm mock:measure -- --label before --runs 5           # 터미널 C: run 마다 파일 + 중앙값 파일(-median). 먼저 브라우저로 Job 화면을 한 번 열어 서버를 데운다
pnpm mock:measure -- --label before-gc --gc            # 샘플 전 GC 를 강제한 heap 세트
node mock/measure.mjs compare mock/results/before-….json mock/results/after-….json   # 두 결과 차이(증가는 +)
```

옵션(`pnpm mock:measure -- <옵션>`): `--label <name>`(필수) · `--base http://localhost:3000`(포트를 바꿨으면 `--base http://localhost:3100`) · `--locale ko` · `--index mock/.generated/index.json` · `--doc 30`(select-doc 단계의 문서 번호) · `--scroll 40`(긴 문서에서 넘기는 쪽 수) · `--jump 55`(툴바로 점프하는 쪽) · `--values-doc 30`(hover-highlight·select-highlight 단계에서 값 탭에 여는 문서 번호) · `--organizer-screens 8`(페이지 정리 화면 격자 창을 창 높이씩 내리는 횟수) · `--runs 1` · `--headed` · `--gc` · `--timeout 120000`(run 하나의 대기 상한, 넘으면 `partial: true` 로 저장).

지표:

- **타이밍(ms, 페이지 열기 기준)**: `ttfb`·`domContentLoaded`(navigation entry) · `loaded`(검수 문서를 읽어 화면 상태를 만든 시점, 앱 마크) · `documentList`(문서 목록에 처음 항목이 생긴 시점, 앱 마크 — 앱 마크가 없는 빌드는 하네스 폴링 값이고 `documentListSource` 가 `mark`/`poll` 을 알린다) · `firstPageImage`(첫 페이지 이미지 표시) · `filesDone`(마지막 `/api/files/` 응답, 그 뒤 1.5 초 새 요청 없음). 앱 마크 값은 navigation 기준(`ttfb` 와 같은 시계)이라 하네스 폴링 지연(최대 100 ms)이 없습니다.
- **앱 마크**: 앱은 User Timing 마크(`src/components/job-review/perf-marks.ts`) — `review:loaded`·`review:document-list-ready`·`review:select-page`(`detail: {page, source}`, 페이지 선택 직전)·`review:page-image-painted`(`detail: {page}`, 뷰어 페이지 이미지 로드 다음 프레임)·`review:highlight-input`(`detail: {kind}`, 값 패널에서 하이라이트를 가리키거나(`hover`) 고르기(`select`) 직전)·`review:highlight-committed`(가리킨·고른 하이라이트가 바뀐 렌더의 커밋 끝, provider 의 layout effect) — 를 남기고 읽지는 않습니다. 하이라이트 마크 둘은 가리킬 때마다 쌓이므로 하네스가 페이지를 열기 전에 `window.__reviewHighlightMarks = true` 를 둔 경우에만 남깁니다(평소 화면에서는 남기지 않음). 하네스는 점프 단계에서 마크를 지운 뒤 "대상 쪽 선택 → 그 쪽 이미지가 그려짐" 구간을, 하이라이트 단계에서는 행마다 "입력 → 커밋" 구간을 샘플의 `appMs` 로 적습니다(마크를 못 찾으면 `null`, 표에서는 `—`).
- **네트워크**: 요청을 `reviewDocument`·`files`(`/api/files/{id}`)·`fileHighlights`·`response`(Job 응답)·`figures`·`images`(페이지 이미지)·`other` 로 나눠 요청 수·전송 바이트(`request.sizes()`, gzip 뒤 크기)·디코드 바이트(JSON 응답만, 압축 전 크기)·실패 수.
- **샘플 16 개** — 기본 화면 8 개(`after-load` → `structure-tab`(구성 탭) → `select-doc`(문서 n 번) → `long-doc-scroll`(60 쪽 문서를 40 쪽 넘김 — 한 장씩 모드는 다음 버튼, 연속 모드는 스크롤) → `jump-page`(툴바 입력으로 55 쪽, `appMs`) → `parse-tab` → `values-tab`(Extract 값 탭, 위치 바) → `jump-page-values`(값 탭에서 41 쪽으로 옮긴 뒤 같은 55 쪽 점프, `appMs`)) 뒤에 하이라이트 2 개(`hover-highlight`(값 탭에서 `--values-doc` 문서를 열고 값 행 10 개를 차례로 가리킴 — 배열 표는 행마다 첫 칸, 그 뒤 일반 필드 행. 행마다 마우스를 상단 바로 뺐다가 다시 올린다) → `select-highlight`(같은 행의 글자 입력에 차례로 포커스 — 행의 선택 경로). `appMs` 는 행 10 개 "입력 마크 → 커밋 마크" 의 중앙값이고 notes 에 행별 값(`spans`)·`maxMs`·하이라이트가 없어 건너뛴 행 수·배열 표 행 수(`tableRows`)), 그 뒤 페이지 정리 화면 6 개(`organizer-tab`(구성 탭으로 돌아감) → `organizer-open`(페이지 정리 열기 — 격자가 보이는 행을 그릴 때까지) → `organizer-scroll`(격자 창을 창 높이씩 `--organizer-screens` 번 + 끝까지, 각 50 ms 대기; notes 에 페이지 이미지 요청 증가분(시작·완료)·끝 `scrollTop`·그려진 셀 수) → `organizer-size-m`(셀 크기 M) → `organizer-click`(창을 끝까지 내린 뒤 지금 선택된 문서가 아닌 보이는 첫 셀 클릭 → 뷰어가 그 쪽을 그릴 때까지, `appMs`) → `organizer-close`(닫기)): 단계 소요 ms, CDP `Performance.getMetrics` 의 `JSHeapUsedSize`·`JSHeapTotalSize`·`Nodes`·`Documents`·`LayoutCount`·`RecalcStyleCount`, DOM 수(필름스트립 썸네일·문서 목록 행·정리 화면 셀(`cells`)·`img`). 단계는 `/api/` 요청이 비고 두 프레임이 지난 뒤 잽니다.
- `console`: error·warning·pageerror 수(첫 다섯 개 문구 포함). `viewerMode`: `paged`(한 장씩) 또는 `continuous` 를 DOM 으로 자동 판별.

주의:

- 단일 run 은 수백 ms·수십 MB 흔들리므로 비교는 `--runs 3` 이상(권장 5)의 중앙값으로 하고, heap 은 GC 타이밍에 좌우되므로 `--gc` 세트를 따로 둡니다. `--gc` 없이 잰 `Nodes` 에는 아직 수거되지 않은 분리(detached) DOM 노드가 섞이므로 DOM 크기 비교도 `--gc` 세트로 합니다.
- 측정 전에 Job 화면을 브라우저로 한 번 열어 서버를 데웁니다 — fresh `next start` 의 첫 run 은 라우트 모듈 로드 때문에 `documentList` 가 수백 ms 높고, 그 뒤에도 run 사이에 두 모드(수백 ms 차이)로 흔들립니다.
- `jump-page` 와 `jump-page-values` 는 같은 문서·같은 출발·도착 쪽의 점프라, `appMs` 차이가 구성 탭에만 있는 필름스트립·구조 툴바의 몫입니다. `stepMs` 는 하네스 대기(입력값 폴링·이미지 폴링 100 ms 간격·`/api/` idle·두 프레임)를 포함하므로 앱 쪽 개선은 `appMs` 로 봅니다. `appMs` 는 화면 프레임 단위로 끊겨(선택 뒤 몇 번째 프레임에 그림이 그려졌는가) run 마다 한두 프레임씩 흔들리니, 한 run 이 아니라 중앙값으로 비교합니다.
- `long-doc-scroll` 의 시간은 한 장씩 모드(다음 버튼 40 회 + 이미지 대기)와 연속 모드(하네스가 한 화면씩 스크롤 + 고정 대기)에서 뜻이 달라, 뷰어 모드가 다른 결과끼리는 LayoutCount·Nodes·heap·바이트로 비교합니다.
- 하이라이트 2 단계의 기준은 `hover-highlight` `appMs` 16 ms(한 프레임) 이하입니다. 커밋까지(렌더·커밋)만 재고 그 뒤 스타일·레이아웃·페인트는 포함하지 않습니다. 배열 50 행 기준은 `pnpm mock:gen -- --items-max 60` 데이터의 30 번 문서(items 50 행 — 표가 첫 묶음 50 행을 그림)입니다. 하이라이트가 없는 행은 커밋이 없어 건너뛰고 다음 후보를 씁니다.
- 하네스는 화면을 스모크와 같이 맞춥니다(`localStorage` 의 `review-steps` 에 Parse·Instruct 켬, `review-features` 에 페이지 도구·정리 화면·JSON 메뉴 켬, 스모크는 변경 이력도 켬) — 기본에서 빠지는 Parse 탭·정리 화면이 꺼져 있으면 `parse-tab`·`organizer-*` 를 잴 수 없습니다.
- 정리 화면 6 단계는 기본 화면 8 샘플과 하이라이트 2 샘플 뒤에 같은 브라우저 컨텍스트에서 이어 재므로 heap·Nodes 가 누적값입니다 — 정리 화면 몫은 `organizer-open` 대비 차(예: `organizer-scroll − organizer-open`)로 보고, 윈도잉은 `cells`·`img` 가 전체 쪽수보다 훨씬 작은지로 봅니다. `organizer-click` 의 `appMs` 는 `jump-page` 와 같은 뜻(선택 → 그 쪽 이미지가 그려짐)이지만 문서까지 바뀌는 클릭이라 문서 목록·뷰어 다시 그리기를 포함합니다. 페이지 정리 토글이 없는 빌드에서는 6 단계를 `skipped` 로만 적고 `partial` 로 치지 않습니다.
- 뒤에 추가되는 UI 의 testid(`job-review-viewer-progress` 등)는 있으면 `present`, 없으면 `skipped` 로만 기록합니다(`job-review-viewer-progress` 는 파일 요청이 끝난 뒤 재므로 늘 `skipped`, `job-review-draft-banner` 는 새 브라우저 컨텍스트라 `skipped` 가 정상).

코드 위치: 하네스 `mock/measure.mjs`, 표·비교·중앙값(순수 함수) `mock/lib/measure-report.mjs`, 그 테스트 `src/test/__tests__/measure-report.test.ts`.

### GitHub Pages 데모 (서버 없이 mock 모드)

mock 모드와 UI Kit 데모 화면을 서버·DB 없이 정적 호스팅(GitHub Pages)에 올리는 빌드입니다. `main` 에 push 하면 `.github/workflows/pages.yml` 이 빌드해 배포합니다(저장소 Settings → Pages 의 Source 가 "GitHub Actions" 여야 합니다).

```bash
PAGES_BASE_PATH=/studio-review-web-app-public pnpm pages:build     # out/ 에 정적 사이트
PAGES_BASE_PATH=/studio-review-web-app-public pnpm pages:preview   # http://localhost:4173/studio-review-web-app-public/
```

- **구조**: `next build` 를 정적 export(`output: "export"`)로 돌리고, 서버가 하던 일은 서비스 워커 하나(`out/mock-sw.js`)가 브라우저 안에서 합니다. 워커는 BFF Route Handler(`src/app/api/**/route.ts`)를 고치지 않고 그대로 번들하고, 그 upstream 호출을 `pnpm mock:serve` 와 같은 mock upstream 본체(`mock/lib/upstream.mjs`)로 보냅니다. 화면이 부르는 `/api/...` 와 그 응답은 서버가 있을 때와 같고, 네트워크로 나가는 API 요청은 없습니다.
- **데이터**: 데이터셋은 워커가 뜰 때마다 같은 seed 로 만듭니다(`pages-demo/config.mjs` 의 `DEMO_DATASET_OPTIONS`, 기본 200 쪽 Job 3 개). 저장한 검수 내용과 검수 상태(앱 DB 의 `job_review_status` 자리)는 **그 브라우저의 IndexedDB** 에만 남고 방문자끼리 공유되지 않습니다. 처음으로 되돌리려면 브라우저에서 이 사이트의 데이터를 지웁니다.
- **평소 빌드와 다른 점**: `NEXT_PUBLIC_PAGES_DEMO=1` 일 때만 켜집니다(`next.config.ts`, `src/lib/pages-demo.ts`). `pageExtensions` 를 `tsx` 로 좁혀 `route.ts`·`proxy.ts` 를 빌드에서 빼고, Collection·Job 화면은 mock 데이터셋의 id 로 미리 만들며(`generateStaticParams`), locale 없는 주소는 `out/index.html` 이 브라우저 언어를 보고 보냅니다. UI Kit 데모 화면의 `REVIEW_UI_KIT_DEMO` 는 빌드 때 값으로 굳습니다(기본 `1`, 빼려면 `REVIEW_UI_KIT_DEMO=0 pnpm pages:build`). 응답 보안 헤더(`headers()`)는 정적 호스팅에서 붙지 않습니다.
- **첫 화면**: 워커가 페이지를 맡을 때까지 `MockGate`(`src/components/pages-demo/mock-gate.tsx`)가 화면을 그리지 않습니다. 서비스 워커를 쓸 수 없는 창(일부 사생활 보호 모드)에서는 안내 문구만 보입니다.
- 코드 위치: 빌드 `pages-demo/build.mjs`, 미리보기 서버 `pages-demo/preview.mjs`, 워커 `pages-demo/sw/`(`entry.mjs` 라우팅, `prisma-shim.mjs` 검수 상태 표, `store.mjs` IndexedDB, `png-browser.mjs` 그림 생성, `prelude.mjs` 환경 변수), 미리 만들 경로 `pages-demo/static-params.mjs`.

## 코드 읽는 순서

이 앱은 파트너가 자기 검수 화면을 만들 때 가져갈 **예시 본문**과, 그 예시를 띄우기 위한 **앱 껍데기**, 데모를 풍성하게 하는 **부가 기능**으로 나뉩니다. 처음 읽을 때는 1 층부터, 각 층의 진입 파일부터 봅니다. 경로는 `src/` 기준입니다.

| 층 | 무엇 | 폴더 | 진입 파일 | 파트너가 가져갈 것 / 이 앱 전용 |
| --- | --- | --- | --- | --- |
| 1 예시 본문 | Job 검수 화면, 검수 JSON 편집 모델, 검수 API 클라이언트, 화면 정책 | `components/job-review/`, `lib/review-model/`, `lib/review-api/`(`activity.ts` 제외), `lib/review-policy/`, `lib/revision-history/` | `components/job-review/job-review-screen.tsx`(`JobReviewScreen`), `lib/review-api/review-screen.ts`(화면이 부르는 BFF 연산), `lib/review-model/index.ts` | 가져갈 것. BFF 만 자기 것으로 바꾸면 되도록 화면의 서버 호출은 `review-screen.ts` 한 곳으로 모았습니다([BFF HTTP 계약](#bff-http-계약검수-화면이-기대는-것) 절) |
| 2 앱 껍데기 | Collection 목록·상세, Job 행, 검수 상태 저장, 이탈 확인 store, 공통 머리 | `components/collections/`, `components/{app-header,leave-guard-store,leave-guard-link,page-container,studio-table}`, `lib/review-status.ts`, `lib/links.ts` | `components/collections/collections-list-view.tsx`, `components/collections/collection-detail-view.tsx` | 이 앱 전용. 파트너는 자기 목록·라우팅에서 `JobReviewScreen` 을 엽니다. 검수 상태(검수 전·중·완료)는 이 앱 DB 의 기능입니다 |
| 3 데모 부가 기능 | 홈 대시보드, Collection 관계 보기, 검수 현황 집계, 검수 큐, 설정 메뉴, 헤더 포털 | `components/showcase/`, `lib/{recent-jobs,review-status-aggregate}.ts`, `lib/review-api/activity.ts`, `lib/upstage/lineage.ts` | `components/showcase/review-queue/job-review-with-queue.tsx`, `components/showcase/settings-menu.tsx`, `components/showcase/home/home-dashboard.tsx` | 이 앱 전용. 없어도 검수 화면은 그대로 동작합니다 |

- 1 층 모델·API 의 진입점: 저장 직전 판정은 `lib/review-model/save-plan.ts` 의 `planSave`(편집 항목 0 → 검증 차단 → 본문 없음 → 크기 한도 → 업로드 본문 검증 순서, 값 결과 id 는 `changedValueResultIds`), 검수 문서 text 를 Job 하나로 여는 것은 `lib/review-model/open-job-review.ts` 의 `openJobReview`(화면 첫 열기와 저장 뒤 다시 불러오기가 함께 씀), BFF 오류에서 코드·상태·`Retry-After` 를 읽는 것은 `lib/review-api/error-info.ts` 의 `apiErrorInfo`(facade 도 내보냄), 요청 취소 판별은 층 밖 `lib/abort.ts` 의 `isAbortError` 입니다. `lib/review-api/client.ts` 의 fetch 는 비공개 `send()` 하나를 거칩니다.
- 1 층 검수 화면의 저장 버튼 활성 재료는 `components/job-review/save-readiness.ts` 의 `saveReadiness`(변경 있음·저장 중·충돌·차단 문제 부품, 머리 저장은 차단 문제를 보지 않고 트레이 저장은 봄)입니다. 머리의 저장·완료 버튼 줄(`job-review-header.tsx`), 구조 패널·새 문서 대화 상자의 라벨 칸(`structure-panel.tsx`·`new-document-dialog.tsx`), 배열 값 표(`array-table.tsx`)는 Studio UI Kit item(`review-actions`·`document-label-field`·`array-table`)을 그리는 host 래퍼이고, 단축키·완료 연쇄·값 트리 읽기는 host 에 남습니다.
- 층 밖 공용 유틸: `lib/{browser-storage,format,relative-time,resource-id,utils,leave-confirm,use-resource,abort}.ts` — 어느 층에서든 씁니다. `components/ui/`(shadcn)·`components/studio-ui-kit/`(Registry item)도 층 밖입니다.
- 서버 쪽: BFF Route Handler(`app/api/**`)와 Upstage 서버 클라이언트(`lib/upstage/`)는 브라우저 코드가 import 하지 않습니다. 1 층은 같은 origin 의 `/api/...` 만 부릅니다.

**의존 방향**: 3 층은 1·2 층을 import 할 수 있고, 1·2 층은 3 층을 import 하지 않습니다. 1 층과 2 층 사이는 번호 순서와 달리 2 → 1 이 금지이고, 1 → 2 는 `collections/` 의 `links`·`review-status-badge`·`list-state`·`cursor-pagination`·`cursor-block` 과 `leave-guard-store` 만 허용합니다. 2 → 3 예외는 `collections-list-view.tsx`(lineage 보기·현황 카드)와 `collection-detail-view.tsx`(진행 카드·검수 큐 시작)에 이미 있는 import 뿐입니다. `pnpm lint` 가 `eslint.config.mjs` 의 `import/no-restricted-paths`(`layerZones`)로 검사하며, 검수 화면(`components/job-review/`)이 `lib/review-api/client.ts` 를 직접 import 하는 것도 막습니다(`use-review-status.ts` 만 예외 — 검수 상태는 2 층 기능).

**composition root**: 층을 조립하는 곳은 `app/**` 의 page·layout 과 `components/app-header.tsx` 입니다. 여기서는 3 층을 import 해도 됩니다. 예를 들어 Job 페이지(`app/[locale]/collections/[collectionId]/jobs/[jobId]/page.tsx`)는 `JobReviewScreen` 대신 3 층 래퍼 `JobReviewWithQueue` 를 그리고, `app/[locale]/layout.tsx` 가 `HeaderSlotProvider` 를, `app-header.tsx` 가 `HeaderSlotTarget`·`SettingsMenu` 를 둡니다.

**머리 확장 `useHeaderExtension`**: 3 층이 1 층 검수 화면에 꽂는 유일한 자리입니다. `JobReviewScreen` 의 선택 prop `useHeaderExtension` 은 hook 하나이고(`components/job-review/header-extension.ts` 의 `UseJobReviewHeaderExtension`), 머리가 렌더마다 `{ collectionId, collectionName, jobId, firstFileName, ready, dirty, leaveMessage }` 를 넘기면 `{ extras, advancesAfterComplete, onCompleted }` 를 돌려받습니다 — `extras` 는 머리 맨 앞에 그릴 것, `advancesAfterComplete` 가 true 면 주 동작 문구가 "완료하고 다음"·"저장하고 다음" 이 되고, `onCompleted(jobName)` 는 검수 완료 직후에 불립니다. 넘기지 않으면 `useNoHeaderExtension`(아무것도 하지 않음)입니다. 이 앱의 구현은 `components/showcase/review-queue/use-queue-header-extension.tsx`(검수 큐 바를 헤더 포털로, 최근 연 Job 기록, 완료 안내, 다음 Job 이동)입니다. hook 이므로 마운트된 동안 같은 함수를 넘깁니다(모듈 수준 함수).

**화면 정책 `ReviewPolicy`**: 설정 메뉴에서 켜고 끄는 부가 기능(`pageTools`·`filmstrip`·`organizer`·`jsonMenu`·`history`)과 보일 Step 종류는 `lib/review-policy/`(`review-features.ts`·`review-steps.ts`)의 store(브라우저 저장소 + 구독)가 원천입니다. 검수 화면은 store 를 직접 읽지 않고 `ReviewPolicyProvider`(`components/job-review/review-policy.tsx`, `JobReviewScreen` 가장 바깥)가 내려 주는 값을 `useReviewPolicy()`(`review-policy-context.ts`)로 읽습니다. 그래서 정책을 다르게 주고 싶으면 이 Provider 한 곳만 바꾸면 됩니다. 설정 메뉴(3 층)는 store 훅을 직접 쓰고, 같은 store 라 바꾸면 화면에 곧바로 반영됩니다.

### 번역 네임스페이스와 층

메시지 파일(`src/messages/{ko,en,ja}.json`)의 최상위 네임스페이스는 층과 대략 이렇게 대응합니다.

| 네임스페이스 | 층 | 예외·비고 |
| --- | --- | --- |
| `review.*` | 1 | `review.queue` 는 3 층 검수 큐 바(`review-queue-bar.tsx`), `review.header.completedNotice` 는 3 층 머리 확장이 씁니다. `review.header.completeAndNext`·`saveAndNext` 는 1 층 머리의 문구지만 머리 확장이 `advancesAfterComplete` 를 켤 때(검수 큐가 있을 때)만 보입니다 |
| `collections.*` | 2 | `collections.lineage`·`overview`·`reviewCell`·`progress` 는 3 층 컴포넌트가 씁니다. `collections.startReview` 는 2 층 상세 화면에 있지만 3 층 검수 큐를 시작하는 버튼입니다 |
| `jobRow.*` | 2 | `jobRow.reviewStatus` 는 2 층 검수 상태 배지(`review-status-badge.tsx`)이고 1 층 머리도 이 배지를 씁니다 |
| `home`·`settings` | 3 | 홈 대시보드·설정 메뉴 |
| `appHeader`·`metadata`·`notFound` | 껍데기 | 공통 머리·페이지 메타·404 |

네임스페이스 이름은 층과 정확히 맞지 않습니다. 키 경로를 바꾸면 한 locale 이라도 빠졌을 때 화면에 키 경로가 그대로 보이므로, 이름은 그대로 두고 위 표로 대응을 안내합니다.

## 브라우저 저장소

화면 설정과 작업 상태를 브라우저 저장소에 둡니다. 서버에는 보내지 않습니다. 키·형식을 바꾸면 사용자가 이미 둔 값을 잃으므로 아래 표가 계약입니다. 읽기·쓰기는 `lib/browser-storage.ts`(`localStore`·`sessionStore`·`readStorageItem`·`writeStorageItem`)를 거치고, 저장소가 막혀 있어도 던지지 않고 기본값을 씁니다.

| 키 | 영역 | 형식 | 알림 | 정의 | `createStoredValue` |
| --- | --- | --- | --- | --- | --- |
| `review-features` | local | JSON `{pageTools, filmstrip, organizer, jsonMenu, history}` boolean, 아는 키만 읽음 | 탭 + `storage` | `lib/review-policy/review-features.ts` | 씀 |
| `review-steps` | local | JSON Step 종류 9 개 boolean | 탭 + `storage` | `lib/review-policy/review-steps.ts` | 씀 |
| `review-fields` | local | JSON `{stepId: string[]}`(Step 별 보이는 필드) | 탭 + `storage` | `components/job-review/field-filter.ts`, 구독 `use-field-filter.ts` | 씀 |
| `review-recent-jobs` | local | JSON 배열(최근순, 최대 `RECENT_JOBS_MAX` = 10) | 탭 + `storage` | `lib/recent-jobs.ts`, 구독 `components/showcase/home/recent-jobs-store.ts` | 씀 |
| `review-queue-advance` | local | `"1"`·`"0"`, 없으면 켬 | 탭 + `storage` | `components/showcase/review-queue/use-review-queue.ts` | 씀 |
| `review-queue:<collectionId>` | session | JSON `{version: REVIEW_QUEUE_VERSION, …}`, 버전이 다르면 버림 | 탭만 | `components/showcase/review-queue/review-queue.ts`·`review-queue-storage.ts` | 안 씀(큐 본문 구독이 자체 listeners) |
| `review-draft:<collectionId>:<jobId>` | local | JSON `{version: DRAFT_FORMAT_VERSION, savedAt, jobId, structureVersion, resultVersions, drafts}`, 다른 버전은 버림, `DRAFT_MAX_BYTES` 2 MiB 까지 | 없음 | `components/job-review/draft-store.ts` | 안 씀 |
| `review-visited:<collectionId>:<jobId>` | local | JSON 문자열 배열(최대 `VISITED_MAX` = 2000) | 없음 | `components/job-review/visited-documents.ts` | 안 씀 |
| `review:parse-current-page` | local | `"1"`·`"0"`, 없으면 페이지 수 기준 | 없음 | `components/job-review/parse-tab-model.ts` | 안 씀 |
| `review-value-filter` | local | JSON `{changedOnly, currentPageOnly, emptyOnly}` | 없음 | `components/job-review/value-filter.ts` | 안 씀 |
| `review-value-display` | local | JSON `{description, rules}` | 없음 | `components/job-review/value-display.ts` | 안 씀 |
| `review-viewer-mode` | local | `"paged"`, 그 밖은 연속 | 없음 | `components/job-review/viewer-mode.ts` | 안 씀 |
| `review-filmstrip` | local | `"open"`·`"closed"`, 없으면 화면 기본 | 없음 | `components/job-review/filmstrip-open.ts` | 안 씀 |
| `review-organizer` | local | `"open"`·`"closed"` 로 씀, `"open"` 만 열림 | 없음 | `components/job-review/organizer-view.ts` | 안 씀 |
| `review-organizer-size` | local | `"m"`, 그 밖은 `"s"` | 없음 | `components/job-review/organizer-view.ts` | 안 씀 |
| `collections-list-search` | session | 정규화한 목록 query 문자열 | 없음 | `components/collections/list-storage.ts` | 안 씀 |
| `collections-list-hidden-columns` | local | JSON 열 id 배열, 없으면 기본, `[]` 는 모두 보임, 모르는 id 는 버림 | 없음 | `components/collections/column-visibility.ts` | 안 씀 |

- 알림: "탭 + `storage`" 는 같은 탭의 다른 구독자에게 바로 알리고 다른 탭의 변경은 `storage` 이벤트로 받습니다. "탭만" 은 같은 탭 구독자에게만, "없음" 은 화면을 열 때 한 번 읽습니다.
- 저장소 밖 상태: 언어는 `NEXT_LOCALE` 쿠키, 완료 안내(`showcase/review-queue/completion-notice.ts`)와 이탈 확인(`components/leave-guard-store.ts`, 열린 확인 요청은 `lib/leave-confirm.ts`)은 모듈 메모리에 둡니다.

새 키를 만들 때:

1. 키 이름은 `review-`(검수 화면) 또는 `collections-`(목록) 접두를 쓰고 상수로 export 한 뒤 이 표에 행을 더합니다. 이미 있는 키의 이름·형식은 바꾸지 않습니다(바꾸면 사용자 값이 사라집니다).
2. 여러 컴포넌트·탭이 같은 값을 보고 바로 맞춰야 하면 `createStoredValue({ key, area, parse, serialize, notify })` 로 만듭니다. `parse` 는 없는 값·깨진 값·모르는 모양에 기본값을 돌려줘야 합니다.
3. 형식이 바뀔 수 있는 JSON 은 `version` 필드를 두고 다른 버전은 버립니다(`review-draft:*`·`review-queue:*` 처럼).

## 화면

Studio `/collections` 와 같은 순서로 들어가 **Job 하나**를 문서 뷰어와 함께 확인·수정·저장합니다. 모든 경로 앞에 locale(`/ko`·`/en`·`/ja`)이 붙습니다.

모든 페이지 맨 위에는 공통 상단 바(`src/components/app-header.tsx`)가 있습니다. 왼쪽은 앱 이름(처음 화면 링크), 오른쪽 끝은 **설정 메뉴**(`src/components/showcase/settings-menu.tsx`)이고, 그 사이는 화면이 채우는 자리(`src/components/showcase/header-slot.tsx`, 포털)입니다. 검수 화면은 이 자리에 검수 큐 바(이전, 다음 Job)와 완료 안내를 그립니다. 상단 바와 모든 화면(홈, Collection 목록, 상세, 검수)은 같은 가로 틀(`src/components/page-container.ts` 의 `PAGE_CONTAINER`)을 써서 화면 폭에 맞춰 넓어지고(2560px 에서 멈춤), 좌우 여백은 화면이 클수록 조금씩 늘어납니다(16, 24, 32, 40px). 그래서 어느 화면에서든 설정 메뉴와 화면 왼쪽 끝이 같은 자리에 있습니다.

설정 메뉴에는 위에서부터 다섯 묶음(언어, 검수할 단계, 검수 큐, 페이지 편집, 고급)이 있습니다. 체크 항목은 눌러도 메뉴가 닫히지 않아 여러 개를 이어서 바꿀 수 있습니다.

- **언어**: 한국어, English, 日本語 중에서 고르면 같은 화면의 그 언어 주소로 옮깁니다(주소 query 는 그대로).
- **검수할 단계**: 검수 화면 위 단계 탭에 보일 Step 종류를 고릅니다. 모든 Job 에 똑같이 적용되는 전체 설정이라, 어느 화면에서 열든 아홉 종류(Parse, Classify, Split, Extract, Validate, Match, Merge, Instruct, Export)를 세 칸 격자로 늘 모두 나열합니다. 기본은 고칠 수 있는 단계만 켜고, 보기 전용인 Parse 와 Instruct 는 끕니다(두 항목은 마우스를 올리면 "보기 전용"). 단계를 숨겨도 탭 번호는 원래 워크플로우 순서 그대로이고, Job 에 단계가 여럿이면 하나만 남아도 탭 줄이 그대로 보입니다. 모르는 종류의 Step 은 늘 보입니다. 켜 둔 단계가 하나도 없는 Job 은 빈 화면 대신 그 Job 의 모든 단계를 보이고, 본문 위에 그렇다는 안내를 한 줄 띄웁니다(`localStorage` `review-steps`, `src/lib/review-policy/review-steps.ts`). Job 에는 켠 단계가 있지만 고른 문서에는 하나도 없으면(예: Classify 를 끄고 추출 결과가 없는 문서) 그 문서의 탭은 숨기지 않고 보입니다. 탭이 0개가 되면 화면이 다시 그려지면서 검색어, 스크롤, 포커스를 잃으므로 이를 막으려는 것입니다.
- **검수 큐**: "완료하면 다음 Job 열기"(기본 켬, `localStorage` `review-queue-advance`).
- **페이지 편집**: 페이지 편집 도구, 페이지 썸네일, 페이지 정리(페이지 썸네일만 기본 켜짐).
- **고급**: 검수 결과 JSON, 변경 이력(둘 다 기본 꺼짐).

페이지 편집과 고급의 다섯 항목은 필요할 때 켜서 쓰는 검수 화면 부가 기능입니다. 대표 화면(라벨과 값 확인)을 깔끔하게 두려고 페이지 썸네일은 기본 켜짐, 나머지 넷은 기본 꺼짐이고, 켜고 끈 값은 `localStorage` `review-features`(JSON)에 둡니다(`src/lib/review-policy/review-features.ts`). 끄면 그 기능의 버튼과 화면만 사라지고 저장한 내용에는 영향이 없습니다.

- 페이지 편집 도구: 구성 탭 툴바(문서 경계 이동, 현재 문서 위치, 여기서 나누기, 앞 문서로, 뒤 문서로, 페이지 제외, 페이지 옮기기, 그 대화상자의 새 문서 대상 포함)와 작업 패널의 이 문서 제외, 새 문서로 분리. 끄면 구성 탭 뷰어 위에는 켜 둔 보기 버튼(페이지 썸네일, 페이지 정리)만 남습니다. 작업 패널의 라벨과 페이지 범위 입력은 그대로 있습니다.
- 페이지 썸네일: 구성 탭에서 앞뒤 문서의 페이지를 띠로 보며 나눌 자리를 고릅니다(기본 켜짐. 띠는 문서가 나뉜 Job 에서 펼친 채 시작).
- 페이지 정리: 모든 문서의 페이지를 격자로 보고 여러 장을 한꺼번에 옮기거나 제외하거나 새 문서로 분리하고, 썸네일 사이 ✂ 로 문서를 나눕니다.
- 검수 결과 JSON(고급): 헤더에 JSON 메뉴를 둡니다(내려받기, 직접 편집, 파일에서 가져오기).
- 변경 이력(고급): 헤더에 "변경 이력" 버튼을, 결과 머리 메뉴(⋮)에 "이 결과의 변경 이력" 을 둡니다(이 절 아래쪽 "변경 이력" 항목).

제외한 페이지는 페이지 썸네일이나 페이지 정리에서만 되돌릴 수 있습니다. 둘 다 꺼져 있고 제외한 페이지가 있으면 문서 목록 아래에 그렇다는 안내와 "페이지 썸네일 켜기" 가 보이고, 누르면 페이지 썸네일을 켜고 펼칩니다(페이지 썸네일이 기본 켜짐이라 둘 다 끈 뒤에만 보입니다). 제외한 문서의 되돌리기(작업 패널)는 설정과 관계없이 늘 보입니다.

화면 스모크(`mock/smoke.mjs`)는 시나리오마다 기본으로 꺼져 있는 네 기능(페이지 편집 도구, 페이지 정리, 검수 결과 JSON, 변경 이력)과 Parse, Instruct 단계를 모두 켠 상태로 시작합니다. 기본 화면을 보는 `defaults` 시나리오만 아무것도 켜지 않고 시작합니다.

| 경로 | 화면 | 코드 |
| --- | --- | --- |
| `/` | 홈: 소개와 검수 흐름, 검수 기록이 있으면 대시보드([홈 대시보드](#홈-대시보드) 절) | `src/app/[locale]/page.tsx` |
| `/collections` | 문서 Collection 목록(Studio 와 같은 `listed=true`, 자동으로 만든 기본 Collection 제외) | `src/components/collections/collections-list-view.tsx` |
| `/collections/{collectionId}` | Collection 요약·검수 진행 현황 + 결과를 낸 Job 행 목록(검수 열·필터·정렬), 검색창, 차례로 검수하기 | `src/components/collections/collection-detail-view.tsx` |
| `/collections/{collectionId}/jobs/{jobId}` | Job 검수 화면 | `src/components/job-review/job-review-screen.tsx` |

- **검색**: Collection 상세의 검색창 하나로 두 가지를 합니다. 파일명은 입력 300 ms 뒤 목록 필터(`q`, 2~200 자)로 걸고, `job_…` 형식이면 목록을 거르지 않고 그 Job 이 이 Collection 에 속하는지(`source-jobs/{jobId}/files`) 확인한 뒤 검수 화면으로 바로 엽니다.
- **검수 상태**: Job 마다 검수 전 · 검수 중 · 검수 완료 셋 중 하나입니다. Collection 검수 API 에는 이 상태가 없어서 이 앱의 Postgres 에 두고([BFF 라우트](#bff-라우트) 절의 `review-status`), **로그인이 없으므로 이 서버를 쓰는 모든 사람에게 공유**됩니다(검수자 구분 없음, 나중 요청이 남음). Job 화면을 불러오면 조용히 검수 중이 되고(이미 검수 완료면 그대로), 검수 완료 Job 을 고쳐 저장이 반영되면(`applied`·`partially_applied`) 검수 중으로 돌아가며 안내합니다.
- **Collection 목록의 검수 현황**: 목록 위 카드 세 개에 이 앱 DB 전체의 검수 중인 Job, 검수 완료한 Job, 검수가 진행 중인 Collection 수가 보이고, 표의 "검수" 열(정렬 가능, 현재 페이지 안)에는 Collection 마다 "완료 n / m"(분모는 상세 진행 현황과 같은 `total_job_count − pending_job_count − failed_job_count`)과 가는 막대, "검수 중 k" 가 보입니다. 기록이 없으면 "검수 전" 입니다. 한 페이지의 Collection id 를 모아 `GET /api/review-progress?collection_ids=…`(최대 100 개, 앱 DB 만 읽음) 한 번으로 셉니다.
- **Collection 상세의 Job 표**: 열은 일곱 개입니다. 파일(파일명과 그 아래 Job ID, 입력 파일이 여럿이면 "+n" 배지, 마우스를 올리면 모든 파일명), 분량(파일 수와 페이지 수), 상태(Job 실행 상태 배지: 완료, 진행 중, 실패, 취소됨, 모르는 값은 받은 글자 그대로), 검수(검수 상태 배지), 설정(Config ID, 최신 설정이면 "최신 설정" 배지), 생성(`created_at`), 갱신(`updated_at`) 순서입니다. 목록은 완료된 Job 만 요청하지만(`status=completed`) 상태 열은 upstream 이 행마다 돌려준 값을 그대로 보입니다. 행이나 파일명 링크를 누르면 그 Job 의 검수 화면으로 갑니다. 요약 숫자는 "전체 Job"(`total_job_count`), "최신 설정으로 실행한 Job"(`latest_config_job_count`), "최신 설정 수"(`latest_config_ids` 의 개수)이고, Collection 상세 응답에 그 필드가 있을 때만 보입니다. 전체 Job 과 최신 설정으로 실행한 Job 카드는 라벨 옆 정보 아이콘에 무엇을 센 수인지 툴팁이 있습니다(전체 Job 은 이전 설정으로 실행한 Job, 같은 파일을 다시 실행한 Job, 진행 중·실패한 Job 도 포함하며, 표에서 모두 보려면 "이전 실행도 보기" 를 켜고 "최신 설정 결과만 보기" 를 끈다는 안내). 표가 기본 보기(표시 옵션 기본값, 검색어 없음, 검수 상태 "전체")이면 최신 설정 Job 카드 값 아래에 "표에 보이는 행 N" 이 함께 보입니다. 이미 받은 행만 세고(수를 얻으려 따로 요청하지 않음) 더 받을 행이 남았으면 "N+" 이며, 기본 보기가 아니면 숨깁니다. 표는 같은 파일 묶음당 최근 실행 하나와 완료된 Job 만 보이므로 이 수가 카드 숫자보다 작을 수 있습니다.
- **Job 표 표시 옵션**: "최신 설정 결과만 보기"(기본 켜짐, `latest=true`)는 최신 설정(latest Config)으로 실행한 Job 만, 끄면 모든 설정의 Job 을 보입니다. "이전 실행도 보기"(기본 꺼짐)가 꺼져 있으면 `group_by=input_files` 로 같은 입력 파일 묶음당 최근 실행 하나만 보입니다. upstream 은 이 묶음을 먼저 고른 뒤 `latest` 를 적용하므로, 같은 파일을 새 설정으로 다시 실행했다면 "최신 설정 결과만 보기" 를 꺼도 이전 설정의 Job 은 "이전 실행도 보기" 를 켜야 보입니다. 두 항목 아래 한 줄 설명이 켜짐과 꺼짐에 따라 지금 보이는 행을 설명하고, "이전 실행도 보기" 가 꺼져 있을 때 "최신 설정 결과만 보기" 에 마우스를 올리거나 포커스하면 이 경우를 툴팁으로 알립니다. 버튼에는 켜진 옵션 수가 보입니다(처음에는 1).
- **Collection 상세의 검수**: Job 표의 "검수" 열에 배지(검수 전은 테두리 없는 흐린 글자, 검수 중은 테두리, 검수 완료는 채움. 검수 완료면 완료 시각을 `title` 로)가 보입니다. Job 표는 카드 하나에 묶여 있고(따로 제목과 설명 줄은 두지 않음), 맨 위 한 줄 도구 막대의 왼쪽에 검수 상태 필터(전체, 검수 전, 검수 중, 검수 완료), 오른쪽에 검색(파일명 또는 Job ID. Job ID 를 넣으면 입력칸 안에 "바로 열기" 가 나타나고 안내는 입력칸 아래에 떠서 보임), "표시 옵션" 메뉴("이전 실행도 보기", "최신 설정 결과만 보기" 체크 항목과 한 줄 설명, 켜진 수를 버튼에 표시), 정렬 select(결과 최신순, 오래된순)가 있습니다. Collection 제목 아래 요약 카드 줄의 맨 앞(넓은 카드) **진행 현황** 은 "검수 완료 n / m" 막대와 "검수 중 k" 이고(이어서 전체 Job, 최신 설정으로 실행한 Job, 최신 설정 수 카드), 분모 m 은 `total_job_count − pending_job_count − failed_job_count` 이고 막대 아래 회색 글씨로 이 기준과 "차례로 검수하기" 대상(표의 기본 보기)보다 많을 수 있다는 안내가 보입니다(취소된 Job 도 들어가므로 취소 Job 이 섞이면 분모가 조금 큽니다. `total_job_count` 가 없으면 막대 없이 "검수 완료 n" 만). 분자 n, k 는 앱 DB 에서 그 Collection 의 상태 행을 그대로 센 값이라 upstream 의 Job 목록이나 표 조건과 맞춰 보지 않습니다. 그래서 n 이 m 보다 클 수 있습니다(예: 상태를 남긴 뒤 upstream 에서 사라진 Job). 이때 막대는 가득 찬 채로 멈추고 숫자는 그대로 보입니다. **"차례로 검수하기"** 는 진행 현황 카드 오른쪽 끝의 버튼이고(카드 세로 가운데, "검수할 Job 이 없습니다" 같은 안내는 버튼 아래에 떠서 보여 버튼이 움직이지 않음), 지금 표 조건(검색어, 최신 설정 결과만 보기, 이전 실행도 보기, 정렬)에서 검수 전이거나 검수 중인 Job 을 받아 첫 Job 을 큐로 엽니다(없으면 "검수할 Job 이 없습니다"). 표의 행을 열어도 그 표(조건, 순서, 받아 둔 행, 다음 커서)가 큐가 됩니다. 새 탭이나 새 창으로 열면 큐 없이 엽니다. 큐는 탭마다 브라우저 `sessionStorage`(`review-queue:{collectionId}`)에 둡니다.
- **Job 화면 헤더**: 한 줄입니다. Studio 워크플로우 화면 머리처럼 왼쪽에 돌아가기 화살표(Job 목록으로, 마우스를 올리면 Collection 이름)와 Job 이름(첫 입력 파일명, 파일이 여럿이면 "외 n개", 파일 정보가 없으면 Job ID. 마우스를 올리면 모든 파일명과 Job ID), 검수 배지, 가운데에 Step 트랙, 오른쪽에 JSON(설정에서 켰을 때), 변경 이력(설정에서 켰을 때), 변경 사항, 저장, 주 동작입니다(넓은 화면은 세 칸 격자, 좁으면 줄바꿈. 폭이 모자라면 오른쪽 동작 묶음을 한 줄로 지키고 Step 탭 이름이 먼저 말줄임됩니다). 큐 바와 완료 안내는 공통 상단 바에 있습니다. 저장 상태 문구는 버튼 왼쪽에 보이고, 저장 버전 번호(revision)는 "저장됨" 에 마우스를 올리면 보입니다.
- **Job 화면의 검수**: 저장 오른쪽 주 동작은 저장하지 않은 변경이 없으면 "검수 완료", 있으면 **"저장하고 완료"** 입니다. "저장하고 완료" 는 저장을 시작하고, 반영(`applied`)돼 검수 문서를 다시 불러오면 이어서 검수 완료(큐에서는 다음 Job 열기)까지 합니다. 일부만 반영, 충돌, 실패, 변경 없음, 다시 불러오기 실패면 완료하지 않고 저장 상태 문구로 알립니다. 저장 중, 충돌, 검수 상태 요청 중이면 비활성이고, 완료 뒤에는 "검수 중으로 되돌리기" 가 있습니다(검수 완료 Job 은 고쳐 저장하면 검수 중으로 돌아가므로 "저장하고 완료" 를 두지 않고 "저장" 만 씁니다). 완료하면 공통 상단 바의 큐 바 왼쪽에 "검수 완료: 파일명" 이 6 초 보이고, 다음 Job 으로 넘어가도 남습니다. 단축키는 ⌘/Ctrl+S 가 저장(저장할 것이 없어도 브라우저의 페이지 저장을 막음), ⌘/Ctrl+Enter 가 주 동작입니다(여러 줄 값 입력이 확정에 쓴 키와 한글 조합 중인 키는 가로채지 않고, 시트, 확인 창, 입력칸(검색칸 포함) 안에서는 주 동작을 부르지 않음). 값 칸이나 라벨 칸에 입력하다 ⌘/Ctrl+S 를 누르면 입력을 먼저 확정(blur)하고 그 변경까지 저장합니다. 버튼은 `aria-keyshortcuts` 와 `title` 로 단축키를 알립니다. 큐로 연 Job 은 공통 상단 바(설정 메뉴 왼쪽)에 **큐 바**(‹ 이전 Job, 다음 Job ›, "다음: 파일명", "남은 n개"(다음 페이지가 남았으면 "n개+"), 다음 페이지를 받는 동안 "불러오는 중…")가 생기고, 끝에서는 이전, 다음이 `aria-disabled` 입니다. 받아 둔 행이 끝나면 다음 커서로 이어 받습니다. 큐에 다음 Job 이 있으면 지금 Job 을 먼저 불러오도록 1.5 초 뒤 다음 Job 첫 파일의 페이지 응답(`/api/files/{fileId}`)을 미리 받아 서버 캐시를 데우고 앞 2 쪽 이미지를 브라우저가 받아 두게 합니다(실패는 알리지 않음, `use-prefetch-next-job.ts`). 설정 메뉴의 "완료하면 다음 Job 열기"(기본 켬, `localStorage` `review-queue-advance`)가 켜져 있으면 버튼이 "완료 후 다음 Job" 이 되어 완료 뒤 다음 Job 을 바로 엽니다. 마지막 Job 에서는 새로 고침 아이콘 버튼 "새 Job 확인" 이 큐 조건으로 첫 페이지를 다시 받아 아직 안 본 Job 으로 새 큐를 시작합니다(확인하는 동안 아이콘이 돕니다. 없으면 "새로 추가된 Job 이 없습니다" 가 4 초 보였다가 사라지고, 이미 연 Job 중 검수가 끝나지 않은 Job 이 있으면 그 수와 함께 "이전 Job" 으로 돌아가라는 안내가 8 초 보입니다. 불러오기 실패 안내는 다음 동작까지 남습니다). 이동은 라우트 이동이라 변경이 남아 있으면 이탈 확인, 임시 저장이 그대로 적용됩니다. 큐는 이 탭에 저장된 큐 목록에 그 Job 이 있는지로만 판단합니다. 큐가 없는 탭(새 탭 등)이나 큐에 없는 Job 을 직접 URL, Job ID 검색으로 열면 큐 바가 없고, 같은 탭에서 큐에 든 Job 을 열면 경로와 관계없이 큐 바가 보이고 큐 위치가 그 Job 으로 옮겨집니다.
- **Job 검수 화면 배치**: 고른 Step 탭의 본문이 헤더 아래에 보입니다. 본문은 Studio 워크플로우 화면처럼 둥근 틀 하나를 세로선으로 나누고(문서 목록은 옅은 회색, 뷰어는 회색 캔버스, 작업 패널은 흰 바탕), 넓은 화면(`xl` 이상)에서 왼쪽 문서 목록, 가운데 페이지 띠와 문서 뷰어, 오른쪽 작업 패널 3 열(뷰어와 패널은 같은 너비)이고, 그보다 좁으면 문서 목록(가로 스크롤 줄) → 뷰어 → 패널 순서로 세로로 쌓입니다. 넓은 화면에서는 화면을 창 높이에 맞추고 세 열이 각자 스크롤해 페이지 전체 세로 스크롤이 생기지 않습니다(창 높이가 아주 낮으면 최소 높이를 넘겨 페이지가 스크롤). 구성 탭의 필름스트립은 뷰어 칼럼 맨 위 구조 툴바 오른쪽 끝의 페이지 썸네일 아이콘(툴팁 "페이지 썸네일 펼치기/접기")으로 열고 닫습니다(한 번 펼치거나 접으면 브라우저 `localStorage` `review-filmstrip` 에 기억합니다. 기억값이 없으면 문서가 나뉜 Job — 한 파일 그룹에 문서가 둘 이상이거나 문서가 그룹의 모든 페이지를 덮지 않는 Job — 은 펼친 채, 파일마다 문서 하나뿐인 Job 은 접힌 채 시작합니다. Classify 의 split 설정은 검수 JSON 에 없어 실제 배치로 판정합니다). 툴바는 고정이라 띠를 펼치거나 접어도 토글이 움직이지 않고, 띠는 툴바 아래 뷰어 칼럼 폭 안에 열려 가로로 스크롤하며, 뷰어가 남은 높이를 나눠 써 창 높이 맞춤은 그대로입니다(뷰어 최소 높이를 못 채우면 뷰어 칼럼만 스크롤). 뷰어는 값, Parse 요소, 인용의 영역을 패널에서 가리키거나 골랐을 때만 그립니다(처음에는 아무 영역도 그리지 않고, 뷰어 안에서 영역 자리를 가리키면 그 영역이 보입니다).
- **불러오기**: `review-capabilities` 와 `review-document?job_ids={jobId}` 로 검수 JSON 을 받아 편집 세션을 만들고, Job 의 입력 파일마다 `/api/files/{fileId}`(동시 2 개)로 페이지 이미지 URL 을, `source-jobs/{jobId}/response` 로 추출값·Parse 좌표를 받습니다. 파일을 받는 동안 뷰어 위에 "페이지 이미지 n/m · 파일 k/l" 진행 문구가 보이고 모두 받으면 사라집니다. 파일 응답의 Parse 하이라이트는 **Parse 탭에서만** 현재 페이지 ±10 쪽을 20 쪽 묶음(`/api/files/{fileId}/highlights?pages=a-b`)으로 받고, 묶음을 받는 중·실패하면 같은 자리에 알립니다(실패하면 상태 줄의 "다시 시도" 가 실패한 묶음만 다시 요청). 뷰어에는 어느 탭이든 현재 페이지 ±3 쪽의 하이라이트(와 선택·호버한 것)만 넘깁니다. Job 응답을 못 받아도 값 폼은 동작하고 하이라이트만 빠집니다. `review-capabilities` 를 못 받으면 안내 없이 기본 한도(8 MiB·`present`·`stale` 편집 가능)로 열고 콘솔에 경고 한 줄만 남깁니다.
- **뷰어**: 문서 뷰어는 기본이 **연속 스크롤**(문서 페이지를 세로로 이어서 보이고, 보이는 페이지와 그 앞뒤 한 화면만 그림)이고, 뷰어 아래 툴바의 쪽 번호("1 / 8") 오른쪽 보기 방식 아이콘 두 개(툴팁 "한 장씩 보기", "이어서 스크롤")에서 한 장씩 보기를 고르면 한 장씩 모드가 됩니다(선택은 브라우저 `localStorage` `review-viewer-mode` 에 기억, 기억값이 없으면 이어서 스크롤). 연속 스크롤의 페이지 폭 맞춤이 세로 스크롤바 폭만큼만 넘칠 때는 가로 스크롤을 숨기고, 확대해 페이지가 더 넓어지면 가로 스크롤이 생깁니다. 뷰어 열을 클릭하거나 포커스한 뒤 PageUp, PageDown 은 앞, 뒤 페이지, Home, End 는 첫, 끝 페이지, Alt+↑, ↓ 는 앞, 뒤 문서로 갑니다(입력 요소 안과 Shift, Ctrl, ⌘ 조합은 가로채지 않음. 뷰어 열은 `aria-keyshortcuts` 와 화면 낭독기용 설명을 가짐). 고른 문서, 페이지는 주소의 `?doc={documentId}&page={n}` 에 적히고(바뀐 뒤 300 ms, 그 전에 페이지가 숨겨지거나 내려가면(`pagehide`, `visibilitychange`) 바로. `replaceState`), 그 주소로 열면 같은 자리에서 시작합니다(범위 밖 `page` 는 끝 쪽으로, 모르는 `doc` 은 첫 문서로). 값 탭의 뷰어 위 띠는 문서가 12 쪽 이하면 없고(쪽 이동은 뷰어 아래 막대의 "n / m"), 그보다 길면 **위치 바**입니다. 위치 바는 ◀ ▶ 로 한 쪽씩 옮기고(끝 쪽에서는 비활성 표시만 하고 포커스는 남음), 숫자 입력(Enter 확정, Esc 복원)으로 바로 가며, 트랙(slider)을 누르거나 끌거나 키보드(←→ 1 쪽, PageUp, PageDown 10 쪽, Home, End)로 옮기고, 트랙에 바뀐 값이 있는 페이지, 검증 문제가 있는 페이지(구성 탭이거나 변경 사항이 열려 있어 검증이 계산될 때만), 이미지가 아직 없는 페이지를 구간으로 표시합니다.
- **문서 목록**: 제목은 Classify Step 보기의 문서만 있으면 "분할된 문서"(Classify 가 원본 파일에서 식별해 나눈 문서이고, 이름은 분류된 문서 종류인 라벨), 분류 없는 보기가 섞이면 "문서" 이고, 제목 옆 정보 아이콘에 마우스를 올리거나 포커스하면 목록 설명이 보입니다. 목록 위에 돋보기 아이콘이 있는 라벨 검색(입력 300 ms 뒤 적용, 대소문자, 전각 무시)과 상태 선택(전체, 실패 또는 경고, 바뀜, 재확인 필요, 제외, 변경 없음, 그리고 문서가 둘 이상이면 구분선 아래 "열어 보지 않은 문서"), 요약 "문서 n개, 전체 m쪽"(문서가 둘 이상이면 ", 열어 본 문서 j개", 거르는 중이면 ", 필터 k개")이 있고, 걸러도 행 번호는 원래 순서입니다. 문서에 연결된 Validate 결과의 판정(지금 편집본 기준, 여럿이면 가장 나쁜 값)이 red 면 쪽수 앞에 실패 아이콘(빨간 X 원), yellow 면 경고 아이콘(노란 삼각형)을 보이고, "실패 또는 경고" 는 그 문서만 거릅니다. 편집 상태도 그 옆 아이콘으로 보입니다(바뀜은 연필, 재확인 필요는 눈, 편집 불가는 자물쇠, 제외는 금지 표시). 아이콘에 마우스를 올리면 뜻을 풀어 쓴 툴팁이 보이고, 화면 낭독기는 아이콘 대신 이름("실패", "바뀜" 등)을 읽습니다. 문서가 둘 이상이면 이 Job 에서 아직 열어 보지 않은 문서는 행 왼쪽 여백에 점이 찍힙니다(점에도 툴팁, 고른 문서를 브라우저 `localStorage` `review-visited:{collectionId}:{jobId}` 에 Job 마다 최근 2,000 개까지 기억). 파일 그룹이 둘 이상이면 그룹 머리("그룹 n")가 들어갑니다. 행이 100 개를 넘으면 고정 높이 행 + 자체 스크롤 창(`maxHeight`)에 보이는 행만 그리고, 문서를 고르면(목록, Alt+↑↓, 주소) 그 행이 보이게 창을 옮깁니다. Alt+↑, ↓ 는 필터와 무관하게 전체 문서를 돕니다. 고른 문서가 필터에 가려지면 요약 줄 아래에 "선택한 문서가 필터에 가려져 있습니다" 와 "필터 지우기"(검색어, 상태를 바로 비움)가 보입니다. "변경 없음" 은 상태 표시가 없는 문서와 편집 불가(잠김) 문서입니다. "열어 보지 않은 문서" 는 점이 찍힌 문서만 거르되 지금 고른 문서는 열어 봤어도 남기고(고르자마자 목록에서 사라지지 않게, 다른 문서를 고르면 빠짐), 문서가 하나만 남아 열어 본 문서를 구분하지 않게 되면 전체로 돌아갑니다.
- **Step 탭**: 헤더 큰 줄 가운데의 Studio 단계 트랙(회색 둥근 트랙 안 알약 탭, 탭 사이 꺾쇠)에 Job 의 Step 마다 탭 하나가 있습니다. 탭은 Job 전체 Step 순서 번호 배지와 타입 이름이고, 같은 타입 Step 이 여럿일 때만 Step 이름을 붙입니다(전체 이름은 `title`). 트랙 폭이 모자라면 이름이 붙은 탭부터 말줄임되고(고른 탭은 줄지 않음) 가장 좁을 때는 번호 배지만 남으며, 그래도 넘치면 트랙이 가로로 스크롤됩니다. 고른 탭은 흰 바탕에 그 노드 색(`globals.css` 의 `--node-*`, Studio 와 같은 값: Parse 보라 파랑, Classify 코랄, Extract 핑크, Instruct 청록, Validate 퍼플, Match 와 Export 하늘색, Merge 초록) 테두리, 배지, 글자입니다. 보여 줄 것이 없는 Step 은 탭을 숨깁니다. 문서를 고르면 그 문서에 해당하는 Step 탭만 보입니다(분류 Step 이 `split` 으로 문서마다 다른 Step 을 돌리는 흐름에 맞춤): 값 탭은 그 문서에 연결된 결과가 있는 Step(어느 문서에도 연결되지 않은 결과만 있는 Step 포함), Parse 탭은 그 문서 페이지에 요소가 있을 때, Instruct 탭은 그 문서 페이지와 겹치는 출력(페이지 범위가 없는 출력은 문서 전체)이 있을 때입니다. 보던 탭이 숨으면 같은 종류의 첫 탭(값 탭이면 그 문서의 첫 값 탭)으로 옮깁니다. 이름은 Studio 가 Step 을 만들 때 붙이는 타입 prefix(`Classify - ` 등)를 떼고 보이며, `step_2_classify` 처럼 자동 이름이면 배지만 보입니다. 같은 배지와 이름이 겹치면 뒤에 순번이 붙습니다. 순서는 Job 응답의 실행 순서를 따르고, 처음에는 고칠 수 있는 첫 탭(대개 Classify)이 열립니다. 문서 분류 Step 의 탭은 문서 구성을, Extract, Validate, Match, Merge 등 결과가 있는 Step 의 탭은 그 Step 의 값만 보이고 고칩니다. Parse 와 Instruct 탭은 **보기 전용**입니다. Merge 결과는 Export Step 에 실리지만 배지는 Merge 로 보입니다. 저장하는 동안은 탭을 바꿀 수 없습니다.
- **문서 구성 탭(Classify)**: 뷰어 위 필름스트립에서 문서별 띠의 썸네일을 끌어 페이지 순서를 바꾸고, 다른 띠로 옮기고, 페이지 사이 ✂ 로 문서를 나누고, 띠를 다른 띠에 놓아 합치고, 제외 띠로 페이지를 뺍니다. 같은 일을 썸네일, 띠의 메뉴(⋯)로 키보드만으로 할 수 있습니다. 페이지 조작은 같은 파일 그룹 안에서만 됩니다. 오른쪽 패널은 선택 문서의 라벨, 페이지와 저장 전 검증을 보입니다. 저장 전 검증은 고칠 때마다 시스템이 자동으로 하는 검사(빠진 페이지, 겹친 페이지, 범위 밖 페이지, 설정에 없는 라벨 등)이고, 저장을 막는 문제가 없으면 초록 체크 줄, 저장을 막는 문제는 빨간 줄(X 아이콘), 저장은 되지만 알아 둘 것은 노란 줄(경고 아이콘)로 보입니다. 문서 배치 보기(Layout)가 둘 이상인 Job 은 보기마다 구성 탭이 생기고, 둘 다 읽기 전용입니다. 어느 조작이든 뷰어는 보던 페이지를 계속 보입니다(아래 "선택은 보던 페이지를 따라갑니다").
  - **페이지 범위 입력**: 패널의 "페이지 범위" 에서 파일마다 범위를 `1-3, 5` 처럼 적습니다(Enter·포커스 이동 때 반영, 읽을 수 없으면 행 아래 오류). 적은 순서가 문서 안 페이지 순서이고, 범위를 줄여 빠진 페이지가 생기면 필름스트립과 검증 요약에 바로 보이고, 다른 문서나 제외 페이지에 있던 페이지를 적으면 그 페이지는 원래 자리에서 빠져 이 문서로 옮겨집니다(비게 된 문서는 사라짐). 변경 사항 항목에 어느 문서에서 몇 쪽을 가져왔는지와 사라진 문서가 함께 적힙니다.
  - **새 문서로 분리**: 패널 "새 문서로 분리…"(hover 하면 툴팁으로 설명)에서 라벨과 페이지 범위를 정하면 그 페이지가 지금 문서에서 분리되어 선택 문서 바로 뒤의 새 문서가 됩니다. 열면 첫 범위 행이 보던 쪽(파일 + 쪽 번호)으로 채워져 있습니다. 제외한 페이지나 어느 문서에도 없는 페이지는 썸네일 메뉴 "새 문서로" 로 바로 새 문서를 만듭니다. 다른 문서의 페이지를 적으면 페이지 범위 입력과 같은 규칙으로 옮겨 옵니다.
  - **문서 제외, 복귀**: 패널 버튼이나 띠 메뉴로 문서 전체를 제외하고 되돌립니다. 제외 문서는 띠에서 흐리게 "제외" 로, 문서 목록에서는 흐린 행과 제외 아이콘으로 보이고, 그 페이지는 빠진 페이지로 세지 않습니다.
  - **파일 그룹**: 파일이 2 개 이상인 Job 은 패널 "파일 그룹" 에서 파일을 다른 그룹으로 옮기거나 새 그룹으로 분리합니다. 옮길 수 없으면 메뉴가 비활성이고 사유가 보입니다([알려진 제약](#알려진-제약) 절의 "파일 그룹 이동").
  - **큰 Job 의 필름스트립(이웃 보기)**: Job 전체가 20 쪽을 넘으면 띠를 [앞 문서(끝 3 쪽) · 선택 문서(전체, 스크롤 창에 보이는 칸만 그림) · 뒤 문서(앞 3 쪽)] 로 줄이고 앞뒤에 숨은 문서 수("앞 문서 n개 / 뒤 문서 n개")를 적습니다. 이웃 띠의 제목을 누르면 그 문서가 선택돼 띠가 옮겨 가고, 접힌 이웃 띠에 썸네일을 놓으면 그 문서의 끝/앞에 들어갑니다. 제외·빠진 페이지 띠는 개수 칩으로 접혀 있고 "펼치기" 로 엽니다(접힌 채로도 놓을 수 있음). 편집으로 빠진 페이지가 새로 생기면(0 → 1 개 이상) 빠진 페이지 띠는 저절로 펼쳐집니다. 접힌 이웃 띠의 썸네일 메뉴에는 "다른 문서로"·"제외" 만 있습니다. 끌면서 띠 창의 좌우 가장자리에 머물면 자동으로 스크롤합니다. 띠 메뉴 "위치 지정…" 은 같은 파일 그룹이 이어진 구간 안의 번호를 적어 문서 순서를 바꿉니다. 20 쪽 이하 Job 은 띠를 줄이지 않고 모든 문서의 띠를 그대로 보입니다.
  - **페이지 정리 화면**: 구조 툴바 오른쪽 끝의 "페이지 정리" 를 누르면 오른쪽 작업 패널 자리에 문서별 묶음(제목 줄 + 썸네일 여러 줄)을 세로로 쌓은 격자가 들어가고(보이는 행만 그림), 썸네일을 누르면 옆 뷰어가 그 페이지를 보입니다(격자와 큰 미리보기를 나란히 두려고 패널 자리를 씁니다). 정리 화면 머리 줄에는 제목 "페이지 정리", 썸네일 크기(작은 썸네일, 큰 썸네일 아이콘 두 개. 이름은 툴팁으로), "완료" 가 있고, 열림과 크기는 브라우저 `localStorage`(`review-organizer`, `review-organizer-size`)에 기억합니다. 열린 동안 필름스트립 띠와 띠 토글, 구성 작업 패널(라벨, 페이지 범위, 새 문서로 분리, 파일 그룹)은 숨고 "완료" 나 툴바의 "페이지 정리" 를 다시 누르면 돌아옵니다("완료" 로 닫으면 포커스가 툴바의 "페이지 정리" 로 갑니다). 조작은 필름스트립과 같은 변경 항목이 됩니다. 썸네일을 끌어 같은 문서 안 자리(셀 사이 막대로 표시), 같은 파일 그룹의 다른 문서(셀 사이에 놓거나 제목 줄에 놓으면 그 문서 끝), 맨 아래 "제외" 칸에 놓고, 끌면서 격자 위, 아래 가장자리에 머물면 그쪽으로 자동 스크롤합니다. 여러 장을 골라 그중 하나를 끌면 고른 페이지 전부가 함께 옮겨집니다(같은 문서 안 자리는 문서 순서로 모이고, 다른 문서, 제목 줄, 제외 칸도 같음). 끄는 동안 포인터 옆 배지와 격자 바닥 줄에 장 수가 보이며, 놓을 수 없는 자리(다른 파일 그룹, 여러 그룹에 걸친 선택, 잠긴 문서)는 사유별 문구를 보이고 아무것도 바꾸지 않으며, 자리가 그대로면 안내 없이 아무것도 바뀌지 않습니다. 고르지 않은 페이지를 끌면 선택이 비고 그 한 장만 옮깁니다. 결과는 일괄 바와 같은 묶음이라 변경 사항 트레이에 한 줄로 보이고 묶음째 되돌립니다. 썸네일 사이 ✂ 를 누르면 그 페이지 앞에서 문서를 나눕니다(필름스트립 ✂ 와 같이 같은 라벨로 그 쪽부터 문서 끝까지 새 문서, 선택과 뷰어는 그대로, 끄는 동안 숨음, 키보드로는 셀 ⋯ 메뉴). 셀 ⋯ 메뉴는 앞으로, 뒤로, 다른 문서로 옮기기 ▸, 이 페이지 앞에서 나누기, 이 페이지 제외이고, 제목 줄은 라벨(설정 라벨이 있으면 select, 없으면 입력칸)과 ⋯ 메뉴(앞 문서와 합치기, 앞으로, 뒤로, 위치 지정…, 이 문서 제외/복귀)입니다. 제외 칸의 셀 메뉴는 "문서로 되돌리기 ▸" 와 "새 문서로" 이고, 빠진 페이지 칸(빠진 페이지가 있을 때만 보임)의 셀 메뉴는 "새 문서로" 뿐입니다. 다른 파일 그룹, 잠긴 문서로의 drop 은 거부하고 격자 바닥에 사유를 보입니다. 여러 장을 한 번에 다룰 때는 ⌘(macOS), Ctrl+클릭으로 한 장씩 넣고 빼고, Shift+클릭으로 기준 장부터 문서 경계를 넘어 범위를 고릅니다(그냥 클릭은 선택을 비우고, 어떤 클릭이든 뷰어는 누른 페이지로 갑니다). 고르면 격자 위에 일괄 바("n장 선택, 다른 문서로 옮기기…, 제외, 새 문서로 분리…, 여기서 나누기(한 장이고 문서 첫 장이 아닐 때), 선택 해제")가 붙고, 고른 것이 없을 때는 같은 자리에 끌어 옮기기와 여러 장 선택 방법을 알려 주는 짧은 캡션(입력란 모양이 아닌 글)이 있어 바가 생기고 사라져도 격자가 밀리지 않습니다. 겹친 페이지, 잠긴 문서의 페이지는 여러 장 선택에 들어가지 않습니다(클릭하면 뷰어만 이동). "다른 문서로 옮기기…" 는 구조 툴바의 "페이지 옮기기…" 와 같은 대화상자를 범위 입력 대신 고른 페이지 요약 한 줄로 열어 옮길 곳(같은 그룹의 문서와 위치 끝, 앞, 특정 페이지 앞, 또는 새 문서)만 받고, "새 문서로 분리…" 는 같은 대화상자를 새 문서 대상으로 미리 골라 열어 라벨(기본값은 첫 원본 라벨)을 고르면 고른 페이지를 첫 원본 문서 바로 뒤의 새 문서로 모읍니다. 일괄 조작은 원본 문서마다 변경 항목 하나씩을 한 번에 적용하고(하나라도 안 되면 아무것도 바꾸지 않고 바 아래에 사유), 성공하면 선택을 비웁니다. 변경 사항 트레이에는 한 묶음으로 보이고 묶음째 되돌립니다(변경 개수는 항목 수 기준). Esc(격자, 바 안 포커스, 입력칸 밖)로도 선택을 비웁니다.
  - **뷰어 위 구조 툴바**: 구성 탭에서는 뷰어 위에 경계 띠("◀ 문서 n 끝 (p)" · "문서 n · 라벨 · 쪽/전체" · "문서 n 시작 (p) ▶")와 보던 페이지에 대한 동작 — "여기서 나누기 ✂"(첫 쪽은 비활성. 잘린 뒤 문서가 선택되고 같은 페이지를 유지) · "앞 문서로" · "뒤 문서로"(같은 파일 그룹의 이웃만, 아니면 비활성과 사유) · "페이지 제외" · "페이지 옮기기…"(시작·끝 페이지 범위와 옮길 곳을 골라 한 항목으로 옮김. 옮길 곳은 같은 그룹의 다른 문서(위치 끝/앞/특정 페이지 앞) 또는 "새 문서 (원본 문서 바로 뒤)" — 새 문서를 고르면 위치 대신 새 문서 라벨(설정 라벨 select 또는 입력, 기본값은 원본 라벨)을 받아 분리하므로, 문서가 하나뿐이어도 일부 페이지를 다른 라벨로 분리할 수 있음) — 이 있습니다. ✂ 와 "페이지 옮기기…" 는 hover 하면 툴팁으로 역할을 알려 줍니다(✂ 는 보던 쪽부터 끝까지 같은 라벨로 나누고, 일부 쪽만 분리하거나 라벨을 바꾸려면 "페이지 옮기기…"). 선택은 보던 페이지를 따라갑니다: 나누기(✂·셀 메뉴·툴바·일괄 바)·페이지 옮기기(끌기·앞/뒤 문서로·페이지 옮기기…)·합치기·제외·순서 바꾸기 뒤에도 뷰어는 같은 페이지를 보이고, 그 페이지가 다른 문서로 가면 그 문서가 선택되며 남으면 문서는 그대로 두고 위치만 맞춥니다. 보던 페이지를 제외하면 그 자리의 다음 페이지가, 페이지가 간 곳을 모르는 경우(되돌리기·다시 읽기·임시 저장 복원·JSON 가져오기)로 보던 문서가 사라지면 같은 보기에서 그 자리의 문서가 선택됩니다.
- **값 탭(Extract, Validate, Match, Merge 등)**: 선택 문서에 연결된 결과(문서 연결과 Merge 의 `field_groups` 연결 모두) 중 그 탭 Step 의 결과만 보이고(결과가 둘 이상이면 "결과 n"), 그 문서에 이 Step 결과가 없으면 그렇다고 알립니다. Step 출력 schema 를 따라 값을 트리로 그립니다. 필드마다 입력 위젯을 고릅니다(enum → 선택, boolean → 스위치, number → 숫자 텍스트, 그 외 → 텍스트). 필드 행의 이름 줄은 schema 키를 회색 바탕의 고정폭 글씨 칩으로 보이고(schema `title` 이 키와 다르면 이름 옆에 칩), 마우스를 올리면 "스키마 키" 라고 알립니다. 필드 도움말(schema `description`)은 "설명 보기" 를 켰을 때만 보이고(아래 "설명 보기, 규칙 보기" 항목), 앞에 정보 아이콘을 붙이고(마우스를 올리면 "스키마 설명: …"), 한 줄로 줄여 보이고(가리키면 `title` 로 전체), 그 행에 포커스가 들어오면 모두 펼칩니다(입력의 `aria-describedby` 가 도움말 전체를 가리킴). "원본 값" 줄과 "원래 값으로" 는 값이 원본과 다른 행에만 보이고, 비어 있는 입력칸은 흐린 "빈 값"(빈 문자열), "값 없음"(`null`)으로 구분합니다. 원래 `null` 인 필드를 입력칸에서 비우면 빈 문자열 대신 `null` 로 씁니다(서버는 둘을 다른 값으로 보아 빈 문자열을 정정으로 기록하고 근거 정보를 비움). 배열 항목을 넣고 빼고 옮긴 뒤에는 변경 기록을 되짚어 그 항목의 원래 값을 기준으로 삼고, 새로 넣은 항목은 빈 문자열을 그대로 씁니다(`cleared-value.ts`). 빈 문자열을 일부러 넣으려면 JSON 편집을 씁니다. 패널 머리는 선택 문서 라벨과 파일, 쪽 범위 한 줄입니다("선택한 문서" 제목은 화면 낭독기용). 입력은 Enter, 포커스 이동 때 반영되고 Esc 로 취소합니다. 필드의 입력을 누르면(포커스가 들어오면) 뷰어가 그 값의 페이지로 가서 영역을 강조하고, 행을 가리키면 영역을 미리 보이며, 뷰어의 영역을 누르면 그 필드 행으로 스크롤합니다. 고른 값의 강조는 그 행 밖을 누르면 풀립니다(뷰어 안과 열린 메뉴, 대화상자 안은 예외). Validate 결과는 green, yellow, red 판정으로 고칩니다. Validate 가 아닌 값 탭에서는 선택 문서에 yellow, red 판정의 Validate 결과가 있으면 결과 위에 판정("실패", "경고"), Validate 탭 이름, 통과하지 못한 원본 근거(규칙 이름, 심각도: 식)를 짧게 보이고 "판정 보기" 로 그 Validate 탭으로 옮깁니다. 페이지 구성이 바뀐 문서의 결과와 편집 가능한 상태가 아닌 결과는 잠기고 사유가 보입니다. 같은 필드를 여러 번 고쳐도 변경 사항은 한 항목이고(사이에 그 필드의 상위, 하위를 바꾼 항목이 없을 때), 원래 값으로 돌아오면 항목이 사라집니다.
  - **배열 표**: 항목이 모두 평평한 객체(값이 문자열, 숫자, 불리언, `null` 중 하나, 10,000 자 넘는 문자열 제외)이고 필드(열)가 8 개 이하인 배열은 항목마다 필드를 쌓는 대신 표(행 = 항목, 열 = 필드, 열 순서는 schema `properties` 순서 먼저)로 그리고, 50 행 이하면 처음부터 펼칩니다. 표는 패널 안에서 화면 높이의 60% 까지 자라고 그보다 길면 표 안에서 스크롤하며 머리 행이 위에 남습니다(좁으면 가로 스크롤). 칸에서 바로 고치고 Enter 는 다음 칸으로 갑니다. 칸을 가리키거나 포커스하면 뷰어가 원본 위치를 보입니다. 바뀐 칸은 옅은 바탕과 되돌리기 버튼, 원본 값은 칸의 `title` 로 보입니다. 행 끝 메뉴(⋯)는 위로, 아래로, 삭제이고, 어떤 항목에 없는 열의 칸은 "+" 로 그 필드를 넣고, 열에 없는 schema 필드는 행 끝 "+" 메뉴로 넣습니다. 값 필터 중에는 조건에 맞는 칸이 있는 행을 통째로 보이고 맞지 않는 칸만 흐리게 둡니다. 표 칸에는 "비우기", "필드 삭제" 메뉴가 없으므로 그 조작은 결과 머리 "JSON 으로 편집" 으로 합니다.
  - **트리 편집**: 배열은 접는 묶음이고 머리의 "항목 추가" 로 schema 템플릿 항목을 끝에 더합니다(빈 배열도 같음). 항목 메뉴(⋯)로 위로·아래로·삭제, 객체 끝의 "필드 추가" 로 schema 에 있지만 값에 없는 필드를 더하고, 행 메뉴로 "비우기(값 없음 = `null`, schema 가 허용할 때만)"·"필드 삭제(필수 필드 제외)" 를 합니다. 새 행에는 바로 포커스가 갑니다.
  - **JSON 으로 편집**: 결과 머리 메뉴 "JSON 으로 편집" 은 그 결과의 값 전체를 JSON 텍스트로 고쳐 통째로 바꿉니다(변경 사항에 "전체 값 교체" 하나). 10,000 자를 넘는 문자열은 입력칸 대신 크기와 앞 200 자 미리보기만 보이고, 행의 "JSON 으로 편집"(결과 머리 메뉴와 같은 대화 상자)으로 고칩니다.
  - **되돌리기 연쇄**: 배열 항목 추가·삭제·이동, 필드 추가·삭제, 값 통째 교체를 되돌리면 그 자리 아래에 나중에 쌓은 변경도 함께 빠지고, 몇 개가 함께 빠졌는지 안내합니다(배열 위치가 바뀌어 엉뚱한 자리에 적용되지 않도록). 페이지 집합을 바꾼 구조 변경(페이지 범위 입력·새 문서·옮기기·나누기·합치기·제외·복귀)을 되돌리면, 그 문서들의 페이지 범위를 나중에 다시 적은 항목도 함께 빠집니다(앞 항목이 만든 페이지 집합을 전제로 적은 범위라서). 거꾸로 나중 항목이 되돌리는 자리나 그 상위를 통째로 덮어썼으면("JSON 으로 편집"·필드 삭제·배열 항목 삭제) 그 항목도 함께 빠지고, 구조 변경을 되돌리면 그 뒤 같은 Job 에 쌓인 "문서 구성 JSON 교체" 도 함께 빠집니다(되돌린 값·구성이 실제로 돌아오도록). 함께 빠진 항목에 기댄 항목도 이어서 빠집니다.
  - **연결된 문서 없는 결과**: 어느 문서에도 연결되지 않은 결과는 그 Step 탭 패널 끝의 "연결된 문서 없음 (n)" 묶음에 접혀 있습니다.
  - **값 필터**: 결과 위 칩 "바뀐 값만", "빈 값만", "현재 페이지 값만" 으로 행을 거르고(여럿 켜면 모두 만족하는 행만, "빈 값만" 은 `null`, 빈 문자열, 공백만 있는 문자열과 항목이 없는 배열, 객체) 빈 묶음은 그리지 않습니다(선택은 브라우저 `localStorage` `review-value-filter` 에 기억). 뷰어에서 고른 행과 서버 오류나 schema 검사 오류가 가리키는 행, "항목 추가" 로 만든 새 항목(첫 필드가 선택 행이 됩니다)은 늘 보이고, 남은 묶음은 사용자가 닫은 것만 빼고 펼쳐지며, 결과 머리 아래에 "n개 숨김" 이 보입니다. "현재 페이지 값만" 은 위치 정보가 없는 값을 숨기고 뷰어 페이지를 따라갑니다. Validate 판정에는 필터가 적용되지 않습니다. 편집한 결과는 schema 규칙(형식, 허용 값, 필수 필드, schema 에 없는 필드, 항목 수)을 바로 검사해 그 행에, 객체와 배열 규칙은 그 묶음 머리에 문구를 보입니다(항목 수는 경고).
  - **필드 고르기**: 값 필터 줄 끝의 "필드" 메뉴에서 그 Step 결과의 맨 위 필드(schema 순서, schema 에 없지만 결과에 있는 필드는 그 뒤)를 체크해 맡은 필드만 봅니다. 체크해도 메뉴가 닫히지 않고 마지막 남은 필드는 끌 수 없으며, 일부를 숨기면 버튼에 "보이는 수 / 전체 수" 가, 필터 줄 아래에 "필드 n개를 숨겼습니다." 와 "모두 보기" 가 보입니다. 숨긴 필드와 그 아래 값은 패널과 "필드 추가" 메뉴에 나오지 않고 뷰어 하이라이트도 그리지 않으며, 값 필터와 결과 머리의 "n개 숨김" 은 보이는 필드 안에서만 봅니다. 저장을 막는 오류가 있는 필드는 숨겨도 보입니다. 선택은 Step 마다 브라우저 `localStorage` `review-fields` 에 `{"<stepId>": ["보이는 키", ...]}` 로 기억하고(항목이 없으면 모든 필드), 없어진 키는 무시하며 모든 필드를 숨기게 되는 값은 모두 보이는 것으로 읽습니다. 바꾸면 다른 탭에도 바로 반영됩니다.
  - **설명 보기, 규칙 보기**: 칩 줄 오른쪽 스위치로 켭니다(기본 꺼짐, 브라우저 `localStorage` `review-value-display` 에 기억). 스위치는 필터 칩, "필드" 메뉴와 같은 줄에 32px 높이로 서고, 좁으면 다음 줄로 내려갑니다. Validate 가 아닌 탭은 "설명 보기" 로, 켜면 값 행에 schema `description` 이 위 도움말 모양으로 보입니다("필드 추가" 메뉴의 설명은 늘 보임). Validate 탭은 "규칙 보기" 로, 켜면 원본 판정 근거 아래에 Config 에 설정된 규칙(check 이름, 심각도, 조건)이 회색으로 보입니다. 규칙은 검수 JSON 에 없어서 Job 응답 Validate 출력의 `additional_values.checks[].conditions`(실행 때 옮긴 조건 트리)에서 Step 별로 모으고 실행 값은 버립니다. 연한 카드 안에 규칙마다 이름과 심각도 칩을 두고, 조건 그룹은 "모두 만족", "하나 이상 만족" 아래 세로선으로 들여 씁니다. 필드는 코드 칩(`items[].amount 합계 = subtotal`, 마우스를 올리면 Step 이름까지)으로, 비교는 기호(=, ≠, ≥ …)로 쓰고, Step 이름은 규칙이 여러 Step 을 참조할 때만 필드 앞에 붙입니다. 원본 판정 근거(`checks`)는 스위치와 무관하게 늘 보이고, 판정을 고치면 근거 대신 "저장할 때 지워진다" 는 안내가 보입니다. 스위치를 눌러도 고른 값의 강조는 풀리지 않습니다.
  - **큰 배열**: 50 개를 넘는 배열은 50 개씩 그리고 끝에 "더 보기 (n개 남음)" 이 붙습니다. 뷰어에서 고른 항목이나 첫 오류 항목이 그 뒤에 있으면 그 자리까지 자동으로 넓히고, "항목 추가" 는 새 항목이 보이도록 먼저 넓힙니다(자동으로 넓힌 범위는 "더 보기" 로 넓힌 것처럼 선택이 바뀌어도 남고, 새로 고치면 50 개로 돌아갑니다). 오류 항목 때문에 펼쳐진 묶음은 접어 둘 수 있고, 새 오류나 새 선택이 그 배열을 가리키면 다시 펼쳐집니다.
- **Parse, Instruct 탭(보기 전용)**: Job 응답에 출력이 있을 때만 생깁니다.
  - **Parse 탭**: 하나이고, 첫 Parse 출력의 요소 목록입니다. 항목을 누르거나 가리키면 뷰어 영역이 함께 강조되고, 뷰어 영역을 누르면 목록이 그 항목으로 스크롤합니다. Parse 하이라이트는 이 탭에서만 뷰어에 그립니다. 목록 위 "현재 페이지만" 스위치를 켜면 뷰어 페이지의 요소만 보이고 페이지를 따라갑니다. 10 쪽을 넘는 문서는 기본으로 켜지고 선택은 브라우저에 기억합니다(`localStorage` `review:parse-current-page`). 그림 요소는 Studio 의 Parse 결과 미리보기처럼 Job 응답의 그림 이미지(BFF 가 `figure_url` 로 바꿔 둔 것)를 화면에 보일 때만 받아 보이고(서버 캐시 만료 등으로 받지 못하면 그 자리를 숨깁니다), 그림을 누르면 뷰어가 그 위치로 갑니다. 표 요소는 Studio 의 Parse 결과 미리보기처럼 `content.html` 을 표로 그리고(표 영역을 누르면 그 행을 고릅니다), 요소마다 "원문 보기" 로 그 HTML 소스 글자를 보고 "표로 보기" 로 돌아옵니다(탭 안에서만 기억). 표는 허용 목록(표 구조 태그와 칸의 `colspan`·`rowspan`)으로 다시 만들고 그 밖의 태그·속성·스크립트는 버리며, 그릴 수 없는 표는 글자로 보입니다.
  - **Instruct 탭**: Step 마다 하나입니다. 본문은 markdown 으로 그리고(Studio 의 Instruct 결과와 같이 줄바꿈 하나도 줄을 바꿉니다), `response_format` 으로 받은 JSON 출력은 필드별로 보이며 문자열 값은 markdown 으로 그립니다. 결정(`enum`) 상자와 "원본 JSON 보기" 가 있고, 인용 칩 `【†n】` 을 가리키면 뷰어가 그 위치를 미리 보이고 누르면 고릅니다(고른 강조는 칩 밖을 누르면 풀립니다. 뷰어 안은 예외).
- **전체 JSON**: 헤더 "JSON" 메뉴(맨 위에 "검수 결과 JSON" 제목과 설명, 항목마다 아이콘과 한 줄 설명)에서 원본(불러온 검수 JSON 그대로)과 현재 편집본을 내려받고, "직접 편집…" 시트(데스크톱은 화면 폭의 절반, 좁은 화면은 전체 폭)에서 검수 JSON 전체를 고치거나 "파일에서 가져오기…" 로 파일을 읽습니다. 시트의 "현재 편집본 불러오기" 는 화면에서 편집 중인 검수 JSON(저장 전 편집 포함)으로 편집기 내용을 바꿉니다(버튼에 마우스를 올리거나 포커스하면 툴팁으로 설명). 툴바 아래 한 줄은 지금 편집기 내용이 무엇인지 보입니다 — 현재 편집본(메뉴 "직접 편집…" 이나 "현재 편집본 불러오기"), 원본("원본 불러오기", 화면을 열 때 서버에서 불러온 결과로 화면에서 고친 내용은 없음), 파일(파일 이름). 불러온 뒤 이 창에서 글자를 고쳤으면 " · 이 창에서 직접 고침" 이 붙고, 불러온 그대로 되돌리면 사라집니다. "검사" 는 다른 Collection, Job, version, Step 목록, 파일 구성의 파일을 거부하고, 저장해도 반영되지 않는 읽기 전용 필드(`state`, `checks`, `schema` 등)의 변경은 버린다고 알립니다. "적용" 은 지금 편집본과 다른 점을 변경 사항 항목으로 한 번에 더하고(하나라도 적용할 수 없으면 아무것도 바꾸지 않음) 변경 사항을 엽니다. 지금 값과 같은 부분은 항목을 만들지 않으므로 안내하는 수는 실제로 생긴 변경 수이고, 모두 같으면 추가한 항목이 없다고 알립니다. 저장은 늘 그렇듯 "저장" 으로 따로 합니다. 구성(문서 목록, 범위, 파일 그룹)이 바뀌면 변경 사항에 "문서 구성 JSON 교체" 한 항목이 쌓이고, 바뀐 수(라벨, 페이지 범위, 추가, 삭제, 순서, 파일 그룹 설정)와 바뀐 문서 3 개까지가 함께 적히며 문서 목록에서 그 문서가 강조됩니다.
- **저장**: 헤더 "변경 사항" 은 사람이 읽는 변경 목록(항목별 되돌리기, 검증 요약, 고급 접기에 올릴 JSON)을 엽니다. 값 항목은 "Step › 필드: 전 → 후" 로 적고, 배열 안 값은 `items › 1번째 › qty` 처럼 몇 번째 항목인지를 함께 보입니다(래퍼 결과 `[{…}]` 의 맨 앞 항목은 위치로 세지 않습니다). 변경 항목은 자동으로 정리됩니다. 같은 필드의 값은 한 항목으로 합치고 처음 값으로 돌아오면 지우며(처음에 `null` 이던 필드를 입력칸에서 비운 빈 글자도 처음 값으로 봄), 같은 문서의 라벨 변경도 한 항목으로 합쳐 처음 라벨로 돌아오면 지웁니다. 제외 뒤 복귀처럼 다른 변경으로 문서 전체가 불러온 상태와 같아지면 항목을 모두 비웁니다. 목록 위 "모두 되돌리기" 는 확인 대화상자 뒤 저장하지 않은 변경을 모두 버립니다(항목이 없거나 저장 중이면 비활성. 충돌 상태여도 쓸 수 있고, 충돌 안내와 "다시 불러오기" 는 그대로 남습니다). "저장" 은 검증 → 업로드 크기 확인(`max_inline_import_bytes`, 없으면 8 MiB) → `review-imports` 생성(같은 본문이면 같은 멱등 키) → `Retry-After` 간격(1~10 초) polling 순으로 진행하고, 끝나면 결과에 따라 아래처럼 보입니다. 저장하는 동안은 편집, Step 탭 전환, 되돌리기를 막습니다.

  | 가져오기 결과 | 화면 |
  | --- | --- |
  | `applied` · `partially_applied` | 반영한 version 을 받아들이고 검수 문서·Job 응답을 다시 불러온 뒤 "저장됨 · revision n" |
  | `no_change` | "바뀐 내용 없음", 변경 목록 유지 |
  | 충돌(`base_version_conflict`) | 충돌한 항목을 빨갛게 표시하고 "다시 불러오기"(확인 후 로컬 변경 폐기) |
  | `failed` | 오류 코드 문구, `pointer` 가 필드를 가리키면 그 필드 행에 표시 |
  | `cancelled` · 10 분 초과 · 연속 연결 오류 3 회 | 중단 안내와 가져오기 ID |

- **변경 이력**(설정 › 고급 › 변경 이력을 켰을 때): 헤더 "변경 이력" 이나 결과 머리 메뉴(⋮) "이 결과의 변경 이력"(잠긴 결과에서도 열림 — 보기 전용)이 오른쪽 시트를 엽니다. `review-capabilities` 의 `revisions_supported` 가 `true` 가 아니면 두 진입점 모두 비활성이고 이유(이 Collection 에서는 제공하지 않음 · 지원 여부를 확인하지 못함)를 툴팁(메뉴는 둘째 줄)으로 보입니다. 행은 저장된 변경 1 건(값 또는 문서 구성)이고 한 번의 저장으로 2 건 이상 바뀌었거나 다른 Collection 에서 저장된 묶음은 테두리 상자로 감싸고 머리줄("함께 저장된 변경 N건" · "다른 Collection 에서 저장됨")을 붙이며, 머리줄 옆 원형 ! 에 뜻을 설명하는 툴팁이 있습니다. 종류(전체 · 값 · 문서 구성 — 문서 구성을 고르면 결과 칩을 지움) · 결과 칩(결과 메뉴로 열었을 때) · 정렬(최신순 · 오래된 순 — 서버 `order=asc`)로 거르고, 목록은 Collection 목록과 같은 번호 페이지(20 행/페이지, 100 행씩 받아 이어 붙임 — 받은 페이지로 돌아갈 때는 다시 받지 않음)입니다. 최신순 마지막 페이지 끝(오래된 순 1 페이지 처음)에 "최초 원본"(기계 출력) 행이 있습니다. 행을 펼치면 그 한 건을 받아 변경 전 → 변경 후(값은 항목 표, 문서 구성은 바뀐 내용 문장, JSON 보기)를 보이고, **"편집에 불러오기"** 는 그 변경 후 값을 지금 편집에 넣습니다(되돌리기가 아니라 다시 저장해 새 version 을 쌓는 방식, 지금 반영본·같은 값·저장 중·충돌·이력에 최초 원본 없음이면 막힌 이유를 보임). 불러온 변경은 트레이 항목에 출처("이력 vN에서 불러옴" · "최초 원본에서 불러옴")가 붙습니다.
  - **최초 원본 행**: 결과 대상은 누르면 기계 출력을 받는 대로 바로 불러옵니다. 받는 동안 그 결과의 편집이 바뀌었으면 덮어쓰지 않고 안내만 남기며(다시 누르면 받아 둔 출력으로 불러옴), 행을 접었거나 필터로 숨긴 대상에는 넣지 않고, 시트를 닫으면 요청을 끊습니다. 문서 구성 대상은 행을 펼칠 때 받아 두어 누르기 전에 막힌 이유나 영향을 보이고, 누르면 그 내용으로 불러옵니다.
  - **문서 구성 영향 경고**: 문서 구성(이력 행 · 최초 원본)을 불러오기 전에, 지금 편집 기준으로 사라지거나 새로 생기거나 페이지 범위가 바뀌는 문서와 그 문서에 연결된 결과를 버튼 아래에 보이고, 불러온 뒤에는 바뀐 문서 · 영향받은 결과 수를 요약합니다. 라벨 · 순서만 바뀌면 경고하지 않고, 불러오기를 막지도 않습니다.
  - **같은 저장 모두 불러오기**: 같은 저장으로 2 건 이상 바뀐 묶음 머리줄의 "모두 불러오기 (N)" 는 그 저장의 행을 내용과 함께 받아(`operation_id`, 20 행씩) 대상마다 가장 큰 version 만 남기고, 문서 구성부터 앞 행을 넣은 편집 기준으로 판정해 넣을 수 있는 것만 한 번에 넣습니다. 결과는 머리줄에 "N건 중 M건" 으로 요약합니다(나머지는 지금 값과 같거나 불러올 수 없음). 시트는 닫지 않습니다.
  - 저장이 끝나면 목록을 처음부터 다시 받아 저장 전에 보던 페이지로 돌아갑니다(최신순은 새 행만큼 한 칸 밀림, 그 페이지까지 블록을 이어 받음). 429 는 `Retry-After` 의 남은 초를 1 초마다 줄여 보이고 그 뒤 "다시 시도" 가 켜집니다(목록 · 행 상세 · 최초 원본 · 묶음 공통).
- **임시 저장·복원**: 저장하지 않은 변경 항목은 편집이 500 ms 멎은 뒤 한 번 브라우저 `localStorage`(`review-draft:{collectionId}:{jobId}`)에 임시 저장합니다(편집이 이어지는 동안은 쓰지 않고, 화면을 떠나거나 탭을 숨기거나 닫을 때는 기다리던 쓰기를 바로 마칩니다. 값 포함 변경 항목만, 2 MiB 까지. 넘으면 저장하지 않고 지난 임시 저장도 지우며 "곧 저장하세요" 안내가 본문 위에 보입니다). 같은 브라우저·프로필에서 그 Job 을 다시 열면 본문 위에 "저장하지 않은 변경 n개 (시각) [복원] [버리기]" 배너가 "편집을 시작하면 이전 임시 저장은 버려집니다" 안내와 함께 뜨고, 복원은 그 항목을 한 번에 더해(하나라도 적용할 수 없으면 아무것도 바꾸지 않고 사유를 보임) 변경 사항을 엽니다. 복원할 변경이 이미 지금 값과 같으면 항목을 만들지 않고 그 사실을 안내합니다(안내하는 수는 실제로 생긴 변경 수). 임시 저장이 기대는 문서 구성·결과 version 이 불러온 문서와 다르면(다른 곳에서 먼저 저장) "서버 내용이 바뀌어 복원할 수 없습니다 [버리기]" 만 보입니다. 배너를 둔 채 편집(값·구성 편집, JSON 가져오기)이 성공하면 배너가 사라지고 지난 임시 저장 대신 새 편집이 임시 저장됩니다(거부된 편집은 배너를 그대로 둡니다). 복원 실패 사유는 배너에만 보이고 JSON 시트의 적용 오류와 섞이지 않습니다. 저장이 반영되거나, 다시 불러오거나, 모두 되돌리기로 항목이 0 이 되면 지웁니다.
- **이탈 확인**: 변경이 있거나 저장 중일 때 앱 안 이동(헤더 돌아가기 화살표, 상단 바 앱 이름(처음 화면), 설정 메뉴 언어 바꾸기, 검수 큐 이전·다음 Job)은 앱 Dialog "이 화면을 떠날까요?" 로 묻습니다(저장 중이면 저장 결과를 이 화면에서 확인할 수 없다는 문구). 첫 포커스는 "머무르기" 이고, Esc·바깥 클릭도 머무르기이며 "나가기" 를 골라야 옮깁니다. 변경 사항 트레이의 충돌 "다시 불러오기" 도 같은 Dialog 로 묻습니다(제목 "최신 상태를 다시 불러올까요?", 확인 버튼 "다시 불러오기"). 탭 닫기·새로 고침은 브라우저 기본 확인 창(`beforeunload`)이 그대로 뜹니다. ⌘/Ctrl 클릭·가운데 클릭으로 링크를 새 탭에 여는 것은 이 화면을 떠나지 않으므로 묻지 않습니다. Dialog 는 `[locale]/layout.tsx` 에 한 번 마운트한 `components/leave-confirm-dialog.tsx` 가 `lib/leave-confirm.ts` 의 요청(한 번에 하나, 새 요청이 오면 앞 요청은 머무르기로 닫음)을 그리고, 마운트되지 않은 화면에서는 브라우저 기본 확인 창으로 답합니다.
- **키보드, 보조 기술**: Tab 순서는 헤더(JSON, 변경 이력, 변경 사항, 저장) → Step 탭 → 문서 목록(라벨 검색 → 상태 선택 → 목록) → (구성 탭) 구조 툴바(끝에 페이지 썸네일, 페이지 정리) → 위치 바 또는 필름스트립 → 이미지 안내 줄의 "다시 시도"(있을 때) → 뷰어 도구(끝에 보기 방식) → 작업 패널(값 탭은 값 필터 칩 → 결과)입니다. Step 탭 사이는 화살표 키로 옮기며, 보기 전용 탭은 화면 낭독기에 "보기 전용" 이 함께 읽힙니다. 뷰어 열에 포커스가 있으면 PageUp, PageDown, Home, End, Alt+↑, ↓ 로 페이지, 문서를 옮기고(위 "뷰어"), 구조 툴바의 앞, 뒤 문서 버튼과 위치 바 ◀ ▶ 는 첫, 끝에서 사라지거나 `disabled` 가 되지 않고 `aria-disabled` 로 남아 포커스가 그 자리에 머뭅니다. "앞 문서로", "뒤 문서로" 도 이웃이 없거나 다른 그룹이면 `aria-disabled` 로 남고 사유가 `aria-describedby` 로 연결됩니다. 입력 오류(숫자, 정수, JSON 파싱, 서버, 저장 전 검증이 가리키는 행)는 `aria-invalid` 와 `aria-describedby` 로 그 입력에 연결됩니다. 위치 바 트랙은 `role="slider"` 로 현재 값("60쪽 중 31쪽")을 읽어 주며 ←→, PageUp, PageDown, Home, End 로 움직입니다(↑, PageUp 이 이전 쪽, 뷰어의 스크롤 방향과 맞춤). 모두 되돌리기를 확인하면 포커스는 트레이 제목으로 갑니다. 상태 변화(저장 진행, 페이지 이미지 진행, 파일 준비 중, 하이라이트 묶음 로딩과 실패, 편집 거절 사유, 구조 툴바의 나누기 실패 사유, 되돌리기에 함께 빠진 변경 수, 모두 되돌린 변경 수, JSON 가져오기 검사 결과와 더한 항목 수, 임시 저장 복원 배너와 복원한 항목 수)는 `aria-live`(또는 `role="alert"`) 영역으로 알립니다. 뷰어 위 하이라이트 영역은 키보드로 순회할 수 없으므로(`image-viewer` 제약) 값의 위치는 필드 입력에 포커스를 주면 뷰어가 보여 줍니다.

### Collection 관계 보기

Collection 목록 머리 줄의 "목록 / 관계" 토글로 표와 관계 그림을 오갑니다. 보기는 주소(`?view=lineage`)에 남아 새로 고침하거나 상세에서 돌아와도 유지됩니다. 관계 그림은 페이지와 필터에 묶이지 않고 서버가 찾은 연결 전체를 보이며, 그동안 정렬 선택과 현황 카드는 숨깁니다. 목록에 없는 자동 생성 기본 Collection 은 다른 Collection 의 원본으로 쓰일 때만 나옵니다.

- **그림**: 왼쪽 Collection 의 결과를 이어 받아 오른쪽 Collection 이 만들어진 흐름입니다. 이어진 Collection 끼리 한 묶음이고 묶음은 위아래로 쌓습니다(목록 순서, 최신 먼저). 열은 가장 긴 경로로 정하고, 열을 건너뛰는 연결은 사이 카드를 피해 지나갑니다. 배치는 `components/showcase/lineage/lineage-layout.ts`(순수 함수) 입니다.
- **연결 이름**: Workflow 의 Import 노드로 이어졌으면 "Import", 고친 결과를 가져왔으면 "결과 가져오기" 입니다. Import 이름에 마우스를 올리면 어떤 Workflow 인지 보입니다.
- **카드**: 이름, 출처, Workflow, Job 수, 검수 진행(표의 "검수" 열과 같은 표시). 누르면 그 Collection 상세로 갑니다. 마우스를 올리거나 키보드로 포커스하면 그 카드의 원본 쪽과 결과 쪽만 남기고 흐려집니다. 같은 원본에서 갈라진 형제는 흐려집니다.
- **못 찾는 경우**: 아직 실행하지 않은 Workflow 의 연결은 나오지 않습니다(결과가 있어야 관계로 칩니다). 연결이 없는 Collection 은 그림에 없고 아래 안내에 수만 나옵니다. Import 원본이 삭제됐거나 권한 밖이면 "볼 수 없는 Collection" 카드로 보입니다. Workflow 를 볼 수 없어 연결을 확인하지 못한 Collection 은 아래 안내에 수가 나옵니다. 일시적으로 일부를 읽지 못했으면 안내와 "다시 읽기" 가 나옵니다. 데이터 출처와 상한은 [BFF 라우트](#bff-라우트) 절의 "Collection 관계 라우트" 에 있습니다.

### 홈 대시보드

검수 기록이 있으면 홈(`src/app/[locale]/page.tsx`)의 소개 아래에 대시보드(`src/components/showcase/home/home-dashboard.tsx`)가 보입니다. 앱 DB 에 검수 중이나 검수 완료 기록이 하나라도 있거나 이 브라우저에서 연 Job 이 있으면 보이고, 둘 다 없으면 홈에는 소개 카드 세 장만 보입니다.

- **검수 현황 카드**: 검수 중인 Job, 검수 완료한 Job, 검수가 진행 중인 Collection 수입니다. Collection 목록 위 카드와 같은 값(앱 DB 전체, 이 서버를 쓰는 모든 사람의 기록)입니다.
- **이어서 검수하기**: 이 브라우저에서 가장 최근에 연 Job 중 아직 검수 중인 Job 의 파일명, Collection 이름, 연 시각과 "Job 열기" 링크입니다. 그런 Job 이 없으면 "Collection 고르기" 링크를 보입니다.
- **최근 검수**: 앱 DB 의 최근 기록과 이 브라우저에서 연 Job 을 합쳐 마지막 활동(상태가 바뀐 시각과 연 시각 중 늦은 것) 순서로 다섯 줄을 보입니다. 줄마다 파일명, Collection 이름, 검수 상태 배지, 상대 시각(마우스를 올리면 날짜와 시각)이 있고 누르면 검수 화면으로 갑니다. Collection 이름과 파일명은 앱 DB 에 없어서 이 브라우저에서 연 Job 만 이름으로, 나머지는 ID 로 보입니다.
- **브라우저 기록**: 검수 화면이 Job 을 불러오면 `localStorage` `review-recent-jobs` 에 `{ collectionId, collectionName, jobId, jobName, openedAt }` 배열(최근 것이 앞, 같은 Job 은 하나, 최대 10 개)로 남깁니다(`src/lib/recent-jobs.ts`, `src/components/showcase/home/recent-jobs-store.ts`). 이름을 모르면 `null` 이고, 전에 남긴 이름이 있으면 이어 씁니다.
- **데이터**: `GET /api/review-activity?limit=8&jobs=collectionId:jobId,...` 가 앱 DB 만 읽어 `{ data, jobs, overview }` 를 돌려줍니다. `data` 는 상태가 최근에 바뀐 순서로 `limit` 행(1 ~ 20, 기본 8), `jobs` 는 물은 Job(최대 10 개, 브라우저 기록) 중 기록이 있는 행(없으면 검수 전), `overview` 는 `/api/review-progress` 의 요약과 같습니다. 행 모양은 `{ collection_id, job_id, review_status, started_at, completed_at, updated_at }` 입니다. 잘못된 쿼리는 `400 invalid_value`(`param` 은 `limit` 또는 `jobs`), DB 오류는 `503 review_status_unavailable` 이고 응답은 `Cache-Control: private, no-store` 입니다.
- **한 화면**: 대시보드가 보이면 소개 카드는 그림과 기능 목록을 뺀 한 줄(`src/components/showcase/home/step-strip.tsx`)로 줄고, 소개 아래 간격과 아래 여백만 줄여(제목 위치는 그대로) 1440x900, 1512x792, 1920x1080 에서 세로 스크롤 없이 들어갑니다. 브라우저 기록이 있으면 검수 기록을 받기 전부터 대시보드 자리(스켈레톤)를 잡고, 최근 검수 목록은 줄이 적어도 다섯 줄 높이를 지킵니다. 다른 화면에서 홈으로 돌아오면 마지막으로 받은 값을 먼저 보이고 새로 받습니다.

### UI Kit 데모 화면

`REVIEW_UI_KIT_DEMO=1` 로 서버를 띄우면 `/{locale}/ui-kit-demo`(`src/app/[locale]/ui-kit-demo/`)에 접근할 수 있습니다. 내비게이션에는 링크가 없으므로 주소를 직접 입력해 들어가고, 플래그가 없으면 이 경로는 404 입니다. 고정 데이터(`demo-data.ts`)와 지역 state 만으로 리뷰 화면용 Studio UI Kit item 13 개(`@/components/studio-ui-kit/<item>` 에서 import)를 그리는 화면이라 검수 모델·BFF·DB 를 쓰지 않습니다 — 파트너가 "item 만 쓰는" 최소 예시로 보고, 이 앱 화면이 쓰지 않는 읽기 전용 모드를 눈으로 확인하는 자리입니다.

```bash
pnpm build
REVIEW_UI_KIT_DEMO=1 PORT=3100 pnpm mock:start   # 또는 REVIEW_UI_KIT_DEMO=1 pnpm dev
# → http://localhost:3100/ko/ui-kit-demo
```

- **보여 주는 것**: `page-position-bar`(표식 3 종) · `document-list` + 필터 바(상태·판정·열어 보지 않은 문서 점·그룹 머리, 거른 목록에서도 원래 번호) · `value-widget`(text · 여러 줄 · 긴 문자열 요약과 "JSON 으로 편집" · number · 정수 · boolean · enum · JSON 스칼라, 확정된 값을 아래 줄에 표시) · `verdict-segment`(판정 세 칸 + 원본 근거 통과·실패, 안내 줄, 고른 값 표시) · `validate-rules`(비교 기호·단어 연산자·집계·속성·범위·중첩 그룹, 모르는 연산자는 원문, 조건을 읽지 못한 규칙) · `page-range-editor`(파일 2 개 · 행 2 개, 데모용 정규식 검사, 확정된 행 표시) · `structure-editor` 의 `Filmstrip` 과 `PageGrid` 를 각각 편집 / `readOnly` 로, 편집 Filmstrip 문서 메뉴 "Move to position…" 에 답하는 `DocumentPositionDialog` · `move-pages-dialog`(범위로 열기 / 선택으로 열기, 마지막 요청 JSON, "실패 응답" 토글) · `parse-table`(병합 칸·그림·걸러질 `script`·`iframe`·인라인 핸들러가 든 고정 HTML, `id` 없이 누른 횟수) · `instruct-markdown`(같은 글을 `InstructCitations` 안 — 칩 선택·hover, 위치 없는 칩 툴팁 — 과 밖 — 표식을 지운 글 — 두 벌, `InstructStructured`, 본문 로드 중 Skeleton `fallback`) · `review-actions`(변경 수·저장 중·충돌을 바꾸는 작은 조작부, 저장 → 저장 문구, 완료 → 다시 열기, `testIds` 없이 `testId` 접미 기본값) · `document-label-field`(select·"라벨 없음" 조건·설정 밖 라벨 표시 / 자유 입력 blur 확정·입력마다 알림 네 조합, 지금 값 표시) · `array-table`(`renderCell` 에 `value-widget` 을 끼운 조합, slot 없이 기본 ＋·되돌리기 버튼, 오류·경고·바뀐 칸·빠진 칸 하나씩, Enter 뒤 표 안 다음 칸 포커스).
- **구조 편집**: 네 view 가 같은 문서 배열 하나를 봅니다. 문서 위치 대화 상자의 범위는 같은 파일 그룹이 이어진 구간이고, 옮기면 같은 배열의 문서 순서를 바꿉니다. 편집 view 의 끌기·✂·메뉴·라벨 편집은 그 배열을 직접 바꾸는 데모용 최소 규칙(`demo-data.ts` `structureEdits`)이라 앱의 저장 판정·검증과 같지 않습니다. 읽기 전용 view 는 편집 view 와 같은 콜백·문구에 `readOnly` 만 더해, 편집 조작부가 모두 사라지고(격자 메뉴 버튼은 비활성으로 남음) 썸네일 클릭·크기 토글만 동작함을 보입니다.
- **페이지 옮기기**: 대화 상자의 제출은 구조를 바꾸지 않고 요청만 아래 줄에 보입니다. "Answer with a failure" 를 켜면 `onMove` 가 `{ ok: false, message }` 를 돌려줘 대화 상자가 닫히지 않고 그 문구를 보입니다.
- **문구**: 데모 전용이라 item `labels` 에 영어 고정 문자열을 넘기고 번역하지 않습니다(host 문구 하드코딩 금지 규칙의 예외, 메시지 파일에 키를 두지 않음).
- **플래그**: 서버 전용 env 를 `connection()` 뒤에 읽으므로 빌드 때 값으로 굳지 않습니다. `NEXT_PUBLIC_*` 를 쓰지 않고, 기본이 꺼짐이라 배포본에 노출되지 않습니다. 화면은 별도 청크로, 다른 페이지가 import 하지 않습니다.
- 스모크 `ui-kit-demo` 시나리오가 이 화면을 확인합니다(플래그가 꺼져 있으면 SKIP).

### 알려진 제약

- **문서 배치 보기(Layout)가 둘 이상이거나 구성 정보가 없는 Job** 은 구성 탭이 읽기 전용이고 값만 고칩니다. 그런 Job 의 문서 구성은 Studio 에서 고치거나 전체 JSON 편집으로 고칩니다.
- 수정할 수 없는 것: 값의 원본 위치(coordinates·bbox), Parse 요소, Instruct 출력. Collection 검수 API 가 받지 않습니다. 값을 바꾼 필드는 저장 뒤 confidence 가 지워지고, 배열 길이를 바꾼 결과는 남은 항목의 위치 정보(하이라이트)가 지워집니다.
- schema 의 `minItems`·`maxItems`·`minLength`·`maxLength` 는 안내만 합니다(배열 한도에 닿으면 추가·삭제 버튼을 비활성화하고 사유를 보이고, 글자 수 한도를 넘으면 그 행에 경고를 보임 — 저장은 막지 않음). 서버도 이들은 검사하지 않습니다. 문서 라벨은 이와 별개로 1~200 자여야 하며 넘으면 서버가 거부합니다 — 화면은 저장 전 검증 요약으로 알리고 저장을 막습니다. 서버 검증은 표준 JSON Schema 검증이 아니어서, schema `properties` 에 없는 필드·`required` 누락·허용되지 않은 `null` 을 거부합니다 — 화면도 같은 규칙으로 저장 전에 알립니다. null 을 허용하는 필드의 형식 오류는 `string | null` 처럼 허용 형식을 함께 보입니다.
- **불러온 문서에 이미 빠진 페이지**(어느 문서에도·제외에도 없는 페이지)가 있으면 필름스트립의 "빠진 페이지" 칸에 보입니다. 그 칸의 메뉴 "새 문서로" 나 다른 문서의 페이지 범위에 넣어 채워야 저장 검증을 통과합니다.
- 합치기는 끈 문서의 페이지를 놓은 문서 끝에 붙이고 끈 문서를 지웁니다(메뉴 "앞 문서와 합치기" 는 그 문서를 앞 문서에 붙입니다). 제외한 페이지는 원래 문서를 기억하지 않고, 되돌릴 때 고른 문서로 들어갑니다.
- 페이지를 모두 옮기거나 제외해 비게 된 문서는 지웁니다(제외 문서도 같음). 서버가 페이지 없는 문서를 받지 않기 때문입니다.
- 제외 문서의 결과는 잠그지 않습니다. 저장 뒤 결과 연결은 서버가 다시 판정합니다.
- **파일 그룹 이동**: 같은 Job 안에서만, 같은 문서 분류 Step 을 쓰는 그룹 사이에서만 됩니다. 그 파일과 다른 파일을 함께 쓰는 문서가 있으면 옮길 수 없고(먼저 그 문서의 페이지 범위를 고칩니다), 파일이 하나뿐인 그룹은 새 그룹으로 분리하지 않습니다. 그룹은 이름이 없어 순서 번호("그룹 n")로 보입니다. 파일 이동만 한 문서는 문서 목록에 "바뀜" 표시가 없습니다(변경 사항에는 항목이 있습니다).
- Merge(`field_groups`) 결과에는 추출값 하이라이트가 없습니다(Job 응답의 Extract 항목과 짝이 없음).
- 값 탭은 한 Step 의 결과만 보이므로, 여러 Step 의 값을 비교하려면 탭을 오갑니다. 검수 JSON 의 Step 목록에는 Studio 에서 사람이 바꾼 이름(`custom_name`)이 없어 탭 이름은 Step 원래 이름에서 prefix 만 뗀 것입니다.
- Parse 탭과 Parse 하이라이트는 Job 응답의 첫 Parse 출력 기준입니다. 목록과 뷰어 영역은 같은 요소를 파일 로컬 쪽 번호와 요소 id 로 짝짓습니다. Job 응답의 Parse 요소와 파일 응답의 요소 id 가 다른 파일(Collection 이 복사하지 않은 파일에 자체 Parse 가 있는 경우)은 목록과 뷰어 영역이 서로 짝을 찾지 못할 수 있습니다. Parse 요소는 글자(`content.text`, 없으면 markdown·html 의 글자. Document Parse 가 그림 자리에 넣는 `![image](/image/placeholder)` 는 어디에 있든 뺍니다)와 그림 요소의 이미지, 표 요소의 표만 보입니다. 표는 `content.html`(20 만 자 이하)을 `html-react-parser` 로 읽어 허용 목록의 태그(`table thead tbody tfoot tr th td caption colgroup col br`, 중첩 6 단계까지)와 칸의 `colspan`·`rowspan`(정수)만 React 요소로 다시 만듭니다. `id`·`style`·이벤트 속성·링크 주소는 버리고, `script`·`style`·`iframe` 같은 태그는 내용까지 버리며, 그 밖의 태그는 글자만 남깁니다. 표 안 그림은 받지 않고 `alt` 글자만 흐리게 보입니다. 표가 하나도 나오지 않거나 길이 상한을 넘으면 그 요소는 글자로 보입니다. 그림 이미지는 Parse Step 이 `base64_encoding` 으로 요청한 종류(기본값 `figure`)에만 실립니다.
- Instruct 본문은 Job 응답 `text` 가 JSON 문자열이면 풀어서(Studio 와 같은 규칙), JSON 객체·배열이면 필드별로 보입니다. markdown 은 원시 HTML 을 그리지 않고, 이미지는 대체 글자만 보이며, 링크는 새 탭으로 엽니다. 인용 위치를 모르면 칩이 비활성입니다. 인용 데이터는 review JSON 이 아니라 Job 응답의 Instruct 출력(`additional_values.citations`)에서 읽습니다 — review API 는 Instruct 결과를 다루지 않습니다(그래서 탭이 보기 전용). JSON 출력의 필드 이름은 schema 키 그대로입니다.
- 전체 JSON 은 16 MiB 를 넘는 파일을 읽지 않고, 2 MiB 를 넘으면 편집이 느릴 수 있다고 안내합니다. 검사(파싱·비교)는 메인 스레드에서 합니다. 문서 분류 Step 연결(`layout_step_id`)을 바꾼 파일은 적용은 되지만 문서·결과 연결이 바뀔 수 있다고 알립니다. 없거나 문서 분류가 아닌 Step 을 가리키면 서버가 거부하므로 저장 전 검증이 막습니다.
- 앱 안에서 브라우저 뒤로 가기로 떠나는 경우는 확인 창이 뜨지 않습니다.
- 임시 저장은 같은 브라우저·프로필에서만 보이고, 두 탭이 같은 Job 을 열어 고치면 마지막에 쓴 쪽만 남습니다. 복원 배너를 둔 채 첫 편집을 하면 지난 임시 저장은 버려지므로(배너 문구로 미리 알림) 지난 변경이 필요하면 먼저 복원합니다. 쓰기는 500 ms 디바운스이므로 편집 직후 브라우저가 비정상 종료(crash)하면 마지막 500 ms 안의 편집은 남지 않을 수 있습니다(탭 닫기·숨기기·이동은 그 자리에서 씁니다). 저장소를 쓸 수 없는 환경(사생활 보호 모드·차단)에서는 조용히 꺼집니다. 저장소가 가득 차 쓰기를 거부하면 지난 임시 저장을 지우고(다시 열었을 때 낡은 변경을 복원하지 않도록) "이 탭을 떠나기 전에 저장하세요" 배너로 알립니다.
- 값 폼과 Instruct 출력은 가상화하지 않습니다. 값 폼은 50 개 넘는 배열을 50 개씩 "더 보기" 로 그리고 "바뀐 값만"·"현재 페이지 값만" 필터로 행을 줄이는 것으로 보완하며(Parse 요소 목록은 50 개씩 더 보기 + "현재 페이지만"), 필드가 수천 개인 결과는 묶음을 접어 두지만 필터를 끈 채 모두 펼치면 스크롤이 느려질 수 있습니다. 검수 JSON 파싱은 메인 스레드에서 합니다.
- 뷰어 단축키(PageUp·PageDown·Home·End·Alt+↑·↓)는 뷰어 열에 포커스가 있을 때만 동작하고, 입력 요소 안과 Shift·Ctrl·⌘ 조합은 가로채지 않습니다.
- 주소의 `?doc&page` 는 선택이 바뀐 뒤 300 ms 에 적고 페이지가 숨겨지거나 내려갈 때 바로 적으므로, 그 사이에 브라우저가 강제로 끝나면 직전 자리로 열립니다. 헤더 설정 메뉴의 언어 전환은 주소 query(`?doc&page`, 목록의 정렬·필터·페이지)를 유지합니다. 문서 배치 보기(Layout)가 둘 이상인 Job 에서는 같은 `document_id` 가 있는 첫 보기의 문서를 고릅니다.
- 위치 바의 "검증 문제" 표식은 검증이 계산될 때(구성 탭이거나 변경 사항이 열려 있을 때)만 보입니다 — 값을 고칠 때마다 전체 검증을 돌리지 않습니다. 위치 바 트랙의 ↑·PageUp 은 이전 쪽으로, ARIA slider 기본(증가)과 반대입니다.
- 문서 목록이 100 행을 넘어 창(윈도잉)으로 바뀌면 좁은 화면(`xl` 미만)에서도 가로 줄이 아니라 세로 목록이고 `maxHeight` 로 잘립니다. 필터로 가려진 문서도 Alt+↑·↓ 로 지나가며, 그때 목록에는 선택 행이 없고 요약 줄 아래 안내와 "필터 지우기" 만 보입니다.
- 필름스트립 이웃 보기에서 접힌 이웃 띠의 썸네일 메뉴는 "다른 문서로"·"제외" 만 둡니다("왼쪽으로"·"오른쪽으로" 의 결과가 접힌 영역으로 들어가 보이지 않기 때문). 그 띠 안 순서를 바꾸려면 띠 제목을 눌러 그 문서를 펼칩니다. 필름스트립의 문서 순서 조작(드래그·"앞/뒤 문서로"·"위치 지정…"·"페이지 옮기기…")은 같은 파일 그룹 안에서만 됩니다 — "위치 지정…" 은 그 문서가 속한, 같은 그룹이 이어진 구간의 번호만 받습니다. 그룹 밖으로 옮기려면 JSON 을 직접 고칩니다. 빠진 페이지 띠는 빠진 페이지가 0 개에서 생길 때만 저절로 펼쳐지고(불러올 때 이미 있던 빠진 페이지는 칩으로 접힌 채), 제외·빠진 페이지 띠의 펼침 상태는 화면을 떠나면 다시 접힙니다.
- 페이지 정리 화면의 격자는 화살표 키로 썸네일 사이를 오가지 않습니다(Tab 은 그려진 셀의 버튼·메뉴 순서이고, 창 밖 행은 DOM 에 없습니다). 페이지 이동·되돌리기와 문서 순서 조작은 필름스트립과 같이 같은 파일 그룹 안에서만 됩니다("위치 지정…" 도 같은 그룹이 이어진 구간의 번호만 받습니다). 정리 화면이 열려 있는 동안 구성 작업 패널·필름스트립 띠가 숨으므로 라벨 외의 패널 기능(페이지 범위·새 문서로 분리·파일 그룹·검증 요약)은 정리 화면을 닫고 씁니다. 고른 페이지를 새 문서로 분리하는 것은 정리 화면에서도 일괄 바 "새 문서로 분리…" 로 됩니다. 메뉴·드래그로 다른 문서나 제외 칸으로 보낸 페이지는 그 자리가 창 밖이면 바로 보이지 않습니다(제외는 맨 아래 칸으로 가고, 뷰어 선택은 원본 문서가 비어 없어질 때만 옮긴 페이지를 따라갑니다). 여러 장 선택은 정리 화면의 지역 상태라 정리 화면을 닫거나 다른 구성 탭으로 가면 사라지고, 편집으로 없어진 페이지는 선택에서 빠집니다. 제외 칸·빠진 페이지 칸의 셀과 겹친 페이지·잠긴 문서의 페이지는 고를 수 없고(클릭하면 뷰어만 이동하며, Shift 범위도 그 페이지를 건너뛰어 고른 장 수가 보이는 범위보다 적을 수 있습니다), 여러 파일 그룹에 걸친 선택은 옮기기·새 문서로 분리가 막힙니다(제외는 됩니다). 옮기기 대상 문서에 든 고른 페이지는 그 자리에 남습니다. 여러 장 끌기는 문서 셀만 됩니다(제외 칸 셀은 한 장씩, 빠진 칸 셀은 끌 수 없음). 여러 파일 그룹에 걸친 선택은 어느 문서에도 놓을 수 없습니다(제외 칸에는 됩니다). 끌 때 포인터 옆 장 수 배지는 브라우저에 따라 보이지 않을 수 있습니다(격자 바닥 줄은 늘 보임). 일괄 조작의 항목 하나만 따로 되돌릴 수는 없습니다.
- "페이지 옮기기…" 의 "특정 페이지 앞" 번호는 옮길 문서 안의 순번(1‥n+1)이고 원본 페이지 번호(`{page}p`)가 아닙니다. 입력 칸 라벨에 이 범위("옮길 문서 안 순번 (1–n+1)")를 함께 보입니다.
- "현재 페이지 값만" 중에는 위치 정보가 없는 값(`additional_values` 에 없는 필드)과 빈 배열·객체가 숨겨집니다(방금 추가한 항목은 선택 행이라 보이지만 다른 행을 고르거나 행 밖을 눌러 선택이 풀리면 숨겨집니다). "바뀐 값만" 만 켜면 원본과 달라진 배열·객체(항목을 모두 지운 배열 등)는 머리만이라도 보이며, "n개 숨김"·변경 수는 값(leaf) 기준 그대로입니다. "바뀐 값만" 에서 Enter 로 다음 행에 포커스가 가면 그 행이 선택 행이 되어 잠깐 보입니다. 큰 배열에서 넓힌 범위는 화면을 새로 고치면 50 개로 돌아갑니다.
- Parse 탭 "현재 페이지만" 의 기본값은 그 탭이 처음 열릴 때의 문서 쪽수로 정해지고(10 쪽 초과면 켜짐), 한 번 바꾸면 그 선택을 기억합니다.
- 추출값·Parse 좌표의 `page` 는 Job 입력 파일을 `input_index` 순으로 이어 붙인 1-based 번호로 읽습니다(`src/lib/review-model/viewer.ts` `MERGED_PAGE_BASE`). 화면은 이를 파일·파일 안 페이지로 나눠 그립니다. 페이지 수를 알 수 없는 입력 파일이 있거나(Job·파일 응답 모두에 `num_pages` 가 없음) `input_index` 가 0 부터 끊김 없이 이어지지 않는 Job 은 그 Job 의 추출값·Parse 하이라이트를 그리지 않습니다(값은 그대로 보입니다).
- 페이지 이미지 서명 URL 은 파일 BFF 가 10 분 캐시합니다. 화면을 오래 열어 두어 만료된 URL 의 이미지(뷰어, 필름스트립, 페이지 정리 썸네일)가 로드에 실패하면 그 파일의 이미지 URL 을 `?refresh=1` 로 저절로 다시 받습니다(같은 파일은 1 분에 한 번까지). 다시 받기에 실패한 파일과 아직 준비 중인 파일은 뷰어 위 안내 줄의 "다시 시도" 로 다시 받습니다. 파일 Parse 하이라이트는 Parse 탭에서 현재 페이지 주변 묶음만 받으므로, 뷰어가 다른 페이지로 가면 그 묶음을 받을 때까지 잠깐 Job 응답의 Parse 좌표(있으면)만 보입니다. 아직 준비 중인(`READY` 가 아닌) 파일은 원본을 캐시하지 않아 묶음 요청마다 upstream 을 다시 부릅니다.
- Job 응답은 Parse 그림 요소 이미지(`base64_encoding`)만 서버가 떼어 `figure_url` 로 바꾸고 나머지는 그대로 전달하므로 여전히 수 MB 일 수 있고(요소 글자·좌표·`html`·`markdown`), Step 결과 파일의 서명 URL 이 들어 있을 수 있습니다([환경 변수](#환경-변수) 절의 "로컬·신뢰된 네트워크에서만 띄운다" 전제). 64 MiB 를 넘는 응답은 받지 않습니다(`502 response_too_large`). 떼어 둔 그림은 서버 프로세스 메모리에만 10 분·128 MiB 까지 있어, 그 뒤(또는 서버 재시작·여러 인스턴스 사이)에는 그림 자리가 숨겨지고 Job 응답을 다시 받으면 돌아옵니다. 화면은 Parse 요소에서 글자·위치·그림 URL 과 표 요소의 `html` 만 남기고 나머지는 버립니다.
- 저장이 반영되면 늘 검수 문서와 Job 응답을 다시 불러옵니다. 충돌 상태에서도 저장 버튼은 눌리며, 다시 불러오지 않고 저장하면 다시 충돌합니다.

### 실제 키로 확인하는 절차

실제 API 키로 BFF 와 화면을 확인하는 순서입니다. 마지막 단계는 데이터에 쓰므로 **테스트용 Collection 에서만** 합니다.

```bash
pnpm build && pnpm start     # .env 의 실제 키. pnpm dev 로 띄우면 Job 화면이 반복 새로 고침되는 경우가 있다
C=scol_…; J=job_…; F=file_…  # 목록 응답에서 고른 Collection·Job·파일 ID
curl -s "http://localhost:3000/api/search-collections?kind=documents&include_default=true&limit=5" | head -c 400
curl -s "http://localhost:3000/api/search-collections/$C" | head -c 400
curl -s "http://localhost:3000/api/search-collections/$C/source-jobs?status=completed&group_by=input_files&limit=5" | head -c 400
curl -s "http://localhost:3000/api/search-collections/$C/source-jobs/$J/files"
curl -s "http://localhost:3000/api/files/$F" | head -c 600      # file_url·elements 원문이 없어야 한다
curl -s "http://localhost:3000/api/search-collections/$C/source-jobs/$J/response" | grep -c base64_encoding   # 0 이어야 한다(그림은 figure_url)
curl -sI "http://localhost:3000/api/search-collections/$C/source-jobs/$J/figures/f1" | grep -iE "^HTTP|content-type|x-content-type-options"   # 그림이 있는 Job 이면 200 image/* · nosniff
curl -D - -s "http://localhost:3000/api/search-collections/$C/review-document?job_ids=$J" -o review.json
```

확인할 것:

- 모든 응답에 `Cache-Control: private, no-store` 가 있고 `Authorization` 이나 upstream 전용 헤더가 없다. 서버 로그에 키·`Bearer` 가 찍히지 않는다.
- 파일 응답에 `file_url`·`elements` 가 없고 `image_url` 은 `https:` 다.
- `figures` 응답에 `X-Content-Type-Options: nosniff` 가 있다.
- Job 응답의 추출값 `page` 가 1 부터 시작하는 병합 페이지 번호다(두 번째 파일 첫 페이지의 값을 화면에서 눌렀을 때 그 파일 이미지 위에 영역이 그려진다).
- 화면: 목록 → Job → 문서·페이지 전환, Step 탭 순서·배지·이름, 값 수정 → 변경 사항 항목, 구성 탭 조작, `/ko`·`/en`·`/ja` 문구.
- 화면(읽기, 편집 기능):
  - 값 트리: 배열 항목 추가 → 새 행에 포커스 → 값 입력 → 변경 사항 2 항목 → 항목 추가를 되돌리면 값 수정도 함께 빠지고 안내가 1 번 보인다 / 빈 배열에 추가 / "필드 추가" 목록이 schema 에 있고 값에 없는 필드다 / 비우기 → "값 없음" / 필수 필드에는 "필드 삭제" 가 없다 / "JSON 으로 편집" → 변경 사항 "전체 값 교체".
  - 구성: 페이지 범위를 줄이면 빠진 페이지 칸과 검증 요약이 보이고, 다른 문서 범위에 넣으면 통과한다 / 문서 제외 → 띠가 흐려지고 목록에 제외 아이콘, 빠진 페이지로 세지 않음 → 복귀 / 새 문서로 분리(다른 문서 페이지를 적으면 옮겨 오고 원 문서가 비면 사라짐, 트레이에 가져온 쪽수 표시) / 제외 페이지 → "새 문서로".
  - Step 탭: 결과 없는 Step 은 탭이 없다 / 탭 화살표 키 이동 / Classify 탭 = 필름스트립·구성 편집, Extract 탭 = 그 Step 값만, Merge 결과 탭은 배지 Merge / 저장 중 탭 비활성 / Parse·Instruct 출력이 있는 Job 에서 그 탭이 보이고 편집 UI 가 없다 / Parse 탭 요소를 누르면 뷰어가 그 페이지로 가서 영역을 강조하고, 뷰어 영역을 누르면 목록이 그 항목으로 스크롤한다(입력 파일이 둘 이상인 Job 의 둘째 파일도) / Parse 탭의 그림 요소에 이미지가 보이고 누르면 뷰어가 그 위치로 간다 / Parse 탭의 표 요소가 표로 보이고 "원문 보기" ↔ "표로 보기" 가 바뀐다 / 분류가 `split` 인 Job 에서 문서를 바꾸면 그 문서의 Step 탭만 남고, 보던 값 탭이 숨으면 그 문서의 첫 값 탭으로 옮긴다 / Step 탭 줄이 화면 가운데에 있고 고른 탭만 떠 보인다 / 값 탭을 열면 뷰어에 아무 영역도 없고, 행을 가리키면 그 영역만, 고르면 그 영역만 남는다 / Instruct 탭 markdown(제목·굵게·목록·줄바꿈)·인용 칩 가리키기 → 미리 보기, 누르기 → 원본 위치 / JSON 출력은 필드별로 보이고 문자열 안 인용 칩이 동작한다 / 결정 상자.
  - 모두 되돌리기: 여러 곳을 고친 뒤 트레이 "모두 되돌리기" → 확인 → 항목 0·값 원래대로·저장 버튼 비활성·"변경 사항 n개를 모두 되돌렸습니다" / 취소하면 그대로.
  - 전체 JSON: 원본·편집본 다운로드 파일 내용 / 편집본에서 값 하나·배열 항목 하나·문서 라벨 하나를 고쳐 가져오기 → 변경 사항에 해당 항목, 고급 접기의 업로드 본문에는 바뀐 결과·구성만 / `base_version` 을 바꾼 파일 → 거부 / `state` 를 바꾼 파일 → 경고 후 적용.
- (쓰기, 테스트 Collection) 값 하나를 고쳐 저장 → 네트워크 탭에서 `review-imports` `202` 와 `Retry-After` 간격 polling → "저장됨 · revision n" 후 고친 값이 남아 있다 / 같은 수정을 다시 저장 → "바뀐 내용 없음" / 문서를 나눠 저장 → 새 문서에 결과가 연결되고 원 결과가 잠긴다 / 다른 탭에서 먼저 저장한 뒤 저장 → 충돌 표시와 다시 불러오기 → 모두 되돌리기 뒤에도 다시 불러오기 안내가 남는다.
- (쓰기, 테스트 Collection, 편집 기능)
  - 배열 항목을 추가해 저장 → 다시 불러온 뒤 그 항목이 남아 있고, 그 결과의 남은 항목 하이라이트가 지워졌는지 확인한다.
  - 문서를 제외해 저장 → 다시 불러온 뒤 그 문서가 제외로 남고, 그 문서 결과의 연결 상태(잠김·연결 없음 등)를 확인한다.
  - 전체 JSON 가져오기로 만든 변경을 저장 → 반영 확인.
  - 그룹이 둘 이상인 Job 에서 파일을 다른 그룹(또는 새 그룹)으로 옮긴다 → 필름스트립 그룹 경계가 바뀐다 → 저장 → 다시 불러온 뒤 그룹 구성이 그대로인지 확인한다.

## UI 스택 (shadcn/ui · Studio UI Kit 호환)

이 앱은 Review 기능 Demo App 입니다. 리뷰 화면 부품은 Studio UI Kit item 이고, 이 앱은 그 item 을 다른 소비자와 같은 공개 Registry 로 설치해 씁니다([Studio UI Kit item 설치](#studio-ui-kit-item-설치) 절). 그래서 **Studio UI Kit 외부 소비자와 같은 환경**(shadcn 표준 환경)으로 구현하고, 그 밖의 디자인 시스템 패키지는 쓰지 않습니다.

앱 아이콘(`src/app/favicon.ico`, `src/app/icon.svg`)은 Upstage 브랜드 에셋입니다([라이선스](#라이선스) 절).

| 항목         | 값                                                                                   |
| ------------ | ------------------------------------------------------------------------------------ |
| React        | 19.2                                                                                 |
| Tailwind CSS | 4.3                                                                                  |
| shadcn CLI   | **4.21.0 고정** (Studio UI Kit 이 검증한 버전)                                       |
| shadcn style | `radix-nova` (Radix base, nova preset)                                               |
| 아이콘       | lucide (`lucide-react`)                                                              |
| baseColor    | neutral                                                                              |
| `cn`         | `cn` 패키지 — `src/lib/utils.ts` 는 `export { cn } from "cn"`                        |
| 테마         | `src/app/globals.css` 의 shadcn 표준 토큰(`:root`·`.dark`). 다크 토글은 아직 없음 |

**Studio 외형 맞춤**: `globals.css` 의 shadcn 표준 토큰 **값**을 Upstage Studio 화면과 같은 팔레트로 맞춰, 같은 컴포넌트가 Studio 화면처럼 보이게 합니다.

- 색: primary 는 brand-500(보라 파랑), 글자와 회색은 slate 계열 neutral, destructive 는 red-400, 포커스 링은 brand-500. 이름이 같아도 역할을 따릅니다(Studio 디자인 시스템(DS)의 secondary 는 연두 강조색이지만 shadcn secondary 는 옅은 보조 배경이므로 DS muted 값을 씁니다).
- 둥글기 4, 6, 8, 12px(`rounded-sm`, `md`, `lg`, `xl`), 글꼴은 Studio 와 같은 시스템 글꼴(ID 등 고정폭만 Geist Mono), 그림자는 DS 의 옅은 남색 그림자.
- host 전용 확장 토큰: `bg-subtle`, `bg-muted-light`, `bg-muted-medium`, `text-muted-dark`, `border-border-medium`, `text-link`, `state-{success,warning,error}`(각각 `-background`, `-foreground` 포함), 워크플로우 노드 색 `--node-*`. Studio UI Kit item 은 외부 소비자에 없는 이 토큰을 쓰지 않고 shadcn 표준 토큰만 씁니다.
- 목록 표는 `src/components/studio-table.ts` 의 `STUDIO_TABLE_CLASS` 를 `<Table className>` 에 넘겨 Studio DataTable 모양(회색 머리 행 40px, 머리글 12px 중간 굵기 `text-muted-dark`, 셀 좌우 12px)으로 그립니다. 목록 표 이름은 400 굵기, 보조 값은 `text-muted-dark`, `tabular-nums` 는 쓰지 않습니다.
- 버튼 높이는 Studio DS 에 맞춰 화면 머리와 도구 줄은 `size="default"`(32px, DS sm), 화면의 주 동작은 `size="lg"`(36px, DS 기본)를 씁니다. `src/components/ui/*` 는 고치지 않습니다.
  - 예외: 버튼이 여럿 모이는 조밀한 도구 줄(Job 화면의 구조 툴바, 페이지 정리 화면 머리·선택 바, 검수 큐 바, 변경 트레이 머리)과 값 트리·뷰어 안의 보조 버튼(필드 추가, 더 보기, 다시 시도 등)은 `size="sm"`(28px)을 씁니다. 32px 로 올리면 좁은 폭에서 줄바꿈이 늘기 때문입니다.

### 색을 입힌 방식

**UI 컴포넌트에는 색이 들어 있지 않습니다.** 화면에 보이는 보라 파랑은 이 앱의 `src/app/globals.css` 가 따로 입힌 것입니다.

1. 컴포넌트는 색 값이 아니라 **토큰 이름**만 씁니다. 예를 들어 Studio UI Kit item 의 판정 선택(`verdict-segment`)은 고른 칸을 `bg-primary text-primary-foreground` 로, 포커스 표시를 `ring-ring` 으로 그립니다. hex·`hsl()`·팔레트 색(`violet-500` 등)은 item 에 없습니다.
2. 토큰의 **값**은 `globals.css` 의 `:root` 한 곳에 있습니다. 여기서 Studio 팔레트 값을 넣었기 때문에 보라 파랑으로 보입니다.

   | 토큰                             | 이 앱의 값                    | 화면에서 보이는 곳                  |
   | -------------------------------- | ----------------------------- | ----------------------------------- |
   | `--primary`                      | `hsl(243 100% 66%)` brand-500 | 주 동작 버튼, 고른 항목, 바뀜 표식  |
   | `--ring`                         | `hsl(243 100% 66%)` brand-500 | 키보드 포커스 테두리                |
   | `--accent`·`--accent-foreground` | brand-50 · brand-800          | 메뉴에서 가리킨 항목, 옅은 강조 배경 |

3. `globals.css` 의 `@theme inline` 블록이 이 값을 Tailwind 클래스(`bg-primary`, `ring-ring` …)에 연결합니다.

그래서 색을 바꿀 때는 컴포넌트를 고치지 않습니다.

- **이 앱의 색을 바꾸려면** `globals.css` `:root` 의 토큰 값만 고칩니다. `--primary` 를 바꾸면 버튼·고른 항목·바뀜 표식이 한꺼번에 바뀝니다. 포커스 테두리도 같이 바꾸려면 `--ring` 을, 옅은 강조 배경은 `--accent` 를 함께 고칩니다.
- **다른 앱에 Studio UI Kit item 을 설치하면** 그 앱의 테마 토큰 값으로 그려집니다. shadcn 기본 테마(neutral)라면 주 동작 색은 보라가 아니라 검정에 가까운 무채색입니다. 브랜드 색을 쓰려면 그 앱의 `--primary`·`--ring`·`--accent` 에 값을 넣습니다.
- 컴포넌트에 색 props 를 넘기거나 `className` 으로 색을 덮어쓰는 방식은 쓰지 않습니다.

토큰으로 정하지 않는 색은 두 가지입니다.

- **Studio 확장 토큰과 Step 트랙 색**(`bg-subtle`, `text-muted-dark`, `state-*`, `--node-*`): 위 "Studio 외형 맞춤" 의 host 전용 토큰입니다. host 화면에서만 쓰고 Studio UI Kit item 에는 없습니다.
- **뷰어 하이라이트 색**: Studio UI Kit `image-viewer` item 이 props 로 받습니다(넘기지 않으면 그 item 의 기본 상수).

### 폴더 역할

| 경로 | 역할 | 규칙 |
| --- | --- | --- |
| `src/components/ui/` | shadcn primitive (CLI 설치) | CLI 가 관리한다. 수정·포맷 금지(ESLint·Prettier 제외), 변형은 사용처 `className` |
| `src/components/studio-ui-kit/` | Studio UI Kit Registry item (CLI 설치) | CLI 가 관리한다. 수정·포맷 금지(ESLint·Prettier 제외). 최신 item 이 필요하면 새 릴리스로 다시 설치한다([Studio UI Kit item 설치](#studio-ui-kit-item-설치) 절) |
| `src/test/studio-ui-kit/<item>/` | 설치한 item 의 이 앱 테스트 | vendor 폴더는 설치 결과 그대로 두므로 테스트는 그 밖에 둔다. item 내부 파일도 `@/components/studio-ui-kit/<item>/<file>` 로 import |
| 그 외 `src/**` | host 코드 (페이지·래퍼) | `@/components/ui/*`·`@/lib/utils` 를 직접 import. 문구는 next-intl, 내부 링크는 `@/i18n/navigation` |

### shadcn primitive 추가

```bash
npx -y shadcn@4.21.0 add <item> --dry-run   # 바뀔 파일·의존성 먼저 확인
npx -y shadcn@4.21.0 add <item>
```

CLI 버전은 항상 `@4.21.0` 으로 고정합니다. Studio UI Kit 이 설치·빌드를 검증한 버전이고, 다른 버전은 같은 item 을 다른 내용으로 받을 수 있습니다. 받은 파일은 포맷하지 않습니다 — 내용이 같아야 다음 설치에서 `skip (identical)` 로 인식됩니다.

`package.json` 의 `shadcn` 패키지(`globals.css` 가 `shadcn/tailwind.css` 를 import)도 같은 `4.21.0` 으로 고정합니다. `init` 이나 style 재적용 시 CLI 는 이 패키지를 버전 없이 추가해 최신 버전이 잡히므로, 그 뒤에는 `4.21.0` 으로 되돌리고 `pnpm install` 로 lock 을 갱신합니다.

### Studio UI Kit item 설치

설치 절차는 Studio UI Kit 공개 안내 페이지(https://console.upstage.ai/ui-kit)의 "시작하기" 를 따릅니다. 여기에는 이 앱에 해당하는 사항만 적습니다.

1. **Registry 주소**: `components.json` 의 `registries` 에 공개 Registry 의 고정 릴리스 URL(`…/r/releases/<releaseId>/{style}/{name}.json`)을 적어 두었습니다. releaseId 는 아래 표의 값입니다. 자기 프로젝트에 설치할 때는 안내 "시작하기 > 3. Registry 등록" 의 기본 주소(`…/r/latest/{style}/{name}.json`, 설치 시점의 최신 공개 릴리스)를 쓰고, 이 앱과 같은 릴리스를 받으려면 안내 "업데이트 > 공개 릴리스 이력" 의 고정 주소를 씁니다. 이 앱을 새 릴리스로 옮길 때는 releaseId 만 바꿉니다(안내 "업데이트").
2. **확인**: `npx -y shadcn@4.21.0 search @studio-ui-kit` 가 item 목록(16 개)을 보여야 합니다.
3. **설치**: `npx -y shadcn@4.21.0 add @studio-ui-kit/<item>` — 파일은 `src/components/studio-ui-kit/<item>/` 에 들어갑니다.
   - **터미널에서 직접 실행**하고, 기존 파일 덮어쓰기 질문에는 **"n"** 으로 답합니다.
   - CI·AI 코딩 에이전트처럼 터미널 없이 실행하면 질문에서 exit 0 으로 끝나 파일이 생기지 않습니다. 안내 "시작하기 > 터미널 없이 설치해야 할 때" 의 `--dry-run` → `--overwrite` → `~ overwrite` 로 표시된 파일 `git restore` 절차를 씁니다.
4. **설치 후**: `git status` 로 `src/components/ui/` 의 primitive 가 바뀌지 않았는지, item 폴더에 `LICENSE.txt` 가 함께 설치됐는지 확인하고 `pnpm build` 를 돌립니다.

- **item 사용법**: 안내 페이지에 item 별 사용 가이드(미리보기·예제 코드·props·`labels`·DOM 계약)와 여러 item 을 잇는 조합 예제가 있습니다. 이 앱이 검수 모델·BFF 와 이어 쓰는 모습은 host 코드(아래 표의 "쓰는 곳"), item 렌더 테스트(`src/test/studio-ui-kit/<item>/`), [UI Kit 데모 화면](#ui-kit-데모-화면)에서 봅니다.
- **문의**: 설치·화면 문제는 안내 페이지 "지원" 의 확인 항목과 문의 경로를 따릅니다.

설치한 item(15 개). 리뷰 화면 item 13 개 중 `structure-editor` 한 item 이 `Filmstrip`·`PageGrid`·`DocumentPositionDialog` 를 내보냅니다. 경로는 모두 `src/components/studio-ui-kit/<item>/`, 쓰는 곳은 `src/components/job-review/` 기준이고, 리뷰 화면 item 13 개는 UI Kit 데모 화면(`src/app/[locale]/ui-kit-demo/`)도 씁니다. 공개 API 는 각 item `index.ts` 가 내보내는 것만 씁니다.

표의 releaseId 는 모두 `components.json` 의 `registries` URL 에 있는 값과 같습니다.

| item | 공개 export | 함께 설치되는 shadcn item | npm 의존 | 쓰는 곳 | releaseId |
| --- | --- | --- | --- | --- | --- |
| `image-viewer` | `ImageViewerSection` | 없음 | `react-aria`·`react-stately`·`react-resize-detector` | 문서 뷰어(`document-viewer.tsx`). 파일은 `studio-ui-kit/image-viewer/`·`studio-ui-kit/shared/` | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `document-element-list` | `DocumentElementList` | 없음 | 없음 | 값 패널의 Parse 탭(`parse-tab.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `document-list` | `DocumentList`·`DocumentListFilter` | button·input·select·tooltip | 없음 | 문서 목록 열(`job-review-screen.tsx`·`document-list-filter.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `page-position-bar` | `PagePositionBar` | button·input | 없음 | 페이지 위치 바(`page-position-band.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `value-widget` | `ValueWidget` | button·input·select·switch·textarea | 없음 | 값 입력(`value-widget.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `structure-editor` | `Filmstrip`·`PageGrid`·`DocumentPositionDialog` | badge·button·dialog·dropdown-menu·input | 없음 | 구성 탭 띠(`structure-band.tsx`), 페이지 정리 격자(`organizer-band.tsx`), 문서 위치 대화 상자(`document-position-dialog.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `array-table` | `ArrayTable` | button | 없음 | 배열 값 표(`array-table.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `review-actions` | `ReviewActions` | badge·button | 없음 | 저장·완료 버튼 줄(`job-review-header.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `document-label-field` | `DocumentLabelField` | input·select | 없음 | 라벨 칸(`structure-panel.tsx`·`new-document-dialog.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `move-pages-dialog` | `MovePagesDialog` | button·dialog·input·select | 없음 | 페이지 옮기기 대화 상자(`move-pages-dialog.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `verdict-segment` | `VerdictSegment` | 없음 | 없음 | Validate 판정(`result-section.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `page-range-editor` | `PageRangeEditor` | button·input·select | 없음 | 문서 페이지 범위(`structure-panel.tsx`·`new-document-dialog.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `instruct-markdown` | `InstructCitations`·`InstructMarkdown`·`InstructStructured` | tooltip | `react-markdown`·`remark-gfm`·`remark-breaks` | Instruct 탭(`instruct-markdown.tsx`·`instruct-structured.tsx`·`instruct-citation-context.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `validate-rules` | `ValidateRules` | 없음 | 없음 | Validate 규칙 카드(`validate-rules.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |
| `parse-table` | `ParseTable`·`tableNodesFromHtml` | 없음 | `html-react-parser` | Parse 표(`parse-table.tsx`) | `50c13bedc3f65019aa89422f6c352f0550dd2321ec16f3c3263f5b023106a8ce` |

- item 은 아이콘을 lucide glyph 로 받아 설치됩니다(kit 의 아이콘 역할 → `lucide-react`). shadcn 설치 변환이 선행 주석을 지우므로 vendor 소스에는 머리 주석·MIT 헤더가 없고, 라이선스는 item 별 `LICENSE.txt` 로 전달됩니다.
- **vendor 는 고치지 않습니다.** 이 앱은 Registry 설치 결과를 그대로 두고, 바뀐 item 은 새 릴리스로 다시 설치합니다. 같은 releaseId 를 다시 설치하면 `git diff -- src/components/studio-ui-kit` 가 비어 있어야 합니다.
- 이 앱의 item 테스트는 `src/test/studio-ui-kit/<item>/` 에 있습니다(vendor 를 import 해 돌고, 스냅샷 포함). 다시 설치한 뒤 `pnpm test` 로 바뀐 동작이 없는지 봅니다.

### 리뷰 화면 host 컴포넌트

Studio UI Kit item 으로 제공되지 않는 리뷰 화면 부품 4 개는 `src/components/job-review/<name>/`(폴더마다 `index.ts`·`__tests__/`)에 있는 이 앱의 host 컴포넌트입니다. host 규칙(`@/components/ui/*`·`@/lib/utils`·`lucide-react` 직접 import, ESLint·Prettier 대상)을 따르고, 문구는 부르는 host 래퍼가 next-intl 로 넘깁니다.

| 폴더 | 하는 일 | 쓰는 곳 |
| --- | --- | --- |
| `status-chip/` | 바뀜 · 재확인 필요 · 편집 불가 칩 | `content-tree.tsx`·`result-section.tsx` |
| `field-row/` | 값 폼 한 행(필드 이름·schema 키 칩, 도움말, 입력 위젯 slot, 원본 값과 되돌리기, 잠금, 오류) | `content-tree.tsx` |
| `change-tray/` | 저장 전 변경 사항 목록·검증 요약·상태 줄 | `change-tray-sheet.tsx` |
| `json-text-editor/` | JSON 텍스트 편집 칸(오류 줄·열로 커서 이동) | `json-sheet.tsx`·`json-value-dialog.tsx` |

#### structure-editor 콜백 ↔ 모델 연산 대응 표

`structure-editor` item 은 모델을 모릅니다. 이 표는 이 앱 host(`job-review/use-structure-actions.ts` 의 `filmstrip` 묶음)가 콜백을 어떻게 모델 연산으로 잇는지 보이는 예입니다. host 는 콜백마다 `ChangeDraft` 하나를 만들어 reducer 에 `APPLY` 로 보내고, 세션 쪽 적용은 `lib/review-model/changes.ts` 의 `applyToJob` 이 kind 별로 `lib/review-model/edits.ts` 함수를 부릅니다. 콜백의 `key`(페이지 키)는 host 가 그 문서 안 페이지(`PageRef`)로 바꿔 넣고, 찾지 못하면 아무것도 하지 않습니다. `applyAndFollow` 는 먼저 `addChange` 로 적용해 보고 맞으면 `APPLY` 뒤 보던 페이지를 따라 선택을 옮기며(맞지 않으면 `APPLY` 를 그대로 보내 reducer 가 사유를 `editError` 에 남깁니다), `apply` 는 `APPLY` 만 보냅니다. 둘 다 편집할 수 없을 때(구성 보기가 하나가 아니거나 저장 중)는 무시합니다.

| 콜백 | `ChangeDraft` kind | `edits.ts` 함수 | 적용 뒤 선택 |
| --- | --- | --- | --- |
| `onReorderPage(documentId, key, toIndex)` | `reorder_pages` | `reorderPages` | 따라감(`applyAndFollow`) |
| `onMovePage(fromDocumentId, key, toDocumentId, toIndex)` | `move_pages`(`to: { documentId, index }`) | `movePages` | 따라감 |
| `onSplit(documentId, afterKey)` | `split_document`(새 문서 id 는 host 가 만듦) | `splitDocument` | 따라감 |
| `onMergeInto(fromDocumentId, intoDocumentId)` | `merge_documents` | `mergeDocuments` | 따라감 |
| `onReorderDocument(documentId, toIndex)` | `reorder_documents` | `reorderDocuments` | 그대로(`apply`) |
| `onExcludePage(fromDocumentId, key)` | `exclude_pages` | `excludePages` | 따라감 |
| `onRestorePage(key, toDocumentId, toIndex)` | `restore_pages`(`to: { documentId, index }`) | `restorePages` | 따라감 |
| `onLabelChange(documentId, label)` | `set_label` | `setLabel` | 그대로 |
| `onExcludeDocument(documentId)` | `exclude_document` | `excludeDocument` | 그대로 |
| `onRestoreDocument(documentId)` | `restore_document` | `restoreDocument` | 그대로 |
| `onRestoreToNewDocument(key)` | 제외한 페이지면 `restore_pages`(`to: { newDocumentId, afterDocumentId }`), 어디에도 없는 페이지면 `add_document`(그 파일 그룹의 마지막 문서 뒤) — `newDocumentFromPageDraft` | `restorePages` / `addDocument` | 그대로 |

`onThumbnailClick`·`onFocusDocument` 는 편집이 아니라 선택·펼치기라 표에 없습니다. `onRequestDocumentPosition` 은 문서 위치를 옮기는 입력을 host 가 열도록 알리는 요청이라 위 묶음 밖(`structure-band.tsx`·`organizer-band.tsx`)에서 잇습니다. 이 콜백을 받으면 같은 item 의 `DocumentPositionDialog` 로 답합니다 — 요청받은 문서의 0-based 위치를 `index`, 같은 파일 그룹이 이어진 구간을 `min`·`max` 로 넘겨 열고, `onMove(position)` 에서 `onReorderDocument(documentId, position - 1)` 처럼 잇습니다. 메뉴에서 열었으면 `menuButtonsRef.current?.get(documentId)` 를 `returnFocus` 로 넘겨 닫힌 뒤 ⋯ 버튼으로 포커스를 돌립니다. `page-grid` 도 같은 묶음을 받고, `page-grid` 에만 있는 콜백은 이 앱 host(`job-review/organizer-band.tsx`)가 아래처럼 잇습니다.

| 콜백(`page-grid` 전용) | 이 앱 host 가 하는 일 |
| --- | --- |
| `onDropPages(pageKeys, target)` | 고른 페이지를 그룹별로 묶어(`groupSelection`) 일괄 바와 같은 일괄 편집으로 적용한다 — 제외 칸이면 일괄 제외, 문서면 그 자리로 일괄 이동(`use-structure-actions.ts` 의 `onBatchExclude`·`onBatchDrop`). 일괄 편집은 변경 묶음을 순서대로 적용해 보고 모두 맞을 때만 `APPLY_BATCH` 한 번으로 보낸다 |
| `onPageDragStart(documentId, pageKey)` | 여러 장 선택에 들지 않은 셀(제외 칸 셀 포함)을 끌기 시작하면 그냥 클릭처럼 선택을 비운다 — 그 한 장만 끈다. 모델 연산은 없다 |
| `onSizeChange(size)` | 넘기지 않는다. 크기 토글은 host `organizer-header.tsx` 가 그리고 크기는 `organizer-provider.tsx` 가 든다. 모델 연산은 없다 |

### 작성 규약과 가드

- host 코드는 shadcn 표준 시맨틱 토큰(`bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`, `border-input`, `bg-primary` …)으로 색을 정합니다.
- `pnpm lint` 는 ESLint(`eslint.config.mjs`)와 `pnpm check:vendor-baseline`(`scripts/check-vendor-baseline.mjs`)을 함께 돌립니다. 후자는 ESLint 에서 빠지는 `src/components/ui/**`·`src/components/studio-ui-kit/**` 에서 빌드 타깃 밖 내장 메서드를 찾아 **경고만** 합니다(실패하지 않음 — vendor 는 고치지 않고 사용처나 item 업데이트로 다룹니다). CI Lint 잡과 `pnpm format` 에도 포함됩니다.

### 라이선스

이 앱 자체의 코드는 MIT 라이선스입니다(레포 루트 [`LICENSE`](../LICENSE)). 앱 아이콘(`src/app/favicon.ico`, `src/app/icon.svg`)은 Upstage 브랜드 에셋으로 MIT 라이선스 대상이 아니며 권리는 Upstage 에 있습니다. 이 아이콘은 이 앱을 실행·확인하는 용도 외에는 재사용·재배포할 수 없습니다. 아래 표는 이 앱이 쓰는 제3자 패키지와 저장소에 복사된 코드의 라이선스입니다.

| 패키지·코드                                                          | 라이선스   | 상업적 이용 | 의무                                                                         |
| -------------------------------------------------------------------- | ---------- | ----------- | ---------------------------------------------------------------------------- |
| shadcn/ui 컴포넌트 소스 (`src/components/ui/`, 복사됨)               | MIT        | 허용        | 저작권·라이선스 고지 유지 → [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) |
| shadcn CLI·런타임 CSS (`shadcn`)                                     | MIT        | 허용        | 고지 유지                                                                    |
| `radix-ui`                                                           | MIT        | 허용        | 고지 유지                                                                    |
| `cn`                                                                 | MIT        | 허용        | 고지 유지                                                                    |
| `tw-animate-css`                                                     | MIT        | 허용        | 고지 유지                                                                    |
| `lucide-react`                                                       | ISC        | 허용        | 고지 유지                                                                    |
| `class-variance-authority`                                           | Apache-2.0 | 허용        | LICENSE 사본·NOTICE(있을 때) 유지, 수정 시 변경 표시                         |
| Studio UI Kit item (`src/components/studio-ui-kit/`)                 | MIT        | 허용        | item 별 `LICENSE.txt` 유지, 포함된 제3자 고지 보존                           |
| item 이 추가할 수 있는 `react-aria`·`react-stately`                  | Apache-2.0 | 허용        | LICENSE 사본·NOTICE(있을 때) 유지                                            |
| item 이 추가할 수 있는 `react-resize-detector`                       | MIT        | 허용        | 고지 유지                                                                    |
| `react-markdown`·`remark-gfm`·`remark-breaks` (Studio UI Kit item `instruct-markdown` 의 npm 의존, 하위 의존성 포함, `@ungap/structured-clone` 만 ISC) | MIT        | 허용        | 고지 유지                                                                    |
| `html-react-parser` (Studio UI Kit item `parse-table` 의 npm 의존, 하위 의존성 포함, `domhandler`·`domutils`·`domelementtype`·`entities` 는 BSD-2-Clause) | MIT        | 허용        | 고지 유지                                                                    |

Studio UI Kit item 의 npm 의존은 Registry item 의 `dependencies` 로 선언되어 설치 때 함께 추가됩니다([Studio UI Kit item 설치](#studio-ui-kit-item-설치) 절의 표). 모두 상업적 이용·수정·재배포를 허용하며, 의무는 저작권·라이선스 고지를 유지하는 것입니다. 저장소에 소스로 복사되는 제3자 코드는 shadcn/ui 컴포넌트와 Studio UI Kit item 이고, 각각 `THIRD_PARTY_NOTICES.md` 와 item 의 `LICENSE.txt` 로 고지합니다.

## 다국어 (i18n)

[next-intl](https://next-intl.dev) 기반 **URL prefix 방식**입니다. 모든 페이지는 `/{locale}/...` 경로를 가집니다 (예: `/ko/guide`).

- 지원 locale: `en`(기본), `ko`, `ja` — `src/i18n/config.ts`
- prefix 없는 요청(`/`, `/guide`)은 `src/proxy.ts` 가 `NEXT_LOCALE` 쿠키 → `Accept-Language` → 기본 locale 순으로 판단해 redirect 합니다. 쿠키는 마지막으로 방문한 locale 로 자동 갱신됩니다.
- 페이지는 `src/app/[locale]/` 아래에 두고, locale 별로 정적 생성(SSG)됩니다. 예외로 UI Kit 데모 화면(`ui-kit-demo/`)은 env 플래그를 요청 시점에 읽으려고 `connection()` 으로 요청 때 렌더합니다.
- 번역 문구: `src/messages/{locale}.json`. `en.json` 이 키의 기준이며, 없는 키를 쓰면 타입 에러가 납니다.
- 앱 내부 링크/이동은 `next/link`, `next/navigation` 대신 `@/i18n/navigation` 의 `Link`, `useRouter`, `usePathname`, `redirect` 를 사용합니다 (locale prefix 자동 처리).

### 새 페이지 추가 시

```tsx
// src/app/[locale]/guide/page.tsx
import { use } from "react";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import type { Locale } from "@/i18n/config";

export default function GuidePage({ params }: PageProps<"/[locale]/guide">) {
  const { locale } = use(params);
  setRequestLocale(locale as Locale); // 정적 렌더링에 필요

  const t = useTranslations("guide");
  return <h1>{t("title")}</h1>;
}
```

### 새 locale 추가 시

1. `src/i18n/config.ts` 의 `locales`, `localeNames` 에 추가
2. `src/messages/{locale}.json` 생성 (`en.json` 과 같은 키 구조)
