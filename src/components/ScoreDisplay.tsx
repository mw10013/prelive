import type { Note } from "@/lib/Domain";

import { useEffect, useId, useRef, useState } from "react";

import { Effect } from "effect";
import { useMutation } from "@tanstack/react-query";

import { renderLilyPondSvg } from "@/routes/api/score/-lilypond";
import { buildVexFlowPlan, type VexFlowPlan } from "@/lib/vexflow/score";

interface ScoreDisplayProps {
  notes: readonly Note[];
  timeSigNum: number;
  timeSigDen: number;
  renderToken?: number;
}

export function ScoreDisplay({
  notes,
  timeSigNum: _timeSigNum,
  timeSigDen: _timeSigDen,
  renderToken,
}: ScoreDisplayProps) {
  const [lilypondSvg, setLilypondSvg] = useState<string | null>(null);
  const [vexflowPlan, setVexflowPlan] = useState<VexFlowPlan | null>(null);
  const vexflowContainerRef = useRef<HTMLDivElement | null>(null);
  const vexflowId = useId();
  const vexflowElementId = `vexflow-${vexflowId}`;
  const timeSignature = `${String(_timeSigNum)}/${String(_timeSigDen)}`;

  const { mutate: renderLilypond } = useMutation({
    mutationFn: async (noteData: readonly Note[]) => {
      const response = await renderLilyPondSvg({ data: { notes: noteData } });
      return await response.text();
    },
    onSuccess: (svg) => {
      setLilypondSvg(svg);
    },
  });

  useEffect(() => {
    if (!renderToken || notes.length === 0) return;
    renderLilypond(notes);
  }, [renderToken, renderLilypond, notes]);

  useEffect(() => {
    if (!renderToken || notes.length === 0) {
      setVexflowPlan(null);
      return;
    }
    const plan = Effect.runSync(
      buildVexFlowPlan(notes, {
        timeSignature: [_timeSigNum, _timeSigDen],
      }),
    );
    setVexflowPlan(plan);
  }, [renderToken, notes, _timeSigNum, _timeSigDen]);

  useEffect(() => {
    const container = vexflowContainerRef.current;
    if (!container || !vexflowPlan || vexflowPlan.staves.length === 0) return;
    let cancelled = false;
    container.innerHTML = "";
    const render = async () => {
      const VexFlow = await import("vexflow");
      if (cancelled) return;
      const { Accidental, Beam, Dot, Formatter, Renderer, Stave, StaveConnector, StaveNote, Stem, Voice } = VexFlow;
      const width = Math.max(320, container.clientWidth || 640);
      const staffGap = 16;
      const staveWidth = Math.max(200, width - 20);
      const probeStave = new Stave(0, 0, staveWidth);
      const staveHeight = probeStave.getBottomY();
      const height = Math.max(
        200,
        20 + vexflowPlan.staves.length * staveHeight + Math.max(0, vexflowPlan.staves.length - 1) * staffGap,
      );
      const renderer = new Renderer(container, Renderer.Backends.SVG);
      renderer.resize(width, height);
      const ctx = renderer.getContext();
      let currentY = 10;
      const staves = vexflowPlan.staves.map((staff) => {
        const stave = new Stave(10, currentY, staveWidth);
        stave.addClef(staff.clef).addTimeSignature(timeSignature);
        stave.setContext(ctx).draw();
        currentY = stave.getBottomY() + staffGap;
        return stave;
      });
      vexflowPlan.staves.forEach((staff, staffIndex) => {
        const stave = staves[staffIndex];
        if (!stave) return;
        const beamGroups = Beam.getDefaultBeamGroups(timeSignature);
        const { voices, beams } = staff.voices.reduce(
          (acc, voice, voiceIndex) => {
            if (voice.notes.length === 0) return acc;
            let voiceStem: "up" | "down" | undefined;
            if (staff.voices.length > 1) {
              voiceStem = voiceIndex % 2 === 0 ? "up" : "down";
            }
            const notes = voice.notes.map((noteSpec) => {
              const stem = voiceStem ?? noteSpec.stem;
              let stemDirection: number | undefined;
              if (stem === "up") stemDirection = Stem.UP;
              else if (stem === "down") stemDirection = Stem.DOWN;
              const note = new StaveNote({
                clef: staff.clef,
                keys: [...noteSpec.keys],
                duration: noteSpec.duration,
                dots: noteSpec.dots,
                type: noteSpec.type,
                autoStem: stemDirection === undefined,
                stemDirection,
              });
              if (noteSpec.type !== "r") {
                noteSpec.keys.forEach((key, index) => {
                  const match = /^([a-g])(#+|b+|n)?/i.exec(key);
                  const accidental = match?.[2];
                  if (accidental) note.addModifier(new Accidental(accidental), index);
                });
              }
              if (noteSpec.dots > 0) {
                for (let i = 0; i < noteSpec.dots; i += 1) {
                  Dot.buildAndAttach([note], { all: true });
                }
              }
              return note;
            });
            const vfVoice = new Voice(timeSignature);
            vfVoice.setMode(Voice.Mode.SOFT);
            vfVoice.addTickables(notes);
            const voiceBeams = Beam.generateBeams(notes, {
              groups: beamGroups,
              stemDirection: voiceStem === "up" ? Stem.UP : voiceStem === "down" ? Stem.DOWN : undefined,
            });
            acc.voices.push(vfVoice);
            acc.beams.push(...voiceBeams);
            return acc;
          },
          { voices: [] as InstanceType<typeof Voice>[], beams: [] as InstanceType<typeof Beam>[] },
        );
        if (voices.length === 0) return;
        const formatter = new Formatter();
        formatter.joinVoices(voices).formatToStave(voices, stave, { alignRests: true });
        voices.forEach((voice) => {
          voice.draw(ctx, stave);
        });
        beams.forEach((beam) => {
          beam.setContext(ctx).draw();
        });
      });
      if (staves.length > 1) {
        const firstStave = staves.at(0);
        const lastStave = staves.at(-1);
        if (firstStave && lastStave) {
          new StaveConnector(firstStave, lastStave)
            .setType(StaveConnector.type.BRACKET)
            .setContext(ctx)
            .draw();
        }
      }
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
          <div
            className="overflow-x-auto rounded border bg-background p-4"
            dangerouslySetInnerHTML={{ __html: lilypondSvg ?? "" }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="text-sm font-medium">VexFlow</div>
          <div className="overflow-x-auto rounded border bg-background p-4 [&_svg]:text-foreground [&_svg_path]:fill-current [&_svg_path]:stroke-current [&_svg_rect]:fill-current [&_svg_rect]:stroke-current [&_svg_line]:stroke-current [&_svg_circle]:fill-current [&_svg_circle]:stroke-current [&_svg_ellipse]:fill-current [&_svg_ellipse]:stroke-current [&_svg_polygon]:fill-current [&_svg_polygon]:stroke-current [&_svg_polyline]:fill-current [&_svg_polyline]:stroke-current [&_svg_text]:fill-current">
            <div id={vexflowElementId} ref={vexflowContainerRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
