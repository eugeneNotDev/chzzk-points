// DB 연결(서비스 키) — 모든 함수가 같이 씀. supabase-js 버전은 여기 한 곳에서만 정함.
// (사이트 web/package.json의 @supabase/supabase-js, docs/assets/js/supabase.min.js와 맞춰둘 것)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.117.2";

export { createClient };

export function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경변수가 없습니다.");
  return createClient(url, serviceRoleKey);
}

export type Admin = ReturnType<typeof getAdminClient>;
