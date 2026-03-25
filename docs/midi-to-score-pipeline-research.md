# MIDI File to Score Graphic — Pipeline Research

Date: 2026-03-24

Goal: Take a MIDI file (generated from our `Note[]` data) and produce a score image (SVG/PNG/PDF) via CLI or local tooling.

---

## The core problem

Converting raw MIDI events into readable sheet music notation is a **quantization + inference** problem:

- MIDI has exact timing (ticks), notation needs quantized durations (quarter, eighth, etc.)
- No stave/measure structure in MIDI — must be inferred
- Overlapping notes, arpeggios, grace notes need decisions
- No key signature, no time signature (often) — must be detected or assumed

Every tool below deals with this in its own way. None are perfect for arbitrary DAW exports.

---

## Option A: LilyPond `midi2ly` + `lilypond`

**This is the built-in LilyPond answer to your question.**

LilyPond ships with `midi2ly`, a CLI tool that converts MIDI to `.ly` files:

```sh
midi2ly [options] midi-file > output.ly
lilypond --svg output.ly          # produces output.svg
```

### What it does

- Translates Type 1 MIDI files to LilyPond source
- Converts tracks → Staff, channels → Voice
- Supports quantization options: `-s` (start-quant), `-d` (duration-quant)
- Supports `-t` (allow-tuplet), `-k` (set key), `-x` (treat text as lyrics)

### Official LilyPond warning

From the LilyPond v2.24 docs:

> "When invoked with quantizing (-s and -d options) midi2ly tries to compensate for these timing errors, but is not very good at this. It is therefore **not recommended to use midi2ly for human-generated midi files**."

Source: https://lilypond.org/doc/v2.24/Documentation/usage/invoking-midi2ly

### Known issues

- Overlapping notes in arpeggios: first note read, others ignored
- Human timing errors produce messy output
- Works best with **DAW-quantized** MIDI (grid-aligned)

### Verdict

- Works for machine-quantized MIDI (DAW grid exports)
- Will be rough for human-played or loosely timed MIDI
- Worth trying as a first pass — free, built-in, no extra deps

---

## Option B: gin66/midi2ly (enhanced third-party converter)

A **Python** MIDI-to-LilyPond converter specifically designed to fix `midi2ly`'s shortcomings for DAW exports.

Source: https://github.com/gin66/midi2ly

### Features

- Automatic key detection
- Automatic repeat detection (based on identical bars)
- Repeats fold lyrics along the bar
- Notes rounded to 1/32 boundaries
- Automatic piano track → bass/treble split
- Track and lyric selection for embedding

### Usage

```sh
# List tracks
./midi2ly.py -l input.mid

# Export track 1 (lyrics) + tracks 3,4 (piano R/L) to .ly
./midi2ly.py -L 1 -P 3,4 input.mid > output.ly

# Then engrave
lilypond output.ly                # produces output.pdf, output-1.mid
```

Also available as Docker image:

```sh
docker run -it --rm -v "`pwd`":/in gin66/midi2ly -L 2 -P 3,4 input.mid > output.ly
```

### Why this exists

Author's motivation: Logic Pro X exports were unmanageable. Manual repeat removal was tedious. This tool automates DAW → LilyPond conversion with repeat detection.

### Verdict

- Better than built-in `midi2ly` for DAW exports
- Python-based, so runs anywhere (or Docker)
- Repeat detection is a killer feature for compact scores
- Still needs LilyPond for final engraving

---

## Option C: MuseScore CLI

MuseScore is a full notation editor with a headless CLI mode.

```sh
mscore -o output.pdf input.mid       # MIDI → PDF
mscore -o output.svg input.mid       # MIDI → SVG
mscore -o output.png input.mid       # MIDI → PNG (multi-page)
mscore -o output.musicxml input.mid  # MIDI → MusicXML
```

### Key details

- MuseScore has its own quantization engine (better than `midi2ly`)
- Handles key/time signature detection
- Handles multi-track, percussion, lyrics
- Outputs PDF, PNG, SVG, MusicXML
- Can also export back to MIDI

### Drawbacks

- Heavy dependency (~200MB+ install)
- Not a library — requires full app install
- Headless mode may need X11 display (Linux) or `--platform offscreen`
- Slower than pure LilyPond pipeline for batch

### Verdict

- Best **out-of-the-box** quantization quality
- Heaviest dependency
- Good fallback if LilyPond pipeline isn't good enough
- Command: `mscore -o score.svg input.mid`

---

## Option D: Browser-based (tools4music, miditoolbox, Smoosic)

Several web tools do MIDI → sheet music entirely in-browser:

### tools4music.com/tools/midi-to-sheet-music

- 100% client-side processing
- Parses MIDI in browser, renders with VexFlow
- Download as SVG, PDF, MusicXML
- Supports multi-track with track selection
- Auto-detects tempo, time signature, note durations

### miditoolbox.com/score

- Converts MIDI to MusicXML, then renders
- Piano grand staff or multi-track
- Tunable quantization/transposition
- Exports PDF/PNG

### Smoosic

- Full notation app in browser
- MIDI import + export, MusicXML import + export
- Uses VexFlow for engraving

### Verdict

- Good for **interactive** use (click to select tracks, etc.)
- Harder to automate from CLI/server
- If you want to embed in the app itself, these are viable
- Not ideal for batch/server-side pipelines

---

## Option E: Programmatic pipeline (our own)

The most flexible approach: build our own `Note[] → MIDI → score` pipeline.

### Step 1: Generate MIDI from `Note[]`

Use **MidiWriterJS** (npm: `midi-writer-js`) to create a MIDI file from our note data.

```ts
import MidiWriter from "midi-writer-js";

const track = new MidiWriter.Track();
track.addEvent(
  new MidiWriter.NoteEvent({
    pitch: ["C4", "E4", "G4"],
    duration: "4",
  }),
);

const write = new MidiWriter.Writer(track);
const midiBuffer = write.dataUri(); // or write.buildFile()
```

Key advantage: we control the quantization, track assignment, and time signature before it hits the engraver.

### Step 2: Convert MIDI → notation text

Pipeline options:

| Converter                | Input | Output       | Notes                     |
| ------------------------ | ----- | ------------ | ------------------------- |
| `midi2ly` (built-in)     | MIDI  | `.ly`        | Quick, rough quantization |
| `gin66/midi2ly`          | MIDI  | `.ly`        | Better, repeat detection  |
| `mscore -o out.musicxml` | MIDI  | `.musicxml`  | Best quantization         |
| Write our own converter  | MIDI  | MusicXML/ABC | Full control, high effort |

### Step 3: Engrave to image

| Engraver            | Input       | Output | Quality   |
| ------------------- | ----------- | ------ | --------- |
| `lilypond --svg`    | `.ly`       | `.svg` | Excellent |
| `lilypond --png`    | `.ly`       | `.png` | Excellent |
| `verovio`           | `.musicxml` | `.svg` | Excellent |
| `mscore -o out.svg` | `.mid`      | `.svg` | Very good |

---

## Recommended pipelines

### Pipeline 1: Quick and dirty (LilyPond midi2ly)

```
Note[] → MidiWriterJS → .mid → midi2ly → .ly → lilypond --svg → .svg
```

- **Pros**: Fast, no extra deps beyond LilyPond
- **Cons**: Poor quantization for non-grid MIDI
- **Best for**: Machine-quantized DAW exports

### Pipeline 2: Better quantization (MuseScore + LilyPond)

```
Note[] → MidiWriterJS → .mid → mscore -o .musicxml → musicxml2ly → .ly → lilypond --svg
```

- **Pros**: MuseScore quantizes well, LilyPond engraves beautifully
- **Cons**: Heavy dep (MuseScore)
- **Best for**: High quality output

### Pipeline 3: All MuseScore

```
Note[] → MidiWriterJS → .mid → mscore -o .svg → .svg
```

- **Pros**: Single tool, good quantization
- **Cons**: Heavy dep, less engraving control
- **Best for**: Simplicity

### Pipeline 4: gin66/midi2ly + LilyPond

```
Note[] → MidiWriterJS → .mid → gin66/midi2ly → .ly → lilypond --svg → .svg
```

- **Pros**: Auto key detection, repeat detection, piano split
- **Cons**: Python dep, Docker optional
- **Best for**: DAW-style exports with repeats

### Pipeline 5: Browser-embedded (if rendering in-app)

```
Note[] → quantize → MusicXML (programmatic) → OSMD/Verovio → SVG in DOM
```

- **Pros**: No server, instant rendering
- **Cons**: Must build MusicXML generator, complex
- **Best for**: Real-time in-app score preview

---

## Decision

For this project, I'd try **Pipeline 1** first:

1. Write `Note[] → MidiWriterJS → .mid` conversion (quantize to 32nd grid)
2. Run `midi2ly` on the result
3. Run `lilypond --svg` on the `.ly` file
4. Embed the SVG inline or serve it

If `midi2ly` output is too rough, escalate to Pipeline 4 (gin66/midi2ly) or Pipeline 3 (MuseScore CLI).

---

## MIDI generation library

**midi-writer-js** is the best candidate for `Note[] → MIDI`:

- npm: `midi-writer-js`
- GitHub: https://github.com/grimmdude/MidiWriterJS
- "JavaScript library providing an API for generating expressive multi-track MIDI files"
- Supports notes, rests, chords, tempo, time signature, velocity
- TypeScript compatible (has `@types/midi-writer-js`)

Example mapping from our Note schema:

```ts
import MidiWriter from "midi-writer-js";

function notesToMidiFile(notes: Note[], ticksPerBeat: number = 480): Buffer {
  const track = new MidiWriter.Track();
  track.setTempo(120);

  for (const note of notes) {
    track.addEvent(
      new MidiWriter.NoteEvent({
        pitch: [midiToNoteName(note.pitch)],
        duration: `T${Math.round(note.duration * ticksPerBeat)}`,
        velocity: note.velocity,
        startTick: Math.round(note.start_time * ticksPerBeat),
      }),
    );
  }

  return Buffer.from(new MidiWriter.Writer(track).buildFile());
}
```

---

## Links

- LilyPond midi2ly docs: https://lilypond.org/doc/v2.24/Documentation/usage/invoking-midi2ly
- LilyPond musicxml2ly docs: https://lilypond.org/doc/v2.24/Documentation/usage/invoking-musicxml2ly
- gin66/midi2ly: https://github.com/gin66/midi2ly
- MidiWriterJS: https://github.com/grimmdude/MidiWriterJS
- MuseScore CLI docs: https://handbook.musescore.org/appendix/command-line-usage
- Verovio input formats: https://book.verovio.org/toolkit-reference/input-formats.html
- tools4music MIDI→Sheet: https://tools4music.com/tools/midi-to-sheet-music
