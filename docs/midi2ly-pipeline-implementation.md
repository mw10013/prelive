# Pipeline 1: MIDI-to-Score with midi2ly Implementation Research

Date: 2026-03-24

Goal: Document the implementation path for Pipeline 1 (midi2ly + LilyPond) using Effect v4 idioms for Node operations, enabling side-by-side operation with existing VexFlow renderer.

---

## Pipeline Overview

```
Note[] → MidiWriterJS → .mid → midi2ly → .ly → lilypond --svg → .svg
```

---

## LilyPond Installation Status

**Installed via Homebrew.**

```sh
lilypond --version
# LilyPond 2.24.4

midi2ly --version  
# midi2ly (LilyPond) 2.24.4
```

---

## Effect v4 Patterns for Node Operations

Based on `refs/effect4/`, we use Effect v4 idioms for all Node.js operations:

### Key Modules

| Module | Purpose |
|--------|---------|
| `@effect/platform-node` | NodeServices layer, NodeFileSystem |
| `effect/FileSystem` | Abstract file operations |
| `effect/unstable/process/ChildProcess` | Spawning CLI commands |
| `effect/Path` | Path utilities |

### Core Patterns

1. **Use `Effect.fn("name")` for named functions** - better stack traces
2. **Use `Effect.gen` for imperative-style async code**
3. **Use `Effect.acquireRelease` for resource cleanup** - temp files/directories
4. **Use `FileSystem.FileSystem` service** - not raw `node:fs`
5. **Use `ChildProcessSpawner` service** - not raw `child_process`

### Layer Composition

```typescript
import { Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { NodeChildProcessSpawner } from "@effect/platform-node-shared"

// Base layer with Node services
const nodeLayer = Layer.mergeAll(
  NodeFileSystem.layer,
  NodeChildProcessSpawner.layer
)
```

---

## midi2ly Command Reference

### Basic Usage

```sh
midi2ly [options] input.mid > output.ly
# or
midi2ly -o output.ly input.mid
```

### Key Options

| Flag | Description | Default |
|------|-------------|---------|
| `-s, --start-quant=DUR` | Quantize note starts | none |
| `-d, --duration-quant=DUR` | Quantize note durations | none |
| `-t, --allow-tuplet=DUR*NUM/DEN` | Allow tuplet durations | none |
| `-k, --key=acc[:minor]` | Set key signature | detected |
| `-a, --absolute-pitches` | Use absolute pitches | relative |
| `-e, --explicit-durations` | Print explicit durations | implicit |
| `-o, --output=FILE` | Write to file | stdout |
| `-p, --preview` | Preview first 4 bars | off |
| `-q, --quiet` | Suppress warnings | off |
| `-x, --text-lyrics` | Treat text as lyrics | off |

### Duration Format

DUR values use LilyPond notation:
- `1` = whole note
- `2` = half note
- `4` = quarter note
- `8` = eighth note
- `16` = sixteenth note
- `32` = thirty-second note
- `64` = sixty-fourth note

### Recommended Options for Machine-Quantized MIDI

```sh
# For grid-aligned MIDI (DAW exports)
midi2ly --duration-quant=16 --start-quant=16 input.mid > output.ly

# With key signature hint (e.g., G major = 1 sharp)
midi2ly --key=1 --duration-quant=16 --start-quant=16 input.mid > output.ly

# Allow triplets
midi2ly --allow-tuplet=8*2/3 --allow-tuplet=16*3/2 input.mid > output.ly
```

---

## LilyPond Engraving

### SVG Output

```sh
lilypond -dbackend=svg --svg output.ly
# Produces: output.svg
```

### PNG Output

```sh
lilypond -fpng output.ly
# Produces: output.png
```

### PDF Output

```sh
lilypond output.ly
# Produces: output.pdf
```

### Resolution Control

```sh
lilypond -dresolution=300 -fpng output.ly  # 300 DPI PNG
```

---

## Effect v4 Implementation

### Step 1: MIDI Generation (Note[] → .mid)

Pure computation, no Effect needed:

```typescript
import MidiWriter from "midi-writer-js"

const midiToNoteName = (midi: number): string => {
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  const octave = Math.floor(midi / 12) - 1
  const note = notes[midi % 12]
  return `${note}${octave}`
}

const notesToMidiFile = (notes: ReadonlyArray<Note>, ticksPerBeat: number = 480): Uint8Array => {
  const track = new MidiWriter.Track()
  track.setTempo(120)
  track.addEvent(new MidiWriter.TimeSignatureEvent({
    numerator: 4,
    denominator: 4,
    thirtyseconds: 8
  }))

  for (const note of notes) {
    track.addEvent(new MidiWriter.NoteEvent({
      pitch: [midiToNoteName(note.pitch)],
      duration: `T${Math.round(note.duration * ticksPerBeat)}`,
      velocity: note.velocity,
      startTick: Math.round(note.start_time * ticksPerBeat),
    }))
  }

  return Uint8Array.from(new MidiWriter.Writer(track).buildFile())
}
```

### Step 2: MIDI → LilyPond (.mid → .ly)

```typescript
import { Effect } from "effect"
import type { FileSystem } from "effect/FileSystem"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import * as ChildProcess from "effect/unstable/process/ChildProcess"
import { Path } from "effect/Path"

const midiToLy = Effect.fn("midiToLy")(
  function* (
    midiBuffer: Uint8Array,
    options: {
      readonly durationQuant?: number
      readonly startQuant?: number
      readonly key?: string
      readonly tuplets?: ReadonlyArray<string>
    } = {}
  ): Effect.Effect<string, PlatformError, FileSystem | ChildProcessSpawner | Path> {
    const fs = yield* FileSystem
    const path = yield* Path
    const spawner = yield* ChildProcessSpawner

    // Create scoped temp directory - auto-cleanup on scope exit
    const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "midi2ly-" })

    const tmpMidi = path.join(tmpDir, "input.mid")
    const tmpLy = path.join(tmpDir, "output.ly")

    // Write MIDI to temp file
    yield* fs.writeFile(tmpMidi, midiBuffer)

    // Build midi2ly command
    const args: Array<string> = []
    if (options.durationQuant) args.push(`--duration-quant=${options.durationQuant}`)
    if (options.startQuant) args.push(`--start-quant=${options.startQuant}`)
    if (options.key) args.push(`--key=${options.key}`)
    for (const tuplet of (options.tuplets ?? [])) {
      args.push(`--allow-tuplet=${tuplet}`)
    }
    args.push("-o", tmpLy, tmpMidi)

    // Execute midi2ly
    yield* spawner.string(
      ChildProcess.make("midi2ly", args)
    )

    // Read result
    const lyContent = yield* fs.readFileString(tmpLy)

    return lyContent
  }
)
```

### Step 3: LilyPond Engraving (.ly → .svg)

```typescript
const lyToSvg = Effect.fn("lyToSvg")(
  function* (
    lyContent: string
  ): Effect.Effect<Uint8Array, PlatformError, FileSystem | ChildProcessSpawner | Path> {
    const fs = yield* FileSystem
    const path = yield* Path
    const spawner = yield* ChildProcessSpawner

    // Create scoped temp directory - auto-cleanup on scope exit
    const tmpDir = yield* fs.makeTempDirectoryScoped({ prefix: "lilypond-" })

    const tmpLy = path.join(tmpDir, "score.ly")
    const outputBase = path.join(tmpDir, "score")

    // Write .ly to temp file
    yield* fs.writeFileString(tmpLy, lyContent)

    // Execute lilypond for SVG output
    yield* spawner.string(
      ChildProcess.make("lilypond", ["-dbackend=svg", "-o", outputBase, tmpLy])
    )

    // Read SVG result
    const svgBuffer = yield* fs.readFile(`${outputBase}.svg`)

    return svgBuffer
  }
)
```

### Combined Pipeline with Service

```typescript
import { ServiceMap, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { NodeChildProcessSpawner } from "@effect/platform-node-shared"

class LilyPondError extends Schema.TaggedErrorClass<LilyPondError>()("LilyPondError", {
  message: Schema.String,
  cause: Schema.Defect
}) {}

export class LilyPondRenderer extends ServiceMap.Service<LilyPondRenderer, {
  readonly renderToSvg: (
    notes: ReadonlyArray<Note>
  ) => Effect.Effect<Uint8Array, LilyPondError>
}>("LilyPondRenderer") {
  static readonly layer = Layer.effect(
    LilyPondRenderer,
    Effect.gen(function* () {
      const renderToSvg = Effect.fn("LilyPondRenderer.renderToSvg")(
        function* (notes: ReadonlyArray<Note>): Effect.Effect<Uint8Array, LilyPondError> {
          const midiBuffer = notesToMidiFile(notes)

          const lyContent = yield* midiToLy(midiBuffer, {
            durationQuant: 16,
            startQuant: 16,
            key: "0", // C major
            tuplets: ["8*2/3", "16*3/2"]
          }).pipe(
            Effect.mapError((e) => new LilyPondError({ message: "midi2ly failed", cause: e }))
          )

          const svgBuffer = yield* lyToSvg(lyContent).pipe(
            Effect.mapError((e) => new LilyPondError({ message: "lilypond failed", cause: e }))
          )

          return svgBuffer
        }
      )

      return LilyPondRenderer.of({ renderToSvg })
    })
  ).pipe(
    Layer.provide(NodeFileSystem.layer),
    Layer.provide(NodeChildProcessSpawner.layer)
  )
}
```

---

## Runtime Integration

Add LilyPondRenderer layer to existing runtime:

```typescript
// src/lib/runtime.ts
import { ConfigProvider, Layer, ManagedRuntime } from "effect"
import { LilyPondRenderer } from "@/lib/lilypond/renderer"

const baseLayer = Layer.mergeAll(
  ConfigProvider.layer(ConfigProvider.fromEnv()),
  LilyPondRenderer.layer  // Add here
)

const appLayer = baseLayer

export const runtime = ManagedRuntime.make(appLayer)
```

---

## Quantization Strategy for Note[]

Since our Note[] uses beat-based timing (floats), we should pre-quantize before MIDI generation:

```typescript
const quantizeNotes = (
  notes: ReadonlyArray<Note>, 
  gridSize: number = 1 / 16
): ReadonlyArray<Note> =>
  notes.map((note) => ({
    ...note,
    start_time: Math.round(note.start_time / gridSize) * gridSize,
    duration: Math.round(note.duration / gridSize) * gridSize
  }))
```

With 1/16 grid (sixteenth notes), midi2ly with `--duration-quant=16 --start-quant=16` will produce clean output.

---

## Limitations & Known Issues

### midi2ly Constraints

1. **Type 1 MIDI only** - Multi-track format
2. **No perfect quantization** - LilyPond warns against using midi2ly for human-generated MIDI
3. **Overlapping notes** - Arpeggios may lose notes
4. **No lyrics/metadata extraction** - Text events not preserved reliably

### When Pipeline 1 Fails

If midi2ly output is poor quality:
- Escalate to **Pipeline 4** (gin66/midi2ly) - better quantization, repeat detection
- Escalate to **Pipeline 3** (MuseScore CLI) - best quantization engine
- Consider writing custom MusicXML output for full control

### Mitigation

- Pre-quantize Note[] to 1/16 or 1/32 grid before MIDI generation
- Set explicit key signature via `-k` option
- Use `--allow-tuplet` for triplet support
- Test with various input patterns before committing to pipeline

---

## Performance Considerations

| Component | Latency | Notes |
|-----------|---------|-------|
| MIDI generation | < 10ms | Pure JS, in-process |
| midi2ly | < 100ms | Subprocess spawn |
| lilypond | 200-500ms | SVG rendering |
| **Total** | **~500ms** | Server-side only |

**Caching strategy**: VexFlow is instant (client). LilyPond is server-side with ~500ms latency but higher fidelity. Consider caching rendered SVGs keyed by note content hash.

---

## File Structure

```
src/
├── lib/
│   ├── lilypond/
│   │   ├── renderer.ts      # LilyPondRenderer service
│   │   ├── midi.ts          # notesToMidiFile, quantizeNotes
│   │   └── types.ts         # PlatformError re-exports
│   └── vexflow/
│       └── render-score.ts  # Existing VexFlow renderer
├── components/
│   └── ScoreDisplay.tsx     # Side-by-side tabs
└── routes/
    └── api/
        └── score/
            └── lilypond.ts  # Server function
```

---

## Verification Commands

```sh
# Test LilyPond installation
echo '{ c4 d4 e4 f4 }' | lilypond -dbackend=svg -o test.svg -

# Test midi2ly
midi2ly --duration-quant=16 --start-quant=16 input.mid

# Full pipeline test
midi2ly input.mid > output.ly
lilypond -dbackend=svg output.ly
# Check output.svg
```

---

## Dependencies

No new npm packages needed. Uses existing:

| Package | Version | Purpose |
|---------|---------|---------|
| `effect` | 4.0.0-beta.38 | Core Effect runtime |
| `@effect/platform-node` | 4.0.0-beta.38 | NodeFileSystem, NodeChildProcessSpawner |
| `midi-writer-js` | (new) | Note[] → MIDI |
| LilyPond | 2.24.4 | midi2ly + engraving (system binary) |

---

## Links

- LilyPond midi2ly docs: https://lilypond.org/doc/v2.24/Documentation/usage/invoking-midi2ly
- LilyPond Homebrew formula: https://formulae.brew.sh/formula/lilypond
- Effect v4 ChildProcess example: refs/effect4/ai-docs/src/60_child-process/10_working-with-child-processes.ts
- Effect v4 FileSystem: refs/effect4/packages/platform-node-shared/src/NodeFileSystem.ts
- MidiWriterJS: https://github.com/grimmdude/MidiWriterJS
