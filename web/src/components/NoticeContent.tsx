// 공지 본문 + 첨부(사진 갤러리, 다운로드 파일 목록) 보기 — 공지사항 화면과 홈 미리보기 팝업이 같이 씀.
import { Download, FileText } from "lucide-react";
import { formatFileSize, noticeAttachmentUrl, type NoticeAttachment } from "../lib/notices";
import { sanitizeNoticeHtml } from "../lib/noticeHtml";
import styles from "./NoticeContent.module.css";

export type PreviewFile = { name: string; size: number; url?: string; kind: "image" | "file" };

export function NoticeBody({
  content,
  isHtml,
  attachments = [],
  extra = [],
}: {
  content: string | null;
  isHtml: boolean;
  attachments?: NoticeAttachment[];
  extra?: PreviewFile[]; // 글쓰기 미리보기에서 아직 안 올린 파일
}) {
  const text = String(content ?? "");
  const sorted = attachments.slice().sort((a, b) => a.sort_order - b.sort_order);
  const images = sorted.filter((a) => a.kind === "image");
  const files = sorted.filter((a) => a.kind !== "image");
  const extraImages = extra.filter((f) => f.kind === "image");
  const extraFiles = extra.filter((f) => f.kind !== "image");

  return (
    <div className={styles.wrap}>
      {text.trim() &&
        (isHtml ? (
          <div className={`notice-html ${styles.content}`} dangerouslySetInnerHTML={{ __html: sanitizeNoticeHtml(text) }} />
        ) : (
          <div className={`${styles.content} ${styles.plain}`}>{text}</div>
        ))}

      {(images.length > 0 || extraImages.length > 0) && (
        <div className={styles.gallery}>
          {images.map((a) => {
            const url = noticeAttachmentUrl(a.storage_path);
            return (
              <span key={a.id} className={styles.thumb}>
                <a href={url} target="_blank" rel="noopener">
                  <img src={url} alt={a.file_name} loading="lazy" />
                </a>
                <a className={styles.dl} href={`${url}?download=${encodeURIComponent(a.file_name)}`} title="다운로드" aria-label={`${a.file_name} 다운로드`}>
                  <Download size={16} aria-hidden="true" />
                </a>
              </span>
            );
          })}
          {extraImages.map((f, i) => (
            <span key={`x${i}`} className={styles.thumb}>
              <img src={f.url} alt={f.name} />
            </span>
          ))}
        </div>
      )}

      {(files.length > 0 || extraFiles.length > 0) && (
        <div className={styles.files}>
          {files.map((a) => {
            const url = noticeAttachmentUrl(a.storage_path);
            return (
              <a key={a.id} className={styles.fileRow} href={`${url}?download=${encodeURIComponent(a.file_name)}`}>
                <FileText size={18} aria-hidden="true" />
                <span className={styles.fileName}>{a.file_name}</span>
                <span className={styles.fileSize}>{formatFileSize(a.size_bytes)}</span>
                <Download size={16} aria-hidden="true" className={styles.fileDl} />
              </a>
            );
          })}
          {extraFiles.map((f, i) => (
            <span key={`x${i}`} className={styles.fileRow}>
              <FileText size={18} aria-hidden="true" />
              <span className={styles.fileName}>{f.name}</span>
              <span className={styles.fileSize}>{formatFileSize(f.size)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
