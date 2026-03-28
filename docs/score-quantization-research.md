# Score Quantization for Performance Note Lists (EDM)

Date: 2026-03-27

Goal: improve score readability by quantizing performance note lists before LilyPond/VexFlow notation.

---

## Problem framing

The note list is performance data, but we currently notate it too literally. That yields awkward durations and beaming.

---

## Current pipeline evidence (LilyPond + VexFlow)

We render both LilyPond (server-side) and VexFlow (client-side). Both paths share the same quantizer.

LilyPond rendering uses quantizeNotes, then runs lilypond:

```
const quantized = yield* quantizeNotes(notes);
const lyContent = notesToLilyPond(quantized);
...
ChildProcess.make("lilypond", ["-dbackend=svg", "-o", outputBase, tmpLy]);
```

`src/lib/lilypond/renderer.ts`

VexFlow uses the same quantizer before building the render plan:

```
const quantized = yield* quantizeNotes(notes, config.quantization);
const events = buildEvents(quantized, config.gridSize);
```

`src/lib/vexflow/score.ts`

The UI renders both outputs side-by-side (LilyPond via server fn, VexFlow via client render):

```
const response = await renderLilyPondSvg({ data: { notes: noteData } });
...
const plan = Effect.runSync(buildVexFlowPlan(notes, { timeSignature: [_timeSigNum, _timeSigDen] }));
```

`src/components/ScoreDisplay.tsx`

Durations that do not map cleanly are split into dotted/undotted tokens:

```
const splitDuration = (beats) => {
  const tokens = [];
  let remaining = beats;
  for (const { beats: value, token } of durationTable) {
    while (remaining + epsilon >= value) {
      tokens.push(token);
      remaining = roundToGrid(remaining - value, 1 / 1024);
    }
    if (remaining <= epsilon) break;
  }
  return tokens.length > 0 ? tokens : ["64"];
};
```

`src/lib/lilypond/score.ts`

Both renderers also apply a grid-based grouping step when building events:

```
const start = roundToGrid(note.start_time, gridSize);
const duration = roundToGrid(note.duration, gridSize);
```

`src/lib/lilypond/score.ts`

```
const start = roundToGrid(note.start_time, gridSize);
const duration = roundToGrid(note.duration, gridSize);
```

`src/lib/vexflow/score.ts`

---

## Constraints and assumptions

- Note lists are EDM clips: lines, chords, maybe keyboard clips (bass + treble). Not baroque counterpoint.
- Start times are beat-based floats (performance timing, not notation).
- Ableton Live LOM does not provide clip-level quantization settings; quantization is app-side:

```
- Use an app-defined grid (e.g. 1/16) and round durations to clean values (quarter, eighth, etc.).
- This does not require any LOM quantization settings or clip-level quantize calls.
```

`docs/lom-quantization-liveql-research.md`

---

## What we are trying to address

- Start times are close to grid but not on it (e.g. 0.93, 0.87), producing near-values that split into ugly dotted fragments.
- Durations are more variable and need smarter snapping than start times.
- We need predictable notation for EDM: clean quarter/eighth/16ths, occasional dotted values, minimal tuplets.

---

## Current quantization model (implemented)

### 1) Start time quantization (strong-grid bias + fallback)

- Default grid: 1/16.
- Prefer strong grids first: {1/4, 1/8} with tolerance 1/32; if matched, snap.
- Otherwise snap to 1/16 within tolerance 1/64; if not within tolerance, round to 1/16 anyway.

Implementation:

```
for (const grid of config.startStrongGrids) {
  const snapped = snapToGrid(value, grid, config.startStrongTolerance);
  if (snapped !== undefined) return snapped;
}
const baseSnap = snapToGrid(value, config.startGrid, config.startGridTolerance);
return baseSnap ?? roundToGrid(value, config.startGrid);
```

`src/lib/lilypond/quantizer.ts`

### 2) Duration quantization (preferred values + allowed set)

- Quantize duration separately from start_time.
- Prefer values if within tolerance 1/6 beats: [4, 2, 1, 1/2, 1/4, 1/8, 1/16].
- Otherwise choose from allowed set with short/long tolerances:
  - Allowed: [4, 3, 2, 3/2, 1, 3/4, 1/2, 3/8, 1/4, 1/8, 1/16].
  - Tolerance: 1/64 for durations < 1 beat, 1/48 for durations >= 1 beat.
- Dotted values [3/2, 3/4, 3/8] are allowed only when start and end align to a 1/8 grid within 1/64.
- If no candidate matches, round duration to 1/16.

Implementation:

```
if (preferredValue !== undefined) return preferredValue;
const tolerance = rawDuration >= config.durationLongThreshold
  ? config.durationToleranceLong
  : config.durationToleranceShort;
...
return bestValue ?? roundToGrid(rawDuration, config.durationGrid);
```

`src/lib/lilypond/quantizer.ts`

### 3) End alignment + clamp

- Compute end from the selected duration.
- Snap end to 1/16 if within 1/64; then if there is no next onset, try a strong end snap to 1/4 within 1/8.
- If the next onset (based on the next unique quantized start) is within 1/8, clamp end to that onset.
- Normalize final duration to a 1/1024 grid.

Implementation:

```
const endSnapped = snapToGrid(endPre, config.endGrid, config.endGridTolerance) ?? endPre;
const endStrong = nextStart === undefined
  ? (snapToGrid(endSnapped, config.endStrongGrid, config.endStrongTolerance) ?? endSnapped)
  : endSnapped;
const endClamped = config.clampToNextOnset && nextStart !== undefined &&
  isClose(endStrong, nextStart, config.endClampTolerance)
  ? nextStart
  : endStrong;
```

`src/lib/lilypond/quantizer.ts`

---

## Expected impact

- Cleaner rhythmic values (quarters, eighths, sixteenths) instead of dotted chains.
- Consistent bar alignment without sacrificing EDM timing feel.
- Better chord display because notes that should align share starts and similar durations.

---

## Open questions for iteration

- Whether the 1/6 preferred-value tolerance is too wide for short clips.
- Whether dotted gating (1/8 alignment) should be configurable per clip.
- Whether next-onset clamping should be disabled for legato passages.
- Triplet detection remains unimplemented.

---

## Suggested validation steps

- Compare VexFlow and LilyPond outputs side-by-side in the ScoreDisplay panel.
- Tune tolerances in `src/lib/lilypond/quantizer.ts` and re-render to verify visual improvement.
