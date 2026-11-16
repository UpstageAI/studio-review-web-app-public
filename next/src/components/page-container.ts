/**
 * 모든 화면이 함께 쓰는 가로 틀. 상단 바와 각 화면의 왼쪽 끝이 같은 자리에 오도록 같은 값을 쓴다.
 * 화면 폭에 맞춰 넓어지고(아주 넓은 화면만 2560px 에서 멈춤), 좌우 여백은 화면이 클수록 조금씩 늘린다.
 */
export const PAGE_CONTAINER =
  "mx-auto w-full max-w-[2560px] px-4 sm:px-6 lg:px-8 2xl:px-10";
