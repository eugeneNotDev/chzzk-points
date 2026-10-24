// 유진 키우기 v3 콘텐츠 — 집·초점·직업·상점·일상 이벤트·갈림길·병·엔딩. 돈은 만원 단위.
// 글 안의 {p}=연인/배우자, {f}=친구, {c}=막내 아이, {pet}=반려동물, {job}=지금 직업 이름.
// 내용은 content/ 폴더에 종류별로 나눠 두고(갈림길은 content/forks/), 여기서는 다른 파일이 쓰던 이름 그대로 모아서 내보내기만 함.
export { SHOWS, HOUSES, FUNDS, FOCUSES, JOBS, ITEMS, NAMES, DISEASES } from "./content/world.ts";
export { DAILY } from "./content/daily.ts";
export { FORKS } from "./content/forks/index.ts";
export { MODS, SPECIALS } from "./content/endings.ts";
