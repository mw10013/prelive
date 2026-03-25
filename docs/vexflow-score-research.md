# VexFlow Score Display — Deep Dive

Date: 2026-03-24

Focus: Using VexFlow 5 to render our `Note[]` as a score in the browser.

Companion to: `lilypond-score-research.md`

---

## Decisions

| Decision          | Choice                                        |
| ----------------- | --------------------------------------------- |
| API               | Low-level `StaveNote` (not EasyScore strings) |
| Quantization grid | 32nd notes                                    |
| Key signature     | Defer — show all accidentals explicitly       |
| Layout            | Auto-wrap (system-per-row)                    |
| Fonts             | CDN (Bravura + Academico)                     |

---

## VexFlow Overview

VexFlow is a **pure TypeScript/JavaScript** library that renders music notation to SVG or Canvas. No server dependency. v5.0.0 released March 2025.

---

## The Score Model

```
Factory
  └── System (one or more staves, formatted together)
       └── Stave (a single measure/staff with clef + time sig)
            └── Voice (a sequence of notes that fills the measure)
                 └── StaveNote (a single note or chord)
                      └── Accidental, Dot, etc. (modifiers)
```

**Key constraint**: One `Stave` = one measure. Each voice must fill exactly `num_beats` worth of notes.

---

## Low-level API (our approach)

```ts
import { VexFlow, StaveNote } from "vexflow";

const renderer = new VexFlow.Renderer(div, VexFlow.Renderer.Backends.SVG);
renderer.resize(800, 200);
const ctx = renderer.getContext();

const stave = new Stave(10, 40, 400);
stave.addClef("treble").addTimeSignature("4/4");
stave.setContext(ctx).draw();

const notes = [
  new StaveNote({ keys: ["c/5"], duration: "q" }),
  new StaveNote({ keys: ["d/4"], duration: "q" }),
  new StaveNote({ keys: ["b/4"], duration: "qr" }),
  new StaveNote({ keys: ["c/4", "e/4", "g/4"], duration: "q" }),
];

const voice = new Voice({ num_beats: 4, beat_value: 4 });
voice.addTickables(notes);

new Formatter().joinVoices([voice]).format([voice], 350);
voice.draw(ctx, stave);
```

---

## Duration Codes

| Code | Duration       | Beats (4/4) |
| ---- | -------------- | ----------- |
| `w`  | whole          | 4           |
| `h`  | half           | 2           |
| `q`  | quarter        | 1           |
| `8`  | eighth         | 0.5         |
| `16` | sixteenth      | 0.25        |
| `32` | thirty-second  | 0.125       |
| `64` | sixty-fourth   | 0.0625      |
| `qd` | dotted quarter | 1.5         |
| `hd` | dotted half    | 3           |
| `8d` | dotted eighth  | 0.75        |
| `wd` | dotted whole   | 6           |
| `hr` | half rest      |             |
| `qr` | quarter rest   |             |
| `8r` | eighth rest    |             |

Append `d` for dotted. Append `r` for rest.

---

## Note Names

| Our pitch | Note          | VexFlow key |
| --------- | ------------- | ----------- |
| 60        | C4 (middle C) | `c/4`       |
| 61        | C#4           | `c#/4`      |
| 62        | D4            | `d/4`       |
| 63        | Eb4           | `eb/4`      |
| 64        | E4            | `e/4`       |
| 65        | F4            | `f/4`       |
| 66        | F#4           | `f#/4`      |
| 67        | G4            | `g/4`       |
| 68        | G#4           | `g#/4`      |
| 69        | A4            | `a/4`       |
| 70        | Bb4           | `bb/4`      |
| 71        | B4            | `b/4`       |
| 72        | C5            | `c/5`       |

---

## Conversion Pipeline: Note[] → VexFlow

### Step 1: MIDI pitch → VexFlow key

```ts
const SHARPS = [
  "c",
  "c#",
  "d",
  "d#",
  "e",
  "f",
  "f#",
  "g",
  "g#",
  "a",
  "a#",
  "b",
];

function midiToVexFlowKey(pitch: number): string {
  const octave = Math.floor(pitch / 12) - 1;
  const name = SHARPS[pitch % 12];
  return `${name}/${octave}`;
}
```

### Step 2: Beat duration → VexFlow duration (32nd grid)

```ts
function beatsToDuration(beats: number): string {
  const map: [number, string][] = [
    [4, "w"],
    [3, "hd"],
    [2, "h"],
    [1.5, "qd"],
    [1, "q"],
    [0.75, "8d"],
    [0.5, "8"],
    [0.375, "16d"],
    [0.25, "16"],
    [0.125, "32"],
    [0.0625, "64"],
  ];
  let best = "q";
  let bestDiff = Infinity;
  for (const [len, code] of map) {
    const diff = Math.abs(beats - len);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = code;
    }
  }
  return best;
}
```

Quantization strategy: snap to nearest standard duration. The 32nd note grid means we accept ~0.125 beat precision. Notes that don't land on the grid get rounded — this is acceptable for a score visualization (not playback).

### Step 3: Group into measures

1. Sort notes by `start_time`, then `pitch`
2. Determine measure boundaries from `timeSigNum` (beats per measure)
3. Assign notes to their starting measure
4. Group simultaneous notes (same `start_time`) into chords
5. Fill gaps with rests so each measure is exactly full

### Step 4: Build VexFlow objects

```ts
// For each measure:
const staveNotes = [
  // If gap at start: insert rest(s)
  new StaveNote({ keys: ["b/4"], duration: "qr" }),
  // Single note:
  new StaveNote({ keys: ["c/5"], duration: "q" }),
  // Chord (simultaneous notes):
  new StaveNote({ keys: ["c/4", "e/4", "g/4"], duration: "q" }),
  // Rest:
  new StaveNote({ keys: ["b/4"], duration: "hr" }),
];
```

---

## What We Need from LOM

### Already queried

| Field                     | Used for                    |
| ------------------------- | --------------------------- |
| `Clip.notes[].pitch`      | VexFlow key                 |
| `Clip.notes[].start_time` | Measure grouping, ordering  |
| `Clip.notes[].duration`   | VexFlow duration            |
| `Clip.length`             | Total beats → measure count |

### Need to add to query

| Field                        | Used for                        | In Domain.ts? |
| ---------------------------- | ------------------------------- | ------------- |
| `Clip.signature_numerator`   | Beats per measure               | Yes, line 44  |
| `Clip.signature_denominator` | Beat value (bottom of time sig) | Yes, line 43  |

Add to `liveql.ts:10` GraphQL query:

```graphql
{
  live_set {
    view {
      detail_clip {
        id
        name
        length
        is_midi_clip
        signature_numerator
        signature_denominator
        notes {
          note_id
          pitch
          start_time
          duration
          velocity
          mute
          probability
          velocity_deviation
          release_velocity
        }
      }
    }
  }
}
```

Also update `ClipInfo` interface in `index.tsx`:

```ts
interface ClipInfo {
  id: number;
  name: string;
  length: number;
  signatureNumerator: number;
  signatureDenominator: number;
}
```

---

## Dependencies

Add to `package.json` dependencies:

```json
"vexflow": "5.0.0"
```

That's it. VexFlow 5 has no runtime dependencies. It bundles its own font data.

---

## React Integration

### Component

```tsx
// src/components/ScoreDisplay.tsx
import { useRef, useEffect } from "react";
import { VexFlow } from "vexflow";
import type { Note } from "@/lib/Domain";

interface ScoreDisplayProps {
  notes: Note[];
  timeSigNum: number;
  timeSigDen: number;
}

export function ScoreDisplay({
  notes,
  timeSigNum,
  timeSigDen,
}: ScoreDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || notes.length === 0) return;
    containerRef.current.innerHTML = "";

    VexFlow.loadFonts("Bravura", "Academico").then(() => {
      VexFlow.setFonts("Bravura", "Academico");
      renderScore(containerRef.current!, notes, timeSigNum, timeSigDen);
    });
  }, [notes, timeSigNum, timeSigDen]);

  if (notes.length === 0) return null;
  return <div ref={containerRef} />;
}
```

### Placement in index route

After NoteTable:

```tsx
{
  clipInfo && notes.length > 0 && (
    <ScoreDisplay
      notes={notes}
      timeSigNum={clipInfo.signatureNumerator}
      timeSigDen={clipInfo.signatureDenominator}
    />
  );
}
```

---

## File Structure

```
src/lib/vexflow/
  midi-to-key.ts        — pitch → "c#/4" conversion
  beats-to-duration.ts  — duration → "q", "8d", etc. (nearest match on 32nd grid)
  notes-to-measures.ts  — sort, group simultaneous, split into measures, fill rests
  render-score.ts       — orchestrates: measures → Staves → Voices → Factory → draw

src/components/
  ScoreDisplay.tsx       — React wrapper, useEffect, ref, font loading
```

---

## The Hard Parts (all deferrable)

### Notes spanning barlines

A note starting at beat 3.5 with duration 2 crosses the barline. VexFlow supports ties (`StaveTie`). For MVP: truncate at measure boundary. Later: split and tie.

### Voice separation

Polyphonic music needs multiple voices. Start with single voice (all notes in one voice, chords via `keys: [...]`). Defer independent voice handling.

### Key signature

Show all accidentals explicitly. Later: `Accidental.applyAccidentals(keySignature)` to suppress redundant sharps/flats.

---

## Implementation Gaps

1. **`readClip` query** — needs `signature_numerator`, `signature_denominator` added
2. **`ClipInfo` interface** — needs the two new fields
3. **Font loading** — `loadFonts` is async, needs `await` or `.then()` in useEffect. CDN fonts work, but the component may flash empty until loaded. Acceptable for now.
4. **Dynamic SVG height** — calculate from measure count: `measures = ceil(clip.length / timeSigNum)`, rows = `ceil(measures / 4)`, height = `rows * 150 + padding`
5. **Re-render on edit** — useEffect with `[notes, ...]` deps handles this. Each table edit triggers re-render. Could debounce if performance is an issue.
