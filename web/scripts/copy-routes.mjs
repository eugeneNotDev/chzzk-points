// GitHub Pages는 서버 라우팅이 없어서 /beta/freebox.html 같은 주소로 바로 들어오면 404가 남.
// 그래서 빌드가 끝나면 index.html을 메뉴 주소마다 복사해둠 — 어느 주소로 들어와도 같은 앱이 뜨고,
// 앱(React Router)이 주소를 보고 맞는 화면을 그림. 주소는 기존 사이트와 똑같이(xxx.html) 맞춰둬서
// 교체한 뒤에도 즐겨찾기·공지 속 링크가 그대로 동작함.
// 메뉴 목록은 src/nav.ts에서 자동으로 읽어옴(메뉴를 추가하면 따로 손댈 것 없음).
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nav = readFileSync(resolve(root, "src/nav.ts"), "utf8");
const files = [...new Set([...nav.matchAll(/path:\s*"([a-z0-9-]+\.html)"/g)].map((m) => m[1]))];

const outDir = resolve(root, "../docs/beta");
for (const file of files) copyFileSync(resolve(outDir, "index.html"), resolve(outDir, file));
console.log(`[copy-routes] ${files.length}개 주소에 index.html 복사: ${files.join(", ")}`);
