// Supabase 클라이언트 초기화.
// SUPABASE_URL / SUPABASE_ANON_KEY는 공개돼도 되는 값 (Row Level Security로 접근을 제어).
// 절대 여기에 service_role 키나 치지직 clientSecret을 넣지 말 것 — 그건 supabase/functions에서만 쓴다.
//
// ranking.html, overlay.html이 이 클라이언트로 직접 Supabase를 호출한다
// (ranking view, spend_events 테이블 둘 다 anon 읽기가 열려있어서 Edge Function 없이 바로 조회 가능).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://azowisiuyeohhfxxmewb.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6b3dpc2l1eWVvaGhmeHhtZXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTQ3MTUsImV4cCI6MjEwNDg5MDcxNX0.Ov-rYD_roBJuRTqTnZUD397aHynGIzkvb1linnuBa6s";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
