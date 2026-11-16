// 고정 단어표로 만드는 가짜 본문. 글꼴 문제가 없도록 ASCII 단어만 쓴다.

const WORDS = [
  "invoice",
  "payment",
  "vendor",
  "buyer",
  "amount",
  "total",
  "tax",
  "due",
  "date",
  "issued",
  "service",
  "delivery",
  "quantity",
  "unit",
  "price",
  "contract",
  "clause",
  "party",
  "agreement",
  "term",
  "notice",
  "receipt",
  "balance",
  "account",
  "reference",
  "order",
  "shipment",
  "warranty",
  "schedule",
  "period",
  "monthly",
  "annual",
  "subject",
  "section",
  "paragraph",
  "signature",
  "approved",
  "pending",
  "review",
  "summary",
  "detail",
  "attachment",
  "page",
  "document",
  "record",
  "entry",
  "status",
  "note",
  "remark",
  "office",
  "branch",
  "region",
  "customer",
  "supplier",
  "license",
  "renewal",
  "discount",
  "credit",
  "debit",
  "ledger",
];

const capitalize = word => word.charAt(0).toUpperCase() + word.slice(1);

/** `count` 개 단어. */
export function words(rng, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(rng.pick(WORDS));
  return out;
}

/** 첫 글자 대문자·마침표로 끝나는 문장(단어 `min`–`max` 개). */
export function sentence(rng, min = 6, max = 14) {
  const list = words(rng, rng.int(min, max));
  list[0] = capitalize(list[0]);
  return `${list.join(" ")}.`;
}

/** Title Case 제목(단어 2–4 개). */
export function heading(rng) {
  return words(rng, rng.int(2, 4)).map(capitalize).join(" ");
}
