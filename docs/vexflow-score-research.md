# VexFlow Score Display — Deep Dive

Date: 2026-03-24

Focus: Using VexFlow 5 to render our `Note[]` as a score in the browser.

Companion to: `lilypond-score-research.md`

---

## VexFlow Overview

VexFlow is a **pure TypeScript/JavaScript** library that renders music notation to SVG or Canvas. No server dependency. v5.0.0 released March 2025.

Two APIs:
- **Low-level**: `Stave` + `StaveNote` + `Voice` + `Formatter` — build everything imperatively
- **High-level**: `Factory` + `EasyScore` — string-based note entry, recommended starting point

---

## The Score Model

VexFlow requires us to build a structured score. The hierarchy:

```
Factory
  └── System (one or more staves, formatted together)
       └── Stave (a single measure/staff with clef + time sig)
            └── Voice (a sequence of notes that fills the measure)
                 └── StaveNote (a single note or chord)
                      └── Accidental, Dot, etc. (modifiers)
```

**Key constraint**: One `Stave` = one measure. For a clip of 16 beats in 4/4, we need 4 staves (measures). Each voice must fill exactly `num_beats` worth of notes.

---

## Two API Approaches

### 1. Factory + EasyScore (string-based)

```ts
import { VexFlow } from "vexflow"

VexFlow.loadFonts('Bravura', 'Academico').then(() => {
  VexFlow.setFonts('Bravura', 'Academico')

  const factory = new VexFlow.Factory({
    renderer: { elementId: 'output', width: 800, height: 200 },
  })
  const score = factory.EasyScore()
  const system = factory.System()

  system.addStave({
    voices: [
      score.voice(score.notes('C#5/q, B4, A4, G#4', { stem: 'up' })),
      score.voice(score.notes('C#4/h, C#4', { stem: 'down' })),
    ],
  }).addClef('treble').addTimeSignature('4/4')

  factory.draw()
})
```

EasyScore string format: `NoteNameOctave/duration, ...`
- `C#5/q` = C# in octave 5, quarter note
- `B4` = B in octave 4, same duration as previous
- `(C4 E4 G4)/q` = C major chord, quarter note
- `B4/8/r` = eighth rest on B4 line
- `A5/q..` = quarter note with two dots

**Pro**: Concise, readable. **Con**: Need to generate strings, limited programmatic control.

### 2. Low-level (StaveNote directly)

```ts
import { VexFlow, Stave, StaveNote, Voice, Formatter } from "vexflow"

const renderer = new VexFlow.Renderer(div, VexFlow.Renderer.Backends.SVG)
renderer.resize(800, 200)
const ctx = renderer.getContext()

const stave = new Stave(10, 40, 400)
stave.addClef('treble').addTimeSignature('4/4')
stave.setContext(ctx).draw()

const notes = [
  new StaveNote({ keys: ['c/5'], duration: 'q' }),
  new StaveNote({ keys: ['d/4'], duration: 'q' }),
  new StaveNote({ keys: ['b/4'], duration: 'qr' }),
  new StaveNote({ keys: ['c/4', 'e/4', 'g/4'], duration: 'q' }),
]

const voice = new Voice({ num_beats: 4, beat_value: 4 })
voice.addTickables(notes)

new Formatter().joinVoices([voice]).format([voice], 350)
voice.draw(ctx, stave)
```

**Pro**: Full control, type-safe. **Con**: More verbose.

---

## VexFlow Duration Codes

| Code | Duration | Beats (4/4) |
|------|----------|-------------|
| `w` | whole | 4 |
| `h` | half | 2 |
| `q` | quarter | 1 |
| `8` | eighth | 0.5 |
| `16` | sixteenth | 0.25 |
| `32` | thirty-second | 0.125 |
| `64` | sixty-fourth | 0.0625 |
| `qd` | dotted quarter | 1.5 |
| `hd` | dotted half | 3 |
| `8d` | dotted eighth | 0.75 |
| `wd` | dotted whole | 6 |
| `hr` | half rest | |
| `qr` | quarter rest | |
| `8r` | eighth rest | |

Append `d` for dotted. Append `r` for rest.

---

## VexFlow Note Names

Format: `noteName/octave`

| Our pitch | Note | VexFlow key | VexFlow EasyScore |
|-----------|------|-------------|-------------------|
| 60 | C4 (middle C) | `c/4` | `C4` |
| 61 | C#4 | `c#/4` | `C#4` |
| 62 | D4 | `d/4` | `D4` |
| 63 | Eb4 | `eb/4` | `Eb4` |
| 64 | E4 | `e/4` | `E4` |
| 65 | F4 | `f/4` | `F4` |
| 66 | F#4 | `f#/4` | `F#4` |
| 67 | G4 | `g/4` | `G4` |
| 68 | G#4 | `g#/4` | `G#4` |
| 69 | A4 | `a/4` | `A4` |
| 70 | Bb4 | `bb/4` | `Bb4` |
| 71 | B4 | `b/4` | `B4` |
| 72 | C5 | `c/5` | `C5` |

---

## Conversion Pipeline: Note[] → VexFlow

### Step 1: MIDI pitch → VexFlow key

```ts
const SHARPS = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']
const FLATS  = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b']

function midiToVexFlowKey(pitch: number, useFlats = false): string {
  const names = useFlats ? FLATS : SHARPS
  const octave = Math.floor(pitch / 12) - 1
  const name = names[pitch % 12]
  return `${name}/${octave}`
}
```

### Step 2: Beat duration → VexFlow duration

```ts
function beatsToDuration(beats: number): string {
  // Map beat lengths to VexFlow duration codes
  // Exact matches first
  const map: [number, string][] = [
    [4,    'w'],
    [3,    'hd'],   // dotted half
    [2,    'h'],
    [1.5,  'qd'],   // dotted quarter
    [1,    'q'],
    [0.75, '8d'],   // dotted eighth
    [0.5,  '8'],
    [0.25, '16'],
    [0.125,'32'],
  ]
  // Find closest match (quantize)
  let best = 'q'
  let bestDiff = Infinity
  for (const [len, code] of map) {
    const diff = Math.abs(beats - len)
    if (diff < bestDiff) { bestDiff = diff; best = code }
  }
  return best
}
```

**Problem**: Not all durations quantize cleanly. A note of 0.33 beats (triplet eighth) doesn't map to any standard duration. Options:
1. Quantize to nearest (lose precision in visual representation)
2. Use tuplets (complex — VexFlow supports them but grouping is manual)
3. Accept the visual inaccuracy for now

### Step 3: Group notes by measure, handle simultaneous notes

This is the hard part. VexFlow requires:

1. **Measures**: Notes must be grouped into measures that exactly fill `num_beats`
2. **Voices**: Within a measure, simultaneous notes go in separate voices (stems up/down)
3. **Chords**: Simultaneous notes at the same pitch level become chord notes (`keys: ['c/4', 'e/4', 'g/4']`)

```ts
interface MeasureNotes {
  voice1: StaveNote[]  // melody (higher pitches, stem up)
  voice2: StaveNote[]  // accompaniment (lower pitches, stem down)
}

function groupIntoMeasures(
  notes: Note[],
  timeSigNum: number,
  timeSigDen: number,
): MeasureNotes[] {
  const beatsPerMeasure = timeSigNum  // e.g., 4 in 4/4
  const totalBeats = Math.max(...notes.map(n => n.start_time + n.duration))
  const measureCount = Math.ceil(totalBeats / beatsPerMeasure)

  const measures: MeasureNotes[] = []

  for (let m = 0; m < measureCount; m++) {
    const measureStart = m * beatsPerMeasure
    const measureEnd = measureStart + beatsPerMeasure

    // Get notes that start within this measure
    const measureNotes = notes.filter(
      n => n.start_time >= measureStart && n.start_time < measureEnd
    )

    // Group simultaneous notes
    const groups = groupSimultaneous(measureNotes)

    // Build voices
    // For now: put all notes in voice1, fill gaps with rests
    const voice1 = buildVoiceFromGroups(groups, measureStart, beatsPerMeasure)

    measures.push({ voice1, voice2: [] })
  }

  return measures
}
```

### Step 4: Fill gaps with rests

VexFlow requires voices to be exactly `num_beats` long. If there are gaps between notes, we need to insert rests:

```ts
function fillGapsWithRests(
  notes: StaveNote[],
  totalBeats: number,
): StaveNote[] {
  // Walk through the timeline, insert rests for gaps
  // ...
}
```

---

## What We Need from LOM

### Already queried

| Field | Used for |
|-------|----------|
| `Clip.notes[].pitch` | VexFlow key |
| `Clip.notes[].start_time` | Measure grouping, ordering |
| `Clip.notes[].duration` | VexFlow duration |
| `Clip.length` | Total beats → measure count |

### Need to add to query

| Field | Used for | In Domain.ts? |
|-------|----------|---------------|
| `Clip.signature_numerator` | Beats per measure (top of time sig) | Yes, line 44 |
| `Clip.signature_denominator` | Note value that gets the beat (bottom of time sig) | Yes, line 43 |

These are already in `Domain.ts:43-44` but **not queried** in `liveql.ts:10`. We'd need to add them:

```graphql
{ live_set { view { detail_clip {
    id name length is_midi_clip
    signature_numerator signature_denominator
    notes { note_id pitch start_time duration velocity mute probability velocity_deviation release_velocity }
  } } } }
```

### Not needed (per your request)

- Velocity / dynamics — skip
- Key signature — skip (use sharps by default, or detect from notes)
- Tempo marking — skip
- Articulations — skip

---

## React Integration

### Component structure

```tsx
// src/components/ScoreDisplay.tsx
import { useRef, useEffect } from "react"
import { VexFlow } from "vexflow"
import type { Note } from "@/lib/Domain"

interface ScoreDisplayProps {
  notes: Note[]
  timeSigNum: number
  timeSigDen: number
}

export function ScoreDisplay({ notes, timeSigNum, timeSigDen }: ScoreDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || notes.length === 0) return

    // Clear previous render
    containerRef.current.innerHTML = ""

    VexFlow.loadFonts('Bravura', 'Academico').then(() => {
      VexFlow.setFonts('Bravura', 'Academico')

      const factory = new VexFlow.Factory({
        renderer: {
          elementId: containerRef.current!,
          width: 900,
          height: 400,
        },
      })

      // ... convert notes to VexFlow staves ...

      factory.draw()
    })
  }, [notes, timeSigNum, timeSigDen])

  if (notes.length === 0) return null
  return <div ref={containerRef} />
}
```

### Placement in index route

```tsx
// In src/routes/index.tsx, after NoteTable
{clipInfo && notes.length > 0 && (
  <ScoreDisplay
    notes={notes}
    timeSigNum={clipInfo.signatureNumerator}
    timeSigDen={clipInfo.signatureDenominator}
  />
)}
```

---

## The Hard Parts

### 1. Splitting notes across measures

A note starting at beat 3.5 with duration 2 beats spans across a barline. VexFlow handles ties (`StaveTie`) but we'd need to split such notes into two tied notes at the measure boundary. **Can defer** — for MVP, truncate notes at measure boundary.

### 2. Voice separation

Polyphonic music needs multiple voices (stem up/down). For a single melodic line this is trivial — one voice. For chords at different times, VexFlow handles them fine in one voice if we use `keys: [...]` for simultaneous notes. For truly independent voices (e.g., two hands on piano), we'd need proper voice separation. **Can defer** — start with single voice.

### 3. Quantization

MIDI durations are floats. VexFlow durations are discrete. We need a quantization strategy. Simplest: round to nearest 16th note. Better: snap to a grid (e.g., 1/16 or 1/32) then detect patterns.

### 4. Automatic beaming

`Beam.generateBeams(notes)` handles beaming of 8th/16th notes automatically. Works well for grouped notes.

### 5. Clef selection

Notes below ~pitch 60 (middle C) would benefit from bass clef. Simple heuristic: if average pitch < 60, use bass clef, else treble. Or always treble for simplicity.

---

## Decision: Low-level vs EasyScore

| Factor | Low-level (StaveNote) | EasyScore (strings) |
|--------|----------------------|---------------------|
| Type safety | Full TypeScript types | String parsing, less type safety |
| Programmatic generation | Direct object construction | Need to build strings |
| Chords | `keys: ['c/4', 'e/4']` | `(C4 E4)/q` string syntax |
| Accidentals | `.addModifier(new Accidental('#'))` | `C#5` in string |
| Dots | `Dot.buildAndAttach([note])` | `C5/q.` in string |
| Rests | `{ keys: ['b/4'], duration: 'qr' }` | `B4/qr` |
| Dynamic width | Formatter handles it | Formatter handles it |

**Recommendation**: Use **low-level API** (`StaveNote` directly). We're generating notes programmatically from data, not writing them by hand. Building strings and then parsing them is an unnecessary indirection. The low-level API is type-safe and gives us full control over placement and modifiers.

---

## Proposed Architecture

```
src/lib/vexflow/
  midi-to-key.ts      — pitch → "c#/4" conversion
  beats-to-duration.ts — duration → "q", "8d", etc.
  quantize.ts          — snap durations to standard grid
  notes-to-measures.ts — group Note[] into measures with rests
  render-score.ts      — takes Note[], time sig, container → draws score

src/components/
  ScoreDisplay.tsx     — React wrapper with useEffect + ref
```

The core conversion function:

```ts
export function renderScore(
  container: HTMLElement,
  notes: Note[],
  timeSigNum: number,
  timeSigDen: number,
): void {
  const beatsPerMeasure = timeSigNum
  const measures = groupIntoMeasures(notes, beatsPerMeasure)

  VexFlow.loadFonts('Bravura', 'Academico').then(() => {
    VexFlow.setFonts('Bravura', 'Academico')

    const factory = new VexFlow.Factory({
      renderer: { elementId: container, width: 900, height: 200 * Math.ceil(measures.length / 4) },
    })

    let system = factory.System({ x: 10, y: 10, width: 850 })

    for (let i = 0; i < measures.length; i++) {
      const measure = measures[i]
      const voice = factory.Voice({
        time: { num_beats: beatsPerMeasure, beat_value: timeSigDen },
      })
      voice.addTickables(measure.voice1)

      const isFirst = i === 0
      const stave = system.addStave({
        voices: [voice],
      })

      if (isFirst) {
        stave.addClef('treble').addTimeSignature(`${timeSigNum}/${timeSigDen}`)
      }

      // Auto-beam
      const beams = VexFlow.Beam.generateBeams(measure.voice1)

      // Every 4 measures, start a new system
      if ((i + 1) % 4 === 0 && i < measures.length - 1) {
        system = factory.System({ x: 10, y: system.y + 150, width: 850 })
      }
    }

    factory.draw()
  })
}
```

---

## Open Questions

| # | Question | Notes |
|---|----------|-------|
| 1 | Font loading | VexFlow 5 requires `loadFonts()` then `setFonts()`. Fonts loaded via `fetch` — need to be available. CDN fonts work fine. |
| 2 | React re-render | `useEffect` with deps on `[notes, timeSigNum, timeSigDen]`. Clear container innerHTML before re-render. |
| 3 | Dynamic height | Score height depends on measure count. Calculate from `clip.length / timeSigNum` measures. |
| 4 | Quantization grid | 16th note grid? 32nd? How aggressive? |
| 5 | Key signature | Skip for now — show all accidentals explicitly. Could add `Accidental.applyAccidentals()` later. |
| 6 | Layout | Single row? Multiple rows of 4 measures? Auto-wrap? |
