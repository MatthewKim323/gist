/* Hats the captain can wear. The captain cap is a real 3D model, see hat3d.ts. */
import { hat3dMarkup, type HatPose } from "./hat3d";

export const HATS = [{ id: "aucun" }, { id: "capitaine" }] as const;
export type HatId = (typeof HATS)[number]["id"];
export const HAT_IDS = new Set<string>(HATS.map((h) => h.id));
export const DEFAULT_HAT: HatId = "capitaine";

export function hatMarkup(id: HatId, pose: HatPose, alpha: number) {
  return id === "capitaine" ? hat3dMarkup(pose, alpha) : "";
}
