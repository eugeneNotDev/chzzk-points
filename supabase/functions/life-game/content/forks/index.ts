// 유진 키우기 갈림길 전체 — 원래 FORKS 순서 그대로 이어붙임(순서가 우선순위에 영향을 줄 수 있어서 바꾸지 말 것).
import type { Fork } from "../../engine.ts";
import { milestonesForks } from "./milestones.ts";
import { illnessForks } from "./illness.ts";
import { childhoodForks } from "./childhood.ts";
import { familyForks } from "./family.ts";
import { parentsForks } from "./parents.ts";
import { friendsForks } from "./friends.ts";
import { workForks } from "./work.ts";
import { vtuberForks } from "./vtuber.ts";
import { lateCareerForks } from "./lateCareer.ts";
import { oldAgeForks } from "./oldAge.ts";

export const FORKS: Fork[] = [
  ...milestonesForks,
  ...illnessForks,
  ...childhoodForks,
  ...familyForks,
  ...parentsForks,
  ...friendsForks,
  ...workForks,
  ...vtuberForks,
  ...lateCareerForks,
  ...oldAgeForks,
];
