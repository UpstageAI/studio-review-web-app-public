/** Collection, Job, 가져오기 ID 로 받는 문자 집합. 경로 조작 문자는 허용하지 않는다(서버와 브라우저가 함께 쓴다). */
export const RESOURCE_ID_PATTERN = /^[\w-]{1,128}$/;
