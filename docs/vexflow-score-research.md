# VexFlow Score Rendering Research

Date: 2026-03-27

Goal: evaluate VexFlow 5 for rendering scores from `Note[]` so it can sit side-by-side with LilyPond output in this app.

Companions:

- `docs/lilypond-score-research.md`
- `docs/score-rendering-pipeline-research.md`
- `docs/score-quantization-research.md`
- `docs/score-rendering-library-research.md`

---

## Short answer

- VexFlow renders to Canvas or SVG in browser or Node, so client-side SVG is viable for a side-by-side view with LilyPond.
- It expects score-ready input (staves, voices, durations), so we must quantize `Note[]` and build measures/voices ourselves.
- The recommended onramp is `Factory` + `EasyScore`; EasyScore accepts note strings with durations, dots, and chords.
- Existing quantization logic can produce the discrete durations EasyScore requires.

---

## Project facts

From `package.json`:

```
"vexflow": "5.0.0"
```

---

## VexFlow facts from refs

### Rendering targets and environments

From `refs/vexflow/README.md`:

```
VexFlow is an open-source library for rendering music notation. It is written in TypeScript (compiled to ES6), and outputs scores to HTML Canvas and SVG. It works in browsers and also in Node.js projects (e.g., a command line script to save a score as a PDF).
```

### Recommended API: Factory + EasyScore

From `refs/vexflow/README.md`:

```
const { Factory } = VexFlow;
const vf = new Factory({
  renderer: { elementId: 'output', width: 500, height: 200 },
});

const score = vf.EasyScore();
const system = vf.System();

system
  .addStave({
    voices: [
      score.voice(score.notes('C#5/q, B4, A4, G#4', { stem: 'up' })),
      score.voice(score.notes('C#4/h, C#4', { stem: 'down' })),
    ],
  })
  .addClef('treble')
  .addTimeSignature('4/4');

vf.draw();
```

### Low-level SVG renderer

From `refs/vexflow/README.md`:

```
const { Renderer, Stave } = VexFlow;
const renderer = new Renderer(div, Renderer.Backends.SVG);
renderer.resize(500, 500);
const context = renderer.getContext();
const stave = new Stave(10, 40, 400);
stave.addClef('treble').addTimeSignature('4/4');
stave.setContext(context).draw();
```

### Fonts and default font selection

From `refs/vexflow/entry/vexflow.ts`:

```
const fontBravura = Font.load('Bravura', Bravura, block);
const fontAcademico = Font.load('Academico', Academico, swap);
...
VexFlow.setFonts('Bravura', 'Academico');
```

---

## EasyScore input grammar (key for quantization)

From `refs/vexflow/src/easyscore.ts`:

```
DURATIONS(): Rule { return { token: '[0-9whq]+' }; }
DOT(): Rule { return { token: '[.]' }; }
```

From `refs/vexflow/tests/easyscore_tests.ts`:

```
const mustPass = ['c3/4', 'c##3/w, cb3', 'c##3/w, cb3/q', 'c##3/q, cb3/32'];
const mustPass = ['c#5/h., c5/q'];
const mustPass = ['(c##4 cbb4 cn4)/w, (c#5 cb2 a3)/32'];
```

Interpretation:

- Duration tokens are `w`, `h`, `q`, or digits like `8`, `16`, `32`, with optional dots.
- Chords are grouped with `(...)`.
- Accidentals are part of the note token (`c#`, `cb`, `cn`, etc).

---

## Fit to our Note[] model

From `src/lib/Domain.ts`:

```
export const Note = Schema.Struct({
  note_id: Schema.Number,
  pitch: Schema.Number,
  start_time: Schema.Number,
  duration: Schema.Number,
  velocity: Schema.Number,
  mute: Schema.Boolean,
  probability: Schema.Number,
  velocity_deviation: Schema.Number,
  release_velocity: Schema.Number,
});
```

Implications:

- We must derive measure structure, voices, and quantized durations from float beat timing.
- VexFlow needs discrete durations per note or chord, so quantization is mandatory.

We already quantize for LilyPond:

From `src/lib/lilypond/quantizer.ts`:

```
const defaultQuantizationConfig = {
  startGrid: 1 / 16,
  durationAllowed: [4, 3, 2, 3 / 2, 1, 3 / 4, 1 / 2, 3 / 8, 1 / 4, 1 / 8, 1 / 16],
  ...
};
export const quantizeNotes = ...
```

Takeaway:

- The existing quantizer yields beat durations that map cleanly to `w/h/q/8/16` plus dots.
- It is a strong baseline for VexFlow input conversion.

---

## Side-by-side rendering sketch (research)

Current LilyPond UI path:

From `src/components/ScoreDisplay.tsx`:

```
const response = await renderLilyPondSvg({ data: { notes: noteData } });
setLilypondSvg(svg);
```

Sketch for VexFlow:

- Render VexFlow into a sibling SVG container next to LilyPond in the same component.
- Use `Factory` + `EasyScore` for a fast prototype, or `Renderer.Backends.SVG` for lower-level control.
- Reuse quantized notes so both renderers see the same rhythmic decisions.

---

## Mapping notes to VexFlow (conceptual steps)

1. Quantize `Note[]` using `quantizeNotes`.
2. Group by `start_time` into chords.
3. Split into measures and voices (similar to the LilyPond path).
4. Convert durations to VexFlow tokens:
   - `4 beats -> w`, `2 beats -> h`, `1 beat -> q`, `0.5 -> 8`, `0.25 -> 16`, `0.125 -> 32`.
   - Dotted values map to `.` (e.g. `1.5 -> q.`).
5. Emit EasyScore note strings or build `StaveNote` objects.

Existing LilyPond duration split and voice assignment can be repurposed:

From `src/lib/lilypond/score.ts`:

```
const durationTable = [
  { beats: 4, token: "1" },
  { beats: 3, token: "2." },
  { beats: 2, token: "2" },
  { beats: 1.5, token: "4." },
  { beats: 1, token: "4" },
  { beats: 0.5, token: "8" },
  { beats: 0.25, token: "16" },
  ...
];
```

For VexFlow, the same beat values can map to `w/h/q/8/16/32` and dotted forms.

---

## Gaps / risks

- VexFlow does not infer notation from performance timing; it needs explicit durations, beaming, and voices.
- Quantization choice will dominate readability; reuse existing quantization as the baseline.
- Multiple voices on one staff are possible but require explicit voice handling.

---

## Review notes / decisions

- Start with `Factory` + `EasyScore` for the simplest first pass.
- Quantization: reuse the LilyPond quantizer with VexFlow-specific config overrides; split into a dedicated quantizer only if tuning diverges materially.
- Staff selection: case-by-case; keyboard material likely needs treble+bass split, single-line clips can stay on one staff.

---

## Implementation guidance (Effect v4)

From `refs/effect4/ai-docs/src/01_effect/01_basics/02_effect-fn.ts`:

```
When writing functions that return an Effect, use `Effect.fn` to use the
generator syntax.

**Avoid creating functions that return an Effect.gen**, use `Effect.fn`
instead.
```

```
// Pass a string to Effect.fn, which will improve stack traces and also
// attach a tracing span (using Effect.withSpan behind the scenes).
//
// The name string should match the function name.
```

```
// Add additional functionality by passing in additional arguments.
// **Do not** use .pipe with Effect.fn
```
