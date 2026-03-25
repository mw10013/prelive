# VexFlow API Research — Building Scores & MIDI Support

Date: 2026-03-24

Scanned `refs/vexflow/src/` to answer: what higher-level APIs exist beyond raw `StaveNote`? Does VexFlow support MIDI input or event/note lists?

---

## TL;DR

- **No MIDI support whatsoever** — VexFlow is purely a notation renderer
- **No event/note list input** — you must build notes via `Factory.StaveNote()` or `EasyScore.notes()`
- **EasyScore** is the highest-level API — a string DSL, not a structured input
- **VexTab** (separate package) is a richer text DSL but still no MIDI/event input
- **Music / Tables** provide note-name ↔ integer helpers useful for pitch conversion
- **Our conversion pipeline** (note list → measures → StaveNote) is the right approach; VexFlow provides no shortcut

---

## VexFlow's Three API Layers

### 1. Low-Level: `Renderer` + `StaveNote` (direct)

```ts
const stave = new Stave(10, 40, 400);
stave.addClef("treble").addTimeSignature("4/4");
stave.setContext(ctx).draw();

const note = new StaveNote({ keys: ["c/5"], duration: "q" });
```

Full control. You manage `Voice`, `Formatter`, `TickContext` yourself. This is what `vexflow-score-research.md` recommends.

### 2. Mid-Level: `Factory` + `System` (recommended by VexFlow docs)

`Factory` (`refs/vexflow/src/factory.ts:76`) wraps Renderer, manages staves/voices/render queue. `System` (`refs/vexflow/src/system.ts:69`) handles multi-stave layout and auto-formatting.

```ts
const vf = new Factory({
  renderer: { elementId: "boo", width: 1200, height: 600 },
});
const system = vf.System();

// Add stave with voices
system
  .addStave({
    voices: [
      vf
        .Voice({ time: "4/4" })
        .addTickables([
          vf.StaveNote({ keys: ["c/5"], duration: "q" }),
          vf.StaveNote({ keys: ["d/5"], duration: "q" }),
        ]),
    ],
  })
  .addClef("treble")
  .addTimeSignature("4/4");

vf.draw(); // auto-formats everything
```

**Key features:**

- `vf.System()` auto-formats all voices across staves (`system.format()` calls `Formatter`)
- `system.addStave()` takes `{ voices: Voice[] }` — staves share vertical formatting
- `factory.draw()` renders staves, voices, and all accumulated elements in correct order
- Auto-width: `System` can calculate width from content via `preCalculateMinTotalWidth`

**Still no structured note list input** — you still create `StaveNote` objects one by one.

### 3. High-Level: `EasyScore` (string DSL)

`refs/vexflow/src/easyscore.ts:430` — A parser-based DSL that creates `StaveNote` objects from strings.

```ts
const score = vf.EasyScore();

// Parse a string into notes
score.notes("C#5/q, B4, A4, G#4"); // → StaveNote[]

// Chords
score.notes("(C4 E4 G4)/q, (D4 F4 A4)/h");

// With options
score.notes("C#5/q, B4", { stem: "up", clef: "treble" });

// Voice wrapping
score.voice(score.notes("C#5/q, B4, A4, G#4"));
```

**EasyScore grammar** (`easyscore.ts:29-211`):

```
LINE     → PIECE (COMMA PIECE)* EOL
PIECE    → CHORDORNOTE DURATION? TYPE? DOTS? OPTS?
CHORDORNOTE → CHORD | SINGLENOTE
CHORD    → (NOTES)
SINGLENOTE → NOTENAME ACCIDENTAL? OCTAVE
DURATION → / (whq|digits)     # e.g. /q, /8, /16
TYPE     → /? (r|R|s|...)     # rest, slash, etc.
OPTS     → [key='value', ...]
```

**Supported syntax:**

- `'C5/q'` — quarter note C5
- `'(C4 E4 G4)/w'` — whole-note C major chord
- `'Bb4/8.'` — dotted eighth Bb4
- `'C4/qr'` — quarter rest
- `'D4/8[id="myNote"]'` — with options
- Microtonal accidentals: `db`, `d`, `++`, `+-`, `bs`, `bss`, `o`, `k`

**Limitations for our use case:**

- Still a **string format** — we'd need to serialize our note list into strings, then parse back into objects. Indirect.
- Duration is by symbol, not beat count — we'd still need our `beatsToDuration()` conversion.
- No support for notes spanning barlines, ties, or tuplets via string syntax (need separate API calls).
- Grammar is fixed — can't extend it for our custom properties like `velocity`, `probability`.

**Verdict:** EasyScore doesn't help. We'd still do the note-list-to-VexFlow conversion ourselves, just expressing the result as strings instead of StaveNote objects. The string intermediate step adds complexity without benefit.

---

## MIDI / Event List Support

### What VexFlow has

**Nothing.** The search across all 91 source files found:

- Zero MIDI parsing code
- Zero event list interfaces
- Zero note-list-to-score conversion
- The only MIDI references are Unicode glyph constants in `glyphs.ts:1854` (display symbols like `elecMIDIIn`, `elecMIDIController0` — purely decorative SMuFL glyphs)

### Useful utilities in VexFlow

**`Music` class** (`refs/vexflow/src/music.ts:34`):

- `Music.noteValues` — maps `'c#'`, `'bb'`, etc. to `{ rootIndex, intVal }` where `intVal` is 0-11
- `Music.getNoteValue(name)` → integer 0-11
- `Music.getCanonicalNoteName(intVal)` → `'c'`, `'c#'`, etc.
- `Music.getRelativeNoteValue(note, interval)` → compute next note in scale
- Scales: `Music.scales.major`, `Music.scales.minor`, etc.

**`Tables` class** (`refs/vexflow/src/tables.ts:290`):

- `Tables.integerToNote(0..11)` → `'C'`, `'C#'`, `'D'`, ... (uppercase, sharps only)
- `Tables.keyProperties('c#/4')` → `{ key, octave, line, intValue, code, displaced }` where `intValue` is the MIDI pitch (octave \* 12 + semitone)
- `Tables.durationToTicks('q')` → 4096 (resolution 16384 per whole note)
- `Tables.durationToNumber('q')` → 4
- `Tables.sanitizeDuration('q')` → `'4'`

**`Tuning` class** (`refs/vexflow/src/tuning.ts:8`):

- `tuning.getNoteForFret(fret, string)` → `'c#/4'` format
- Guitar tuning presets: `'standard'`, `'dropd'`, `'dagdad'`, etc.
- Uses `Tables.keyProperties()` and `Tables.integerToNote()` internally

**`Fraction` class** — used internally for tick math. Supports `add`, `subtract`, `simplify`, `value()`, `parse('4/4')`.

### External ecosystem

| Package                 | Purpose                         | Works with VexFlow?                               |
| ----------------------- | ------------------------------- | ------------------------------------------------- |
| `midi-json-parser`      | Binary MIDI → JSON event list   | Independent, outputs `{ noteOn, noteOff }` events |
| `vextab` v4             | Text DSL for notation+tablature | Renders via VexFlow, still no MIDI input          |
| `vexflow-musicxml`      | MusicXML → VexFlow              | Archived 2017, dead                               |
| `midi-player`           | Play MIDI files (audio)         | Can emit events, but separate from notation       |
| `opensheetmusicdisplay` | MusicXML renderer (competitor)  | Uses its own rendering, not VexFlow               |

None of these bridge MIDI → VexFlow score. You'd always need a conversion layer.

---

## Tick System

VexFlow uses a tick-based duration model:

```
RESOLUTION = 16384 ticks per whole note

w  = 16384 ticks  (whole)
h  = 8192         (half)
q  = 4096         (quarter)
8  = 2048         (eighth)
16 = 1024         (sixteenth)
32 = 512          (thirty-second)
64 = 256          (sixty-fourth)
```

`Voice` fills exactly `numBeats * beatValue * RESOLUTION / 4` ticks. In 4/4 time: `4 * 4 * 16384 / 4 = 16384` ticks.

This maps directly to our beat-based duration model: multiply beats by 4096 to get ticks. Our `beatsToDuration()` function handles the inverse.

---

## Our Approach Is Optimal

The conversion pipeline in `vexflow-score-research.md`:

```
Note[] → sort → quantize → group chords → split measures → fill rests → StaveNote[]
```

This is the **only** path. VexFlow provides no alternative entry point for structured note data. The `Factory` + `System` approach adds auto-formatting but not data ingestion.

**What Factory/System gives us over raw low-level:**

- Automatic voice justification across staves
- `system.addStave({ voices })` — cleaner multi-voice setup
- `factory.draw()` — single call renders everything in order
- Auto-width calculation from content

**Recommendation:** Use `Factory` + `System` for the rendering layer (cleaner than raw `StaveNote` + manual `Formatter`), but keep our conversion pipeline for note-list → VexFlow objects. Don't use EasyScore — the string intermediate is unnecessary overhead.

---

## Relevant Source Files

| File                            | Key classes                                              |
| ------------------------------- | -------------------------------------------------------- |
| `refs/vexflow/src/factory.ts`   | `Factory` — orchestrator, creates all objects            |
| `refs/vexflow/src/system.ts`    | `System` — multi-stave layout, auto-formatting           |
| `refs/vexflow/src/easyscore.ts` | `EasyScore`, `Builder`, `EasyScoreGrammar` — string DSL  |
| `refs/vexflow/src/parser.ts`    | `Parser` — generic CFG parser used by EasyScore          |
| `refs/vexflow/src/music.ts`     | `Music` — note theory, scales, intervals                 |
| `refs/vexflow/src/tables.ts`    | `Tables` — duration ticks, key properties, integerToNote |
| `refs/vexflow/src/tuning.ts`    | `Tuning` — guitar tuning, fret→note conversion           |
| `refs/vexflow/src/voice.ts`     | `Voice` — tick container, modes (STRICT/SOFT/FULL)       |
| `refs/vexflow/src/formatter.ts` | `Formatter` — voice justification, alignment             |
| `refs/vexflow/src/stavenote.ts` | `StaveNote` — the note object we create                  |
| `refs/vexflow/src/note.ts`      | `Note`, `NoteStruct` — base note interface               |
