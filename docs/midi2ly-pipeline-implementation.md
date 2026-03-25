# Pipeline 1: MIDI-to-Score with midi2ly Implementation Research

Date: 2026-03-24

Goal: Document the implementation path for Pipeline 1 (midi2ly + LilyPond) including macOS installation steps, CLI usage, and integration patterns.

---

## Pipeline Overview

```
Note[] → MidiWriterJS → .mid → midi2ly → .ly → lilypond --svg → .svg
```

---

## macOS Installation

### LilyPond via Homebrew (Recommended)

```sh
brew install lilypond
```

**Current stable**: 2.24.4

**Dependencies** (auto-resolved by Homebrew):
- bdw-gc 8.2.12
- freetype 2.14.2
- ghostscript 10.07.0
- guile 3.0.11
- python@3.14 3.14.3
- fontforge
- texinfo 7.3

**Architecture support**: Apple Silicon and Intel (macOS Sequoia, Sonoma, Tahoe)

### Alternative: Manual Binary Install

If Homebrew is unavailable:

```sh
# Download from https://lilypond.org/download.html
# macOS x86_64 binary works on macOS 10.15+ (Catalina and higher)

# Extract and add to PATH
export PATH="/path/to/lilypond-2.24.4/bin:$PATH"
```

### Verification

```sh
lilypond --version
# Should show: LilyPond 2.24.4

midi2ly --version
# Should show: midi2ly (LilyPond) 2.24.4
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

## Full Pipeline Implementation

### Step 1: MIDI Generation (Note[] → .mid)

```typescript
import MidiWriter from 'midi-writer-js'

const midiToNoteName = (midi: number): string => {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  const note = notes[midi % 12]
  return `${note}${octave}`
}

interface Note {
  pitch: number      // MIDI number
  start_time: number // in beats
  duration: number   // in beats
  velocity: number   // 0-127
}

const notesToMidiFile = (notes: Note[], ticksPerBeat: number = 480): Buffer => {
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

  return Buffer.from(new MidiWriter.Writer(track).buildFile())
}
```

### Step 2: MIDI → LilyPond (.mid → .ly)

```typescript
import { execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { join } from 'path'

const midiToLy = (
  midiBuffer: Buffer,
  options: {
    durationQuant?: number
    startQuant?: number
    key?: string
    tuplets?: string[]
  } = {}
): string => {
  const tmpDir = '/tmp/prelive-midi'
  const tmpMidi = join(tmpDir, `temp-${Date.now()}.mid`)
  const tmpLy = join(tmpDir, `temp-${Date.now()}.ly`)

  // Write MIDI to temp file
  writeFileSync(tmpMidi, midiBuffer)

  // Build midi2ly command
  const args = ['midi2ly']
  if (options.durationQuant) args.push(`--duration-quant=${options.durationQuant}`)
  if (options.startQuant) args.push(`--start-quant=${options.startQuant}`)
  if (options.key) args.push(`--key=${options.key}`)
  for (const tuplet of (options.tuplets ?? [])) {
    args.push(`--allow-tuplet=${tuplet}`)
  }
  args.push(`-o "${tmpLy}"`, `"${tmpMidi}"`)

  // Execute conversion
  execSync(args.join(' '), { stdio: 'pipe' })

  // Read result
  const lyContent = readFileSync(tmpLy, 'utf-8')

  // Cleanup
  unlinkSync(tmpMidi)
  unlinkSync(tmpLy)

  return lyContent
}
```

### Step 3: LilyPond Engraving (.ly → .svg)

```typescript
const lyToSvg = (lyContent: string): Buffer => {
  const tmpDir = '/tmp/prelive-midi'
  const tmpLy = join(tmpDir, `temp-${Date.now()}.ly`)
  const tmpSvg = join(tmpDir, `temp-${Date.now()}.svg`)

  // Write .ly to temp file
  writeFileSync(tmpLy, lyContent)

  // Execute lilypond
  execSync(`lilypond -dbackend=svg -o "${tmpSvg.replace('.svg', '')}" "${tmpLy}"`, {
    stdio: 'pipe'
  })

  // Read result
  const svgBuffer = readFileSync(tmpSvg)

  // Cleanup
  unlinkSync(tmpLy)
  unlinkSync(tmpSvg)

  return svgBuffer
}
```

### Combined Pipeline

```typescript
const generateScoreSvg = (notes: Note[]): Buffer => {
  const midiBuffer = notesToMidiFile(notes, 480)
  const lyContent = midiToLy(midiBuffer, {
    durationQuant: 16,
    startQuant: 16,
    key: '0', // C major
    tuplets: ['8*2/3', '16*3/2']
  })
  const svgBuffer = lyToSvg(lyContent)
  return svgBuffer
}
```

---

## Quantization Strategy for Note[]

Since our Note[] uses beat-based timing (floats), we should pre-quantize before MIDI generation:

```typescript
const quantizeNotes = (notes: Note[], gridSize: number = 1/16): Note[] => {
  return notes.map(note => ({
    ...note,
    start_time: Math.round(note.start_time / gridSize) * gridSize,
    duration: Math.round(note.duration / gridSize) * gridSize,
  }))
}
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

## Integration with TanStack Start

### Server Function Pattern

```typescript
// src/routes/api/score.ts (or similar)
import { createServerFn } from '@tanstack/react-start'

export const generateScoreSvg = createServerFn({ method: 'POST' })
  .validator((data: { notes: Note[] }) => data)
  .handler(async ({ data }) => {
    const svgBuffer = await generateScoreSvg(data.notes)
    return new Response(svgBuffer, {
      headers: { 'Content-Type': 'image/svg+xml' }
    })
  })
```

### Client Usage

```typescript
const { mutateAsync } = useMutation({
  mutationFn: async (notes: Note[]) => {
    const response = await generateScoreSvg({ notes })
    return await response.text() // SVG string
  }
})
```

---

## Performance Considerations

- **midi2ly**: < 100ms for typical scores
- **lilypond**: 200-500ms for SVG, varies with complexity
- **Total pipeline**: ~500ms per score
- **Caching**: Consider caching .ly files for repeated renders
- **Async**: Use worker threads or async subprocess for non-blocking rendering

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

## Links

- LilyPond midi2ly docs: https://lilypond.org/doc/v2.24/Documentation/usage/invoking-midi2ly
- LilyPond Homebrew formula: https://formulae.brew.sh/formula/lilypond
- LilyPond download: https://lilypond.org/download.html
- MidiWriterJS: https://github.com/grimmdude/MidiWriterJS
- gin66/midi2ly (alternative): https://github.com/gin66/midi2ly
