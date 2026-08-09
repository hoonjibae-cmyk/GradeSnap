/**
 * `assets/logo.svg`(원본)에서 화면이 쓰는 두 파일을 다시 만듭니다.
 *
 *   node scripts/logo.mjs
 *
 * 로고를 새로 받으면 `assets/logo.svg`만 갈아끼우고 이걸 돌리면 됩니다.
 * **`public/`의 두 파일을 손으로 고치지 마십시오** — 원본과 조용히 어긋납니다.
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync("assets/logo.svg", "utf8");
const defs = /<defs>[\s\S]*?<\/defs>/.exec(src)?.[0] ?? "";
const paths = src.match(/<path\b[^>]*\/>/g) ?? [];
if (!paths.length) throw new Error("assets/logo.svg에서 <path>를 못 찾았습니다.");

/**
 * 패스 좌표에서 테두리를 잽니다.
 * 곡선 제어점까지 세므로 실제보다 살짝 넓습니다 — 로고 여백으로는 그게 낫습니다.
 */
function box(pathEl) {
  const d = /d="([^"]*)"/.exec(pathEl)[1];
  const n = d.match(/-?\d+\.?\d*/g).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

// 첫 패스가 왕관, 둘째가 '목동유쌤영어' 글자입니다.
const b = box(paths[0]);
const pad = 1;
const viewBox = [b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2].map((v) => +v.toFixed(2)).join(" ");

// 그라데이션이 userSpaceOnUse라 **viewBox만 좁혀도 색이 그대로**입니다.
// 좌표를 옮기면 그라데이션이 어긋나므로 패스는 손대지 않습니다.
writeFileSync(
  "public/crown.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="목동유쌤영어">${defs}${paths[0]}</svg>\n`,
);
writeFileSync("public/logo.svg", src);

console.log(`public/crown.svg  viewBox="${viewBox}"`);
console.log("public/logo.svg   원본 그대로");
