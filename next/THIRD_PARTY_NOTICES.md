# Third-Party Notices

이 앱의 저장소에 소스 코드로 복사되어 들어 있는 제3자 코드와 그 고지입니다.

이 앱 자체의 라이선스는 레포 루트 [`LICENSE`](../LICENSE) 입니다. 단, 앱 아이콘(`src/app/favicon.ico`, `src/app/icon.svg`)은 Upstage 브랜드 에셋으로 MIT 라이선스 대상이 아니며 권리는 Upstage 에 있습니다. 이 아이콘은 이 앱을 실행·확인하는 용도 외에는 재사용·재배포할 수 없습니다.

## shadcn/ui

- 대상: `src/components/ui/` 의 컴포넌트
- 출처: [shadcn/ui](https://ui.shadcn.com) — shadcn CLI(`npx shadcn add <item>`)가 복사한 소스
- 라이선스: MIT

```
MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Studio UI Kit

- 대상: `src/components/studio-ui-kit/<item>/` (Registry 에서 설치한 item)
- 고지: 각 item 폴더에 함께 설치되는 `LICENSE.txt` 가 그 item 의 라이선스(MIT)·저작권·적용 파일 목록입니다. 파일을 지우거나 고치지 않고 유지합니다.

## npm 패키지

`package.json` 으로 설치되는 패키지(`radix-ui`, `class-variance-authority`, `cn`, `lucide-react`, `tw-animate-css`, `shadcn` 등)는 각 패키지에 포함된 라이선스를 따릅니다.

이 저장소에는 `node_modules` 와 빌드 결과가 들어 있지 않습니다. 패키지는 설치할 때 각자의 저작권·라이선스 고지와 함께 내려받아집니다. 빌드 결과나 컨테이너 이미지처럼 패키지가 포함된 결과물을 다시 배포한다면 그 패키지들의 고지도 함께 넣어야 합니다. 예를 들어 `next` 의 이미지 최적화가 쓰는 `sharp` 는 플랫폼별 `libvips` 바이너리(`@img/sharp-libvips-*`, LGPL-3.0-or-later)를 내려받고, `caniuse-lite` 데이터는 CC-BY-4.0 입니다.

Studio UI Kit `image-viewer` item 이 의존성으로 추가한 패키지:

| 패키지 | 라이선스 | 의무 |
| --- | --- | --- |
| `react-aria` | Apache-2.0 | 패키지에 포함된 LICENSE 사본·NOTICE(있을 때) 유지 |
| `react-stately` | Apache-2.0 | 패키지에 포함된 LICENSE 사본·NOTICE(있을 때) 유지 |
| `react-resize-detector` | MIT | 저작권·라이선스 고지 유지 |

Studio UI Kit `instruct-markdown` item 이 의존성으로 추가한 패키지(Instruct 출력 markdown 렌더):

| 패키지 | 라이선스 | 의무 |
| --- | --- | --- |
| `react-markdown` | MIT | 저작권·라이선스 고지 유지 |
| `remark-gfm` | MIT | 저작권·라이선스 고지 유지 |
| `remark-breaks` | MIT | 저작권·라이선스 고지 유지 |
| 위 세 패키지의 하위 의존성(`unified`·`remark-parse`·`remark-rehype`·`micromark`·`mdast-util-*`·`hast-util-*` 등, 약 100 개) | MIT, `@ungap/structured-clone` 만 ISC | 각 패키지에 포함된 저작권·라이선스 고지 유지 |

Studio UI Kit `parse-table` item 이 의존성으로 추가한 패키지:

| 패키지 | 라이선스 | 의무 |
| --- | --- | --- |
| `html-react-parser` | MIT | 저작권·라이선스 고지 유지 |
| 위 패키지의 하위 의존성(`domhandler`·`domutils`·`domelementtype`·`entities` 는 BSD-2-Clause, 그 밖은 MIT) | MIT, BSD-2-Clause | 각 패키지에 포함된 저작권·라이선스 고지 유지 |
