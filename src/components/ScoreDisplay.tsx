import type { Note } from "@/lib/Domain";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Effect } from "effect";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { renderLilyPondSvg } from "@/routes/api/score/-lilypond";
import { buildVexFlowPlan } from "@/lib/vexflow/score";

interface ScoreDisplayProps {
  notes: readonly Note[];
  timeSigNum: number;
  timeSigDen: number;
  autoRenderToken?: number;
}

export function ScoreDisplay({
  notes,
  timeSigNum: _timeSigNum,
  timeSigDen: _timeSigDen,
  autoRenderToken,
}: ScoreDisplayProps) {
  const [lilypondSvg, setLilypondSvg] = useState<string | null>(null);
  const latestNotes = useRef(notes);
  const vexflowContainerRef = useRef<HTMLDivElement | null>(null);
  const vexflowId = useId();
  const vexflowElementId = `vexflow-${vexflowId}`;
  const timeSignature = `${String(_timeSigNum)}/${String(_timeSigDen)}`;
  const vexflowPlan = useMemo(
    () =>
      notes.length === 0
        ? null
        : Effect.runSync(
          buildVexFlowPlan(notes, {
            timeSignature: [_timeSigNum, _timeSigDen],
          }),
        ),
    [notes, _timeSigNum, _timeSigDen],
  );

  const { mutate: renderLilypond, isPending: isLilypondLoading } = useMutation({
    mutationFn: async (noteData: readonly Note[]) => {
      const response = await renderLilyPondSvg({ data: { notes: noteData } });
      return await response.text();
    },
    onSuccess: (svg) => {
      setLilypondSvg(svg);
    },
  });

  useEffect(() => {
    latestNotes.current = notes;
  }, [notes]);

  useEffect(() => {
    if (!autoRenderToken || latestNotes.current.length === 0) return;
    renderLilypond(latestNotes.current);
  }, [autoRenderToken, renderLilypond]);

  useEffect(() => {
    const container = vexflowContainerRef.current;
    if (!container || !vexflowPlan || vexflowPlan.staves.length === 0) return;
    let cancelled = false;
    container.innerHTML = "";
    const render = async () => {
      const VexFlow = await import("vexflow");
      if (cancelled) return;
      const { Factory, Voice, StaveConnector } = VexFlow;
      const width = Math.max(320, container.clientWidth || 640);
      const height = Math.max(200, vexflowPlan.staves.length * 180);
      const vf = Factory.newFromElementId(vexflowElementId, width, height);
      const score = vf.EasyScore();
      score.set({ time: timeSignature });
      const system = vf.System({ width, x: 0, y: 0, spaceBetweenStaves: 16 });
      vexflowPlan.staves.forEach((staff) => {
        const voices = staff.voices.flatMap((voice, voiceIndex) => {
          if (voice.notes.length === 0) return [];
          const notesLine = voice.notes.join(", ");
          const notes = score.notes(notesLine, {
            clef: staff.clef,
            stem: voiceIndex % 2 === 0 ? "up" : "down",
          });
          const vfVoice = score.voice(notes, { time: timeSignature });
          vfVoice.setMode(Voice.Mode.SOFT);
          return [vfVoice];
        });
        if (voices.length === 0) return;
        system.addStave({ voices }).addClef(staff.clef).addTimeSignature(timeSignature);
      });
      if (vexflowPlan.staves.length > 1) {
        system.addConnector().setType(StaveConnector.type.BRACKET);
      }
      vf.draw();
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [vexflowPlan, vexflowElementId, timeSignature]);

  if (notes.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">LilyPond</div>
          <div>
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
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">VexFlow</div>
          <div className="overflow-x-auto rounded border bg-background p-4">
            <div id={vexflowElementId} ref={vexflowContainerRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
