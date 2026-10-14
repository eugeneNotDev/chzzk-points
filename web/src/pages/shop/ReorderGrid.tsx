// 관리자: 상품 순서 바꾸기 — 끌어서 놓기(PC는 카드 아무 데나, 폰은 손잡이), 손잡이에서 방향키로도 옮김.
import type { ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import type { ShopItem } from "../../lib/shop";
import styles from "./Shop.module.css";

export function ReorderGrid({
  ids,
  items,
  onChange,
  render,
}: {
  ids: string[];
  items: ShopItem[];
  onChange: (ids: string[]) => void;
  render: (item: ShopItem, handle: ReactNode) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const byId = new Map(items.map((i) => [i.id, i]));
  const ordered = ids.filter((id) => byId.has(id));

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onChange(arrayMove(ordered, ordered.indexOf(String(active.id)), ordered.indexOf(String(over.id))));
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ordered} strategy={rectSortingStrategy}>
        <div className={`${styles.grid} ${styles.reordering}`}>
          {ordered.map((id) => (
            <SortableCard key={id} id={id} name={byId.get(id)!.name}>
              {(handle) => render(byId.get(id)!, handle)}
            </SortableCard>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCard({ id, name, children }: { id: string; name: string; children: (handle: ReactNode) => ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button type="button" ref={setActivatorNodeRef} className={styles.handle} aria-label={`${name} 순서 옮기기 (스페이스로 잡고 방향키로 이동)`} {...attributes} {...listeners}>
      <GripVertical size={18} />
    </button>
  );
  return (
    <div
      ref={setNodeRef}
      className={`${styles.sortable} ${isDragging ? styles.dragging : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...(matchMedia("(pointer: fine)").matches ? listeners : {})}
    >
      {children(handle)}
    </div>
  );
}
