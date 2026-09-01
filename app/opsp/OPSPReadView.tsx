"use client";

import { useState } from "react";
import type { CellValue } from "@/lib/opsp-seed";
import { OpspHeader } from "./OpspHeader";
import { OpspReadGrid } from "./OpspReadGrid";

interface OPSPReadViewProps {
  initialCells: Record<string, CellValue>;
  initialAudienceMode?: "facilitator" | "room";
}

export function OPSPReadView({
  initialCells,
  initialAudienceMode = "room",
}: OPSPReadViewProps) {
  const [cells, setCells] = useState<Record<string, CellValue>>(initialCells);
  const [audienceMode, setAudienceMode] = useState<"facilitator" | "room">(initialAudienceMode);

  const handleToggleAudienceMode = async () => {
    const nextMode = audienceMode === "facilitator" ? "room" : "facilitator";
    setAudienceMode(nextMode);
    try {
      const res = await fetch(`/api/opsp/plan?mode=${nextMode}`);
      if (res.ok) {
        const data = (await res.json()) as { cells: Record<string, CellValue> };
        if (data.cells) setCells(data.cells);
      }
    } catch {
      // Degrade quietly
    }
  };

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col font-sans">
      <OpspHeader
        audienceMode={audienceMode}
        onToggleAudienceMode={handleToggleAudienceMode}
      />
      <main className="flex-1 overflow-x-auto p-2 sm:p-4">
        <OpspReadGrid cells={cells} />
      </main>
    </div>
  );
}
