# Score Engraving Timing Mismatch — Research

Date: 2026-03-25

Goal: Explain why a note that should land on beat 2 appears misplaced in the LilyPond engraving and document likely causes grounded in current pipeline code.

---

## Context

The UI shows notes with `start_time` and `duration` in beats. The expected interpretation is that `start_time = 1` aligns with beat 2 in 4/4.

Current pipeline:

```
Note[] → MidiWriterJS → .mid → midi2ly → .ly → lilypond --svg → .svg
```

---

## Current Pipeline: Code Evidence

### Note timing model (beats)

`Note` schema stores `start_time` and `duration` as numbers.

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

Source: `src/lib/Domain.ts:48`

### MIDI generation uses absolute ticks

`start_time` is converted to `startTick` by multiplying by `ticksPerBeat` (default 480). This means `start_time = 1` becomes tick 480, i.e. beat 2 in 4/4.

```
export const notesToMidiFile = (
  notes: readonly Note[],
  ticksPerBeat = 480,
): Uint8Array => {
  const track = new Track();
  track.setTempo(120);
  track.addEvent(new TimeSignatureEvent(4, 4, 24, 8));

  for (const note of notes) {
    track.addEvent(
      new NoteEvent({
        pitch: [midiToNoteName(note.pitch)],
        duration: `T${String(Math.round(note.duration * ticksPerBeat))}`,
        velocity: note.velocity,
        startTick: Math.round(note.start_time * ticksPerBeat),
      }),
    );
  }

  return new Writer(track, { ticksPerBeat }).buildFile();
};
```

Source: `src/lib/lilypond/midi.ts:25`

### Quantization before MIDI

`start_time` and `duration` are quantized to a 1/16 grid before MIDI export.

```
export const quantizeNotes = (
  notes: readonly Note[],
  gridSize = 1 / 16,
): readonly Note[] =>
  notes.map((note) => ({
    ...note,
    start_time: Math.round(note.start_time / gridSize) * gridSize,
    duration: Math.round(note.duration / gridSize) * gridSize,
  }));
```

Source: `src/lib/lilypond/midi.ts:47`

### midi2ly/lilypond used in renderer

`renderToSvg` uses the quantized notes, then runs `midi2ly`, then `lilypond`.

```
const renderToSvg = Effect.fn("LilyPondRenderer.renderToSvg")(function* (
  notes: readonly Note[],
) {
  const quantized = quantizeNotes(notes);
  const midiBuffer = notesToMidiFile(quantized);

  const lyContent = yield* midiToLy(midiBuffer).pipe(
    Effect.mapError(
      (e) => new LilyPondError({ message: "midi2ly failed", cause: e }),
    ),
  );

  const svgBuffer = yield* lyToSvg(lyContent).pipe(
    Effect.mapError(
      (e) => new LilyPondError({ message: "lilypond failed", cause: e }),
    ),
  );

  return svgBuffer;
});
```

Source: `src/lib/lilypond/renderer.ts:90`

### MidiWriterJS semantics for `startTick`

`startTick` becomes the `tick` field of a `NoteEvent`, which is used as an explicit absolute tick.

```
this.tick = fields.startTick || fields.tick || null;
```

Source: `refs/midi-writer/src/midi-events/note-event.ts:36`

Events with an explicit tick are collected and merged by absolute time when building the track.

```
if (event.tick !== null) {
  this.explicitTickEvents.push(event);
}
```

Source: `refs/midi-writer/src/chunks/track.ts:69`

---

## Example That Triggered the Issue

From the screenshot:

```
1) pitch 72, start 0,    dur 0.75
2) pitch 60, start 0.25, dur 0.25
3) pitch 69, start 1,    dur 0.25
4) pitch 67, start 2,    dur 0.25
```

In 4/4, `start_time = 1` is beat 2. With `ticksPerBeat = 480`, note 3 starts at tick 480.

---

## Likely Causes of the Engraving Mismatch

1) Overlap-triggered voice splitting in `midi2ly`
   - Note 1 spans 0 → 0.75 while note 2 starts at 0.25 and ends at 0.5.
   - Overlaps often cause `midi2ly` to split into multiple voices or insert rests in unexpected places.
   - This can make later notes appear visually offset even if their absolute time is correct.

2) Quantization and duration rendering choices in `midi2ly`
   - We quantize to 1/16 before MIDI export.
   - `midi2ly` also has its own quantization rules and may choose dotted notes or ties that change beaming and voice structure.

3) MIDI to LilyPond conversion is lossy for polyphonic timing
   - `midi2ly` is optimized for transcription, not exact positional engraving.
   - It may reorganize note groupings to produce a “clean” score rather than preserving the original piano-roll layout.

---

## What This Suggests

The issue is unlikely to be in the `start_time → startTick` mapping (it is direct and absolute). The mismatch is more likely introduced during `midi2ly`’s analysis of overlapping notes, which can reshuffle voices and change where notes appear in the rendered score.

---

## Current Constraints from Annotations

1) Overlaps are expected in the note list.
2) The note list can contain chords.

These constraints make `midi2ly` voice-splitting and rest insertion more likely, since overlaps are normal input rather than data errors.

---

## Intermediate Files: What Gets Written, Where, and Lifecycle

### midi2ly stage

`midi2ly` is invoked inside a scoped temp directory with prefix `midi2ly-`. The renderer writes `input.mid`, runs `midi2ly`, and reads `output.ly`.

```
const tmpDir = yield* fs.makeTempDirectoryScoped({
  prefix: "midi2ly-",
});
const tmpMidi = path.join(tmpDir, "input.mid");
const tmpLy = path.join(tmpDir, "output.ly");

yield* fs.writeFile(tmpMidi, midiBuffer);

yield* spawner.string(
  ChildProcess.make("midi2ly", [
    "--duration-quant=16",
    "--start-quant=16",
    "--allow-tuplet=8*2/3",
    "--allow-tuplet=16*3/2",
    "-o",
    tmpLy,
    tmpMidi,
  ]),
);

return yield* fs.readFileString(tmpLy);
```

Source: `src/lib/lilypond/renderer.ts:35`

### lilypond stage

`lilypond` is invoked inside a scoped temp directory with prefix `lilypond-`. The renderer writes `score.ly`, invokes LilyPond, then reads `score.svg`.

```
const tmpDir = yield* fs.makeTempDirectoryScoped({
  prefix: "lilypond-",
});
const tmpLy = path.join(tmpDir, "score.ly");
const outputBase = path.join(tmpDir, "score");

yield* fs.writeFileString(tmpLy, lyContent);

yield* spawner.string(
  ChildProcess.make("lilypond", [
    "-dbackend=svg",
    "-o",
    outputBase,
    tmpLy,
  ]),
);

return yield* fs.readFile(`${outputBase}.svg`);
```

Source: `src/lib/lilypond/renderer.ts:65`

### Temp directory location

`makeTempDirectoryScoped` uses the OS temp directory by default (`OS.tmpdir()`), unless a specific directory is provided.

```
const directory = typeof options?.directory === "string"
  ? Path.join(options.directory, ".")
  : OS.tmpdir();
```

Source: `refs/effect4/packages/platform-node-shared/src/NodeFileSystem.ts:124`

### Deletion behavior

`makeTempDirectoryScoped` uses `acquireRelease` and removes the directory on scope exit with `recursive: true`.

```
return (options) =>
  Effect.acquireRelease(
    makeDirectory(options),
    (directory) => Effect.orDie(removeDirectory(directory, { recursive: true }))
  )
```

Source: `refs/effect4/packages/platform-node-shared/src/NodeFileSystem.ts:160`

Summary: the intermediate files (`input.mid`, `output.ly`, `score.ly`, `score.svg`) live under OS temp directories and are deleted when the Effect scope ends. They are not preserved by default.

---

## Debug Artifacts Written to `logs/`

Debug artifacts are now written to stable paths on every render:

- `logs/score-debug.mid`
- `logs/score-debug.ly`
- `logs/score-debug.svg`

They are overwritten on each render (no unbounded file growth), while the temp dirs still use scoped create/cleanup.

```
const debugDir = path.join(process.cwd(), "logs");
const debugMidiPath = path.join(debugDir, "score-debug.mid");
const debugLyPath = path.join(debugDir, "score-debug.ly");
const debugSvgPath = path.join(debugDir, "score-debug.svg");

yield* fs.writeFile(debugMidiPath, midiBuffer).pipe(
  Effect.mapError(
    (e) => new LilyPondError({ message: "debug midi write failed", cause: e }),
  ),
);

const lyContent = yield* midiToLy(midiBuffer).pipe(
  Effect.mapError(
    (e) => new LilyPondError({ message: "midi2ly failed", cause: e }),
  ),
);

yield* fs.writeFileString(debugLyPath, lyContent).pipe(
  Effect.mapError(
    (e) => new LilyPondError({ message: "debug ly write failed", cause: e }),
  ),
);

const svgBuffer = yield* lyToSvg(lyContent).pipe(
  Effect.mapError(
    (e) => new LilyPondError({ message: "lilypond failed", cause: e }),
  ),
);

yield* fs.writeFile(debugSvgPath, svgBuffer).pipe(
  Effect.mapError(
    (e) => new LilyPondError({ message: "debug svg write failed", cause: e }),
  ),
);
```

Source: `src/lib/lilypond/renderer.ts:90`

---

## Decisions from Annotations

1) Prefer chords and ties over strict polyphonic timing preservation.
2) Capture `.mid`, `.ly`, and `.svg` per render to fixed paths under `logs/`.

---

## Concrete Next Checks

1) Inspect `logs/score-debug.ly` for the four-note example and see how `midi2ly` is voicing it.
2) Compare with a hand-authored `.ly` that preserves the intended beat placement and chord handling.
3) Inspect `logs/score-debug.mid` alongside the `.ly` to confirm timing alignment pre-conversion.
