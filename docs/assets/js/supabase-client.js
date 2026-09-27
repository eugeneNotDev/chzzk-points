// Supabase 클라이언트 초기화.
// SUPABASE_URL / SUPABASE_ANON_KEY는 공개돼도 되는 값 (Row Level Security로 접근을 제어).
// 절대 여기에 service_role 키나 치지직 clientSecret을 넣지 말 것 — 그건 supabase/functions에서만 씀.
//
// 공개해도 되는 것(랭킹 뷰, 공지, 상품/칭호 목록, 오버레이 알림 overlay_events 등)만 이 클라이언트로
// 직접 읽음 — 테이블마다 RLS 공개 읽기 정책이 있는 것만 읽히고, 쓰기는 전부 막혀 있음(Edge Function 전용).

// 라이브러리는 외부 CDN(esm.sh)에서 받지 않고 이 사이트에 직접 둔 사본(supabase.min.js, 2.117.2 고정)을 씀 —
// 로그인 토큰이 브라우저(localStorage)에 있어서, 외부 CDN이 뚫리거나 예고 없이 새 버전이 올라와도
// 사이트 코드가 바뀌지 않게. 버전을 올릴 땐 README "외부 라이브러리" 항목 참고.
import { createClient } from "./supabase.min.js";

const SUPABASE_URL = "https://azowisiuyeohhfxxmewb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6b3dpc2l1eWVvaGhmeHhtZXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTQ3MTUsImV4cCI6MjEwNDg5MDcxNX0.Ov-rYD_roBJuRTqTnZUD397aHynGIzkvb1linnuBa6s";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
