import { useState } from "react";
import { profileThumbUrl } from "../lib/auth";
import styles from "./Avatar.module.css";

// 동그란 프로필 — 치지직 프로필 사진이 있으면 사진, 없거나 깨지면 이름 첫 글자.
export function Avatar({ name, image, size = 32 }: { name: string | null; image: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initial = Array.from(name || "?")[0] || "?";
  return (
    <span className={styles.avatar} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">
      {image && !broken ? (
        <img src={profileThumbUrl(image)} alt="" referrerPolicy="no-referrer" decoding="async" onError={() => setBroken(true)} />
      ) : (
        initial
      )}
    </span>
  );
}
