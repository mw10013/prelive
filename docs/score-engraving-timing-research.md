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

## Open Questions for Next Iteration

1) Do we want a single-voice engraving that preserves timeline placement even if notes overlap?

The note list can have chords in it. I don't know what you mean by single-voice engraving since we can have chords.

2) Are overlaps expected in the UI data, or should we treat them as chords or ties?

yes, overlaps are expected in the note list. And the note list can contain chords.

3) Should we inspect and keep the generated `.ly` as an intermediate artifact for debugging?

Yes, that would be good. Research the pipeline and explain what intermediate files are generated, where are they stored, are they deleted? we might also consider logging their contents so we can see them in the server log. 

---

## Concrete Next Checks (No Code Changes Yet)

1) Capture the `.ly` output for the four-note example and see how `midi2ly` is voicing it.
2) Compare with a hand-authored `.ly` that forces a single voice and explicit rests.
3) Decide if the desired output is literal timing fidelity or notation-friendly engraving.
