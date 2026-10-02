"use client";

// Move cards inside an Ask gist answer. Each card reads its live state from the shared moves store
// (falls back to the snapshot the assistant sent), so finishing a move here also updates the Overview panel.
import "@/app/styles/gist-moves.css";
import MoveCard from "./MoveCard";
import { useMoves } from "./store";
import type { Move } from "@/lib/server/moves/types";

export default function InlineMoves({ matterId, moves }: { matterId: number; moves: Move[] }) {
  const { data } = useMoves(matterId);
  if (!moves.length) return null;
  return (
    <div className="gmv-inline" aria-label="Next moves">
      {moves.map((m, i) => {
        const live = data?.moves.find((x) => x.id === m.id) ?? m;
        return <MoveCard key={m.id} matterId={matterId} move={live} n={i + 1} compact />;
      })}
    </div>
  );
}
