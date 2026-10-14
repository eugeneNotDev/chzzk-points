import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config";

// 공개 읽기용(anon) 클라이언트 — 공지·랭킹·스케줄 등 RLS로 공개된 테이블 조회와 실시간 구독에 씀.
// 로그인 세션은 Supabase Auth가 아니라 자체 토큰이라 auth 저장은 꺼둠.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
