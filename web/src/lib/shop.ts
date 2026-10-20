// 포인트 상점 데이터 — 상품 목록, 사용/구매, 관리자 상품 관리.
import { useQuery } from "@tanstack/react-query";
import { API } from "./config";
import { apiFetch, useAuth } from "./auth";
import { supabase } from "./supabase";

export type ShopItem = {
  id: string;
  name: string;
  cost: number;
  description: string | null;
  requires_live: boolean;
  cooldown_seconds: number;
  grants_title_id: string | null;
  stock_limit: number | null;
  sold_count: number | null;
  titles: { name: string; color: string } | null;
  // 관리자 목록에만
  is_active?: boolean;
  show_on_overlay?: boolean;
  owner_count?: number;
};

// 관리자는 판매 중지 상품까지(shop-items 함수), 일반 유저는 판매 중인 상품만(anon, RLS가 걸러줌).
export function useShopItems() {
  const { isAdmin, channelId } = useAuth();
  return useQuery({
    queryKey: ["shop-items", isAdmin ? channelId : "public"],
    staleTime: 30_000,
    queryFn: async () => {
      if (isAdmin) {
        try {
          const d = await apiFetch<{ items: ShopItem[] }>(API.shopItems);
          return d.items ?? [];
        } catch {
          /* 일반 목록으로 */
        }
      }
      const { data, error } = await supabase
        .from("shop_items")
        .select("id, name, cost, description, requires_live, cooldown_seconds, grants_title_id, stock_limit, sold_count, titles(name, color)")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as ShopItem[];
    },
  });
}

export type SpendResult = {
  balance: number;
  item?: { name: string; cost: number; cooldownSeconds: number };
  titleGranted?: { id: string; name: string };
};

export const spendItem = (itemId: string) => apiFetch<SpendResult>(API.spendPoints, { body: { itemId } });

export const SPEND_ERRORS: Record<string, string> = {
  not_live: "지금은 방송 중이 아니에요.",
  insufficient_balance: "포인트가 부족해요.",
  item_not_found: "지금은 살 수 없는 상품이에요. 새로고침 후 다시 시도해주세요.",
  already_owned: "이미 보유한 칭호예요.",
  sold_out: "품절된 상품이에요.",
};

export const SAVE_ERRORS: Record<string, string> = {
  duplicate_id: "이미 존재하는 상품 id예요.",
  invalid_id: "상품 id 형식이 올바르지 않아요.",
  invalid_title_name: "지급할 칭호명을 입력해주세요.",
  invalid_title_color: "칭호 색상이 올바르지 않아요.",
  title_id_conflict: "이미 사용된 상품 id예요(연결된 칭호가 남아있어요). 다른 id를 써주세요.",
  not_title_item: "칭호 상품이 아니라서 칭호명을 저장할 수 없어요.",
};

export const createShopItem = (body: Record<string, unknown>) => apiFetch(API.shopItems, { method: "POST", body });
export const updateShopItem = (id: string, body: Record<string, unknown>) => apiFetch(`${API.shopItems}?id=${encodeURIComponent(id)}`, { method: "PATCH", body });
export const deleteShopItem = (id: string) => apiFetch<{ revokedOwners?: number }>(`${API.shopItems}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
export const reorderShopItems = (ids: string[]) => apiFetch(`${API.shopItems}?action=reorder`, { method: "PATCH", body: { ids } });
