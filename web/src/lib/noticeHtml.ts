// 공지 HTML 본문 정리(DOMPurify). 공지 화면에서만 불러오게 따로 뺌 — DOMPurify(약 80KB)가 첫 화면 파일에 안 들어가게.
import DOMPurify from "dompurify";

// ── HTML 본문 정리 ── 관리자만 쓰는 글이지만 혹시 모를 사고에 대비해 위험한 건 전부 걸러냄.
const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "p", "br", "hr", "b", "strong", "i", "em", "u", "s", "del", "mark", "small", "sub", "sup",
  "span", "div", "blockquote", "code", "pre", "ul", "ol", "li", "a", "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "details", "summary",
];
const ALLOWED_ATTR = ["class", "style", "href", "src", "alt", "title", "width", "height", "colspan", "rowspan", "open", "start"];
let hookAdded = false;
export function sanitizeNoticeHtml(html: string) {
  if (!hookAdded) {
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A" && node.getAttribute("href")) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
      if (node.tagName === "IMG") node.setAttribute("loading", "lazy");
    });
    hookAdded = true;
  }
  return DOMPurify.sanitize(String(html), { ALLOWED_TAGS, ALLOWED_ATTR, ADD_ATTR: ["target", "rel", "loading"] });
}
