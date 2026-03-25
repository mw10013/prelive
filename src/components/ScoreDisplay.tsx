import type { Note } from "@/lib/Domain";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { renderLilyPondSvg } from "@/routes/api/score/-lilypond";

interface ScoreDisplayProps {
  notes: readonly Note[];
  timeSigNum: number;
  timeSigDen: number;
}

export function ScoreDisplay({
  notes,
  timeSigNum: _timeSigNum,
  timeSigDen: _timeSigDen,
}: ScoreDisplayProps) {
  const [lilypondSvg, setLilypondSvg] = useState<string | null>(null);

  const { mutate: renderLilypond, isPending: isLilypondLoading } = useMutation({
    mutationFn: async (noteData: readonly Note[]) => {
      const response = await renderLilyPondSvg({ data: { notes: noteData } });
      return await response.text();
    },
    onSuccess: (svg) => {
      setLilypondSvg(svg);
    },
  });

  if (notes.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div>
        <div className="mb-2">
          <Button
            variant="secondary"
            onClick={() => {
              renderLilypond(notes);
            }}
            disabled={isLilypondLoading}
          >
            {isLilypondLoading ? "Rendering..." : "Render LilyPond"}
          </Button>
        </div>
        <div
          className="overflow-x-auto rounded border bg-background p-4"
          dangerouslySetInnerHTML={{ __html: lilypondSvg ?? "" }}
        />
      </div>
    </div>
  );
}
