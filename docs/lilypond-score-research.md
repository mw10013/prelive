# LilyPond Score Display — Research

Date: 2026-03-24

Goal: Convert `Note[]` from Ableton Live (via liveql) into a rendered music score displayed on a web page.

---

## Our Note Schema

From `src/lib/Domain.ts:48`:

```ts
Note {
  pitch: number          // MIDI pitch 0-127 (60 = middle C)
  start_time: number     // beats (float)
  duration: number       // beats (float)
  velocity: number       // 0-127
  mute: boolean
  probability: number    // 0-1
  velocity_deviation: number
  release_velocity: number
  note_id: number
}
```

These are **absolute-positioned notes with float beat timing** — essentially a piano roll representation. No measure/bar structure is provided by liveql; notes are just pitch + position + duration.

---

## LilyPond

### What it is

LilyPond is a CLI music engraving program. You feed it a text file describing music, it outputs PDF/SVG/PNG. Think of it like LaTeX for music. It is **not** a JavaScript library — it's a standalone binary.

**Latest stable**: 2.24.4 (July 2024)
**Latest unstable**: 2.25.80 (March 2026)

### Input format (`.ly` files)

LilyPond uses a text-based notation language. Key concepts:

| Concept       | LilyPond syntax                                         | Example                            |
| ------------- | ------------------------------------------------------- | ---------------------------------- |
| Pitches       | `c d e f g a b` (Dutch names)                           | `c' d' e'` (octave above middle C) |
| Octave        | `'` = up, `,` = down from middle                        | `c,,` = two octaves below middle C |
| Duration      | Number after note: 1=whole, 2=half, 4=quarter, 8=eighth | `c4 d8 e8`                         |
| Dots          | `.` after duration                                      | `c4.` = dotted quarter             |
| Rests         | `r`                                                     | `r4 r2`                            |
| Relative mode | `\relative { c d e f }`                                 | Auto-octave selection              |
| Time sig      | `\time 3/4`                                             |                                    |
| Tempo         | `\tempo 4=120`                                          |                                    |

### Minimal LilyPond file

```lilypond
\version "2.24.4"
\relative {
  \clef treble
  \time 4/4
  c'4 d e f | g1
}
```

---

## Conversion: Note[] → LilyPond

### Pitch mapping

MIDI pitch → LilyPond note name + octave marks:

```ts
const NOTE_NAMES = [
  "c",
  "cis",
  "d",
  "dis",
  "e",
  "f",
  "fis",
  "g",
  "gis",
  "a",
  "ais",
  "b",
];

function pitchToLilypond(midiPitch: number): string {
  const octave = Math.floor(midiPitch / 12) - 1; // MIDI octave number
  const noteInOctave = midiPitch % 12;
  const name = NOTE_NAMES[noteInOctave];
  // LilyPond: c' is octave 4 (one above middle C)
  // MIDI octave 4 = LilyPond octave with one '
  // MIDI octave 3 = middle C = c' in LilyPond
  // So: octave marks = octave - 3
  const marks = octave - 3;
  if (marks > 0) return name + "'".repeat(marks);
  if (marks < 0) return name + ",".repeat(-marks);
  return name;
}
```

**Example**: pitch 60 → `c'`, pitch 64 → `e'`, pitch 48 → `c`, pitch 72 → `c''`

### Duration mapping

LilyPond durations are fractions of a whole note: `1`=whole, `2`=half, `4`=quarter, `8`=eighth, `16`=sixteenth, etc.

Our notes use beat durations. Assuming 4/4 time (1 beat = quarter note):

| Beat duration | LilyPond              |     |
| ------------- | --------------------- | --- |
| 4.0           | `1` (whole)           |     |
| 2.0           | `2` (half)            |     |
| 1.0           | `4` (quarter)         |     |
| 0.5           | `8` (eighth)          |     |
| 0.25          | `16` (sixteenth)      |     |
| 1.5           | `4.` (dotted quarter) |     |
| 0.75          | `8.` (dotted eighth)  |     |

General formula: `lilypondDuration = 4 / beatDuration`

**Problem**: LilyPond only supports powers of 2 (with optional dots). Arbitrary float durations (e.g., 0.33 beats) don't map cleanly. Options:

1. **Quantize** to nearest standard duration (round to 1/16 or 1/32)
2. **Tuplets** for triplets etc. (complex)
3. **Ignore** — round and accept small timing differences in the visual representation

### Chords / overlapping notes

LilyPond handles chords with angle brackets: `<c e g>4`

Notes with the same `start_time` should be grouped into chords. Notes at different `start_time` values form a sequence. This requires:

1. Sort notes by `start_time` then `pitch`
2. Group simultaneous notes
3. Output rests for gaps between notes

### Velocity

LilyPond supports dynamics (`\p`, `\mf`, `\ff`) but these are text markings, not exact values. We could:

1. Map velocity ranges to dynamics: `<40 pp`, `40-60 p`, `60-80 mp`, `80-100 mf`, `100-120 f`, `>120 ff`
2. Ignore for now (it's a score, not a performance rendering)

### Converting the full pipeline

```
Note[]
  → sort by start_time, pitch
  → group simultaneous notes (chords)
  → fill gaps with rests
  → convert pitch to LilyPond note name
  → convert duration to LilyPond duration
  → wrap in \relative { ... }
  → prepend header (\version, \clef, \time)
  → output as .ly string
```

---

## Rendering: Score on a Web Page

This is the harder problem. Three main approaches:

### Option A: LilyPond CLI (server-side) → SVG

**How it works**: Run `lilypond` binary on the server, generate SVG, serve to browser.

| Aspect       | Detail                                                                                 |
| ------------ | -------------------------------------------------------------------------------------- |
| Quality      | **Excellent** — professional engraving, the gold standard                              |
| Setup        | Requires LilyPond binary installed on server                                           |
| Output       | SVG (scalable, embeddable)                                                             |
| Latency      | ~100-500ms per render (slow for CLI spawn)                                             |
| Node wrapper | [lilynode](https://www.npmjs.com/package/lilynode) — thin wrapper, outputs SVG/PNG/PDF |

```ts
import { render } from "lilynode";
const svg = await render(lilypondString, { format: "svg" });
```

**Pros**: Best possible engraving quality. Supports everything LilyPond does.
**Cons**: Requires server-side binary. Latency for CLI invocation. No real-time preview.

**TanStack Start integration**: Create a server function (`createServerFn`) that takes `Note[]`, converts to `.ly`, calls lilynode, returns SVG string. Render SVG inline.

### Option B: VexFlow (client-side, direct API)

**How it works**: JavaScript library that draws music notation directly to SVG/Canvas. No LilyPond involved.

| Aspect     | Detail                            |
| ---------- | --------------------------------- |
| Quality    | Good — not as refined as LilyPond |
| Setup      | `npm install vexflow`             |
| Output     | SVG or Canvas directly in DOM     |
| Latency    | Instant (client-side)             |
| TypeScript | Full types, written in TS         |
| Version    | 5.0.0 (March 2025)                |

```ts
import { Factory } from "vexflow";
const vf = new Factory({
  renderer: { elementId: "score", width: 800, height: 200 },
});
const score = vf.EasyScore();
const system = score.system();
system.addStave({ voices: [score.voice(score.notes("C#4/q, B4, A4, G#4"))] });
vf.draw();
```

**Pros**: Pure JS, no server dependency, instant render, good TypeScript support.
**Cons**: Lower engraving quality than LilyPond. API is more programmatic — you build staves/voices manually, not from a text format. Mapping from flat Note[] to VexFlow's structured model (staves, voices, beams, ties) is non-trivial.

### Option C: abcjs (client-side, ABC notation)

**How it works**: JavaScript library that parses ABC notation text and renders to SVG.

| Aspect    | Detail                         |
| --------- | ------------------------------ |
| Quality   | Decent — simpler than LilyPond |
| Setup     | `npm install abcjs`            |
| Output    | SVG in DOM                     |
| Latency   | Instant (client-side)          |
| Downloads | 23K/week npm                   |
| Version   | 6.6.2 (Feb 2026)               |

```ts
import abcjs from "abcjs";
abcjs.renderAbc("score", "X:1\nT:Example\nK:C\nC D E F | G8\n");
```

**Pros**: Text-based input (like LilyPond but simpler). Pure JS. Well-maintained. Good for lead sheets, simple melodies. Also has MIDI playback.
**Cons**: Less capable than LilyPond for complex notation. ABC is simpler than LilyPond — fewer features.

### Option D: OpenSheetMusicDisplay (client-side, MusicXML)

| Aspect  | Detail                              |
| ------- | ----------------------------------- |
| Quality | Good (uses VexFlow internally)      |
| Setup   | `npm install opensheetmusicdisplay` |
| Input   | MusicXML (not text — XML format)    |
| Version | 1.9.7 (Feb 2026)                    |

**Pros**: Full MusicXML support, good for complex scores.
**Cons**: MusicXML is verbose XML — not pleasant to generate programmatically. Heavy dependency (includes VexFlow).

### Option E: Verovio (client-side, MEI format)

| Aspect  | Detail                             |
| ------- | ---------------------------------- |
| Quality | Excellent for academic/early music |
| Input   | MEI (XML), also supports MusicXML  |
| WASM    | Has a WebAssembly build            |
| Setup   | `npm install verovio`              |

**Cons**: MEI is academic/research-focused XML. Heavy for our use case.

### Option F: LilyPond WASM in browser?

**Does not exist.** LilyPond is written in C++/Guile Scheme and has never been compiled to WebAssembly. The old WebLily.net ran LilyPond server-side and served SVG. LilyBin used Docker containers. There is no browser-native LilyPond.

---

## Recommendation Matrix

| Approach                   | Quality | Complexity | Latency | Server Dep? | Fit for our case                     |
| -------------------------- | ------- | ---------- | ------- | ----------- | ------------------------------------ |
| **A: LilyPond + lilynode** | ★★★★★   | Medium     | ~200ms  | Yes         | Best quality, fits server fn pattern |
| **B: VexFlow**             | ★★★☆☆   | High       | Instant | No          | Programmatic API, complex mapping    |
| **C: abcjs**               | ★★★☆☆   | Low        | Instant | No          | Simple text format, easiest path     |
| **D: OSMD**                | ★★★★☆   | Medium     | Instant | No          | MusicXML is verbose to generate      |
| **E: Verovio**             | ★★★★☆   | High       | Instant | No          | Overkill for MIDI notes              |

---

## My Recommendation

**For a quick, practical integration**: **abcjs** or **VexFlow**

Both are pure JS, no server dependency, instant rendering, and can be dropped into the index route below the NoteTable.

- **abcjs** is closest to the LilyPond approach (text-based notation). We'd convert `Note[]` → ABC text → `renderAbc()` → SVG. ABC notation is simpler than LilyPond but handles melody/chords well. Easy to generate programmatically.
- **VexFlow** gives more control but requires building the score model (staves, voices, notes) programmatically rather than from text.

**For best quality**: **LilyPond CLI via lilynode**

Create a server function that converts notes to `.ly`, calls lilynode to render SVG, returns the SVG string. Render inline. This gives professional engraving. The tradeoff is ~200ms latency per render and a server dependency (which we already have for the GraphQL calls).

**For ABC specifically**, the conversion from our Note model is straightforward:

```ts
// Our notes → ABC notation
function notesToAbc(notes: Note[], timeSig = "4/4"): string {
  const sorted = [...notes].sort(
    (a, b) => a.start_time - b.start_time || a.pitch - b.pitch,
  );
  // group simultaneous notes (same start_time) into chords
  // convert pitch: MIDI 60 = C in octave 4 = C in ABC
  // convert duration: 1 beat = quarter = /4 in ABC
  // fill rests for gaps
  return `X:1\nT:Clip\nM:${timeSig}\nL:1/4\nK:C\n${abcNotes}\n`;
}
```

ABC note format: `C` = middle C, `c` = octave above, `C,` = octave below. Durations: `C2` = half, `C/2` or `C/` = eighth.

---

## Integration Point: Index Route

The score display would go in `src/routes/index.tsx` below the NoteTable, gated on `clipInfo && notes.length > 0`. It would use the same `notes` state that the table uses — so any edits in the table would reflect in the score (via re-render).

```tsx
// After NoteTable...
{
  clipInfo && notes.length > 0 && (
    <ScoreDisplay notes={notes} clipInfo={clipInfo} />
  );
}
```

A `<ScoreDisplay>` component would:

1. Take `notes: Note[]` as prop
2. Convert to the chosen format (ABC text / LilyPond text / VexFlow API calls)
3. Render to SVG
4. Re-render on prop changes (React re-render when notes state changes)

---

## Open Questions

| #   | Question                       | Notes                                                                                                                                   |
| --- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Single track or multi-track?   | Current data is one clip = one track. Multiple tracks would need separate staves.                                                       |
| 2   | Real-time preview as you edit? | If client-side (abcjs/VexFlow), yes instant. If server-side (lilynode), debounced re-render.                                            |
| 3   | Chord detection?               | Need to group simultaneous notes. How aggressive? Exact `start_time` match, or within epsilon?                                          |
| 4   | Quantization strategy?         | LilyPond needs standard durations. ABC is more flexible but still limited. How to handle triplet timing etc.?                           |
| 5   | Key signature / accidentals?   | Notes are raw MIDI pitches. LilyPond can auto-detect key or we can force it. For ABC, sharps/flats are explicit (`^C` = C#, `_D` = Db). |
| 6   | Playback?                      | abcjs has built-in MIDI playback. VexFlow needs external MIDI. LilyPond SVG has no playback.                                            |
| 7   | Which library?                 | **Need your input** — see recommendation above.                                                                                         |

---

## Reference Links

- LilyPond docs: `refs/lilypond/` (not downloaded — web only)
- LilyPond notation reference: https://lilypond.org/doc/v2.24/Documentation/notation/
- lilynode: https://www.npmjs.com/package/lilynode
- VexFlow: https://www.vexflow.com/ / https://github.com/vexflow/vexflow
- abcjs: https://www.abcjs.net/ / https://github.com/paulrosen/abcjs
- OSMD: https://opensheetmusicdisplay.org/
- Verovio: https://www.verovio.org/
