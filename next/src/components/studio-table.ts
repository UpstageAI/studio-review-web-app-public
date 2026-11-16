/**
 * Studio 목록 표(DataTable) 모양을 shadcn `Table` 에 입히는 클래스. `<Table className={…}>` 에 넘기면
 * 머리 행은 회색 바탕 40px, 머리글은 12px 중간 굵기 진한 회색, 셀은 좌우 12px, 본문 행 hover 는
 * 가장 옅은 회색이 된다. 셀마다 클래스를 반복하지 않으려고 표 루트에서 하위 `data-slot` 으로 건다.
 * 목록 표 글자는 이름 400 굵기, 보조 값 `text-muted-dark` 를 쓰고 `tabular-nums` 는 쓰지 않는다
 * (Studio 목록 표 기준).
 */
export const STUDIO_TABLE_CLASS = [
  "[&_[data-slot=table-header]]:bg-muted",
  "[&_[data-slot=table-head]]:h-10",
  "[&_[data-slot=table-head]]:px-3",
  "[&_[data-slot=table-head]]:text-xs",
  "[&_[data-slot=table-head]]:font-medium",
  "[&_[data-slot=table-head]]:text-muted-dark",
  "[&_[data-slot=table-cell]]:px-3",
  "[&_[data-slot=table-cell]]:py-2.5",
  "[&_[data-slot=table-body]_[data-slot=table-row]:hover]:bg-muted-light",
  // 표가 스크롤 상자 안에 있으면 머리 행이 위에 붙어 있는다(`FIT_TABLE_WRAP_CLASS`).
  "[&_[data-slot=table-header]]:sticky",
  "[&_[data-slot=table-header]]:top-0",
  "[&_[data-slot=table-header]]:z-10",
].join(" ");

/**
 * 창 높이에 맞춘 화면(`FIT_PAGE_CLASS`)에서 표만 안에서 스크롤하게 감싸는 클래스. 넓은 화면(lg)에서
 * 남은 높이까지만 차지하고(`min-h-0`, 넘치면 줄어듦) 그 안에서 스크롤한다. shadcn 표 상자의 가로
 * 스크롤은 이 상자가 대신 맡아(`overflow-visible`) 머리 행 고정이 이 상자를 기준으로 동작한다.
 */
export const FIT_TABLE_WRAP_CLASS =
  "lg:min-h-0 lg:overflow-auto lg:[&>[data-slot=table-container]]:overflow-visible";

/**
 * 목록과 상세 화면 `main` 을 넓은 화면(lg)에서 창 높이(공통 상단 바 3.5rem 을 뺀 값)에 맞춘다. 창이
 * 아주 낮으면(40rem 미만) 맞추지 않고 페이지가 스크롤된다.
 */
export const FIT_PAGE_CLASS =
  "lg:h-[calc(100dvh-3.5rem)] lg:min-h-[40rem] lg:flex-none";
