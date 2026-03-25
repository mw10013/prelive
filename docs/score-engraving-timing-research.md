# Score Engraving Timing Mismatch — Research

Date: 2026-03-25

Goal: Explain why a note that should land on beat 2 appears misplaced in the LilyPond engraving and document likely causes grounded in current pipeline code.

---

## Context

The UI shows notes with `start_time` and `duration` in beats. The expected interpretation is that `start_time = 1` aligns with beat 2 in 4/4.

Current pipeline:

```
Note[] → LilyPond text (direct) → lilypond --svg → .svg
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

### LilyPond is generated directly

`renderToSvg` calls `notesToLilyPond(notes)` and sends that to `lilypond`.

```
const renderToSvg = Effect.fn("LilyPondRenderer.renderToSvg")(function* (
  notes: readonly Note[],
) {
  const midiBuffer = notesToMidiFile(quantizeNotes(notes));
  const lyContent = notesToLilyPond(notes);

  const svgBuffer = yield* lyToSvg(lyContent).pipe(
    Effect.mapError(
      (e) => new LilyPondError({ message: "lilypond failed", cause: e }),
    ),
  );

  return svgBuffer;
});
```

Source: `src/lib/lilypond/renderer.ts:90`

### Direct LilyPond voices and chords

The generator quantizes, groups notes with the same start+duration into chord events, then assigns non-overlapping events to voices. Each voice emits rests for gaps, and ties only when a single duration must be split.

```
const events = buildEvents(notes, config.gridSize);
const voices = assignVoices(events);
const voiceTokens = voices.map((voice) =>
  voiceToTokens(voice.events, roundedEnd).join(" "),
);
const body = voiceTokens.length > 1
  ? `<< ${voiceTokens
    .map((line, index) => {
      const command = voiceCommands[index] ?? "\\voiceOne";
      return `{ ${command} ${line} }`;
    })
    .join(" \\\\ ")} >>`
  : (voiceTokens[0] ?? "r1");
```

Source: `src/lib/lilypond/score.ts:100`

### Proportional spacing for beat alignment

To align horizontal spacing with timing, the generator sets proportional notation and strict note spacing.

```
\set Score.proportionalNotationDuration = #1/16
\override Score.SpacingSpanner.strict-note-spacing = ##t
```

Source: `src/lib/lilypond/score.ts:179`

LilyPond reference shows `\set Score.proportionalNotationDuration` for proportional spacing:

```
\new RhythmicStaff {
  \set Score.proportionalNotationDuration = #1/16
  \rhythm
}
```

Source: `refs/lilypond/Documentation/en/notation/spacing.itely:3715`

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

1) Voice assignment may not match musical intent
   - `assignVoices` places overlapping events into separate voices by earliest-available rule.
   - If the intended melody should stay in the top voice, pitch ordering may need tuning.

2) Duration splitting is greedy
   - `splitDuration` decomposes a duration into dotted/undotted tokens.
   - This can change visual grouping even when timing is correct.

3) Chord grouping is only for identical start+duration
   - Notes that start together but have different durations are split across voices.
   - That can look “off” if you expect chord ties in a single voice.

---

## What This Suggests

The issue is unlikely to be in the `start_time → startTick` mapping. The mismatch is more likely introduced by the direct LilyPond voice assignment and duration splitting in `notesToLilyPond`.

---

## Current Constraints from Annotations

1) Overlaps are expected in the note list.
2) The note list can contain chords.

These constraints mean overlap handling must balance chords, ties, and voice separation without losing beat placement.

---

## Intermediate Files: What Gets Written, Where, and Lifecycle

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

Summary: the intermediate files (`score.ly`, `score.svg`) live under OS temp directories and are deleted when the Effect scope ends. They are not preserved by default.

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

const lyContent = notesToLilyPond(notes);

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

1) Inspect `logs/score-debug.ly` for the four-note example and verify voice assignment and durations.
2) Compare with a hand-authored `.ly` that preserves the intended beat placement and chord handling.
3) Inspect `logs/score-debug.mid` alongside the `.ly` to confirm timing alignment pre-render.
