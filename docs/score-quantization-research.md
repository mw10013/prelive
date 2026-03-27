# Score Quantization for Performance Note Lists (EDM)

Date: 2026-03-27

Goal: improve score readability by quantizing performance note lists before LilyPond notation.

---

## Problem framing

The note list is performance data, but we currently notate it too literally. That yields awkward durations and beaming. The docs already frame this as a quantization problem:

```
Converting raw MIDI events into readable sheet music notation is a quantization + inference problem:
- MIDI has exact timing (ticks), notation needs quantized durations (quarter, eighth, etc.)
```

`docs/midi-to-score-pipeline-research.md`

---

## Current pipeline evidence (direct LilyPond)

We generate LilyPond directly from notes; MIDI is a debug artifact only:

```
const lyContent = notesToLilyPond(notes);
...
ChildProcess.make("lilypond", ["-dbackend=svg", "-o", outputBase, tmpLy]);
```

`src/lib/lilypond/renderer.ts`

Quantization is a fixed grid and is applied via rounding:

```
export const quantizeNotes = (notes, gridSize = 1 / 16) =>
  notes.map((note) => ({
    ...note,
    start_time: Math.round(note.start_time / gridSize) * gridSize,
    duration: Math.round(note.duration / gridSize) * gridSize,
  }));
```

`src/lib/lilypond/midi.ts`

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

## Proposed quantization model (conceptual)

### 1) Start time quantization (stable, fixed grid)

- Default grid: 1/16 note.
- Snap start_time to nearest grid with tolerance; values within tolerance of a grid line snap cleanly.
- Prefer stronger beats when close: attempt {1/4, 1/8} snaps first, then fall back to 1/16.
- Optionally infer grid from note-start deltas by choosing the closest of {1/4, 1/8, 1/16, 1/32}.

### 2) Duration quantization (heuristic, value set)

- Quantize duration separately from start_time.
- Prefer clean values over literal rounded values:
  - Allowed set: 1, 1/2, 1/4, 1/8, 1/16, plus dotted versions (3/2, 3/4, 3/8, 3/16).
  - Tuplets off by default; enable only if the clip clearly uses triplets.
- If a duration is within tolerance of an allowed value, snap to it.
- Otherwise snap to nearest grid and let existing tie-splitting handle longer spans.
- Optional clamp: if the next onset in the same voice is within tolerance of the computed end, clamp end to that onset.

### 3) End alignment heuristics

- Compute end_time = start_time + duration.
- Snap end_time to grid (or allowed value) then recompute duration.
- If the note end is within tolerance of the next onset in the same voice, clamp to that onset to avoid micro-overlaps.

---

## Expected impact

- Cleaner rhythmic values (quarters, eighths, sixteenths) instead of dotted chains.
- Consistent bar alignment without sacrificing EDM timing feel.
- Better chord display because notes that should align share starts and similar durations.

---

## Open questions for iteration

- Tolerance thresholds for start_time vs duration snapping.

Start with constants and tune. Proposal:

- Start-time tolerances: strong beats (1/4 or 1/8) within 1/32 beat, base grid (1/16) within 1/64 beat.
- Duration tolerances: within 1/64 beat for allowed values; allow a looser 1/48 beat for long values (>= 1 beat).
- End clamp tolerance: 1/64 beat to avoid overlaps without swallowing intentional gaps.

- Whether to allow dotted values by default or only when clearly intended.

Suggestion: only allow dotted when both start and end align to the same 1/8 grid and the duration is within tolerance of {3/8, 3/4, 3/2}. Otherwise prefer straight values and ties.

- How to detect triplet usage in a clip without explicit metadata.

Defer

We want to use effect v4 for the implementation.

Effect v4 guidance from `refs/effect4/ai-docs/src/01_effect/01_basics/index.md`:

```
Prefer writing Effect code with Effect.gen & Effect.fn("name"). Then attach additional behaviour with combinators.
```

Effect v4 guidance from `refs/effect4/ai-docs/src/01_effect/02_services/index.md`:

```
Effect services are the most common way to structure Effect code. Prefer using services to encapsulate behaviour...
```

---

## Suggested validation steps

- Render current clip with debug artifacts and compare before/after:
  - `logs/score-debug.ly`
  - `logs/score-debug.svg`
- Use the same input notes to confirm that the visual rhythm improves and bar placement remains stable.
