# midi2ly vs custom LilyPond generation

## Problem framing

Performance note lists (MIDI-style) are not notation-ready. Small timing offsets and note lengths from performance data can make durations print as irregular values instead of clean quarter/eighth notes. This is especially relevant for EDM clips (mostly monophonic lines or block chords), where you want tight, grid-aligned notation rather than humanized timing.

The codebase currently skips MIDI->LilyPond conversion and generates LilyPond directly from the note list with explicit grid quantization.

## How midi2ly.py handles performance data

### Quantizes note starts and durations (optional)

The script has command-line options to quantize start times and durations, which address microtiming.

`refs/lilypond/scripts/midi2ly.py`:

```
p.add_option('-d', '--duration-quant',
             metavar=_('DUR'),
             help=_('quantise note durations on DUR'))
...
p.add_option('-s', '--start-quant', help=_('quantise note starts on DUR'),
             metavar=_('DUR'))
```

Quantization is applied in `convert_midi` and then used when notes are parsed:

```
if global_options.start_quant:
    start_quant_clocks = clocks_per_1 / global_options.start_quant

if global_options.duration_quant:
    duration_quant_clocks = clocks_per_1 / global_options.duration_quant
```

```
if start_quant_clocks:
    t = quantise_clocks(t, start_quant_clocks)
```

```
d = t - lt
if duration_quant_clocks:
    d = quantise_clocks(d, duration_quant_clocks)
    if not d:
        d = duration_quant_clocks
```

`quantise_clocks` rounds to a grid and also supports allowed tuplets:

```
def quantise_clocks(clocks, quant):
    q = int(clocks / quant) * quant
    if q != clocks:
        for tquant in allowed_tuplet_clocks:
            if int(clocks / tquant) * tquant == clocks:
                return clocks
        if 2 * (clocks - q) > quant:
            q = q + quant
    return q
```

Allowed tuplets are configured from CLI:

```
allowed_tuplet_clocks = [
    clocks_per_1 / dur * num / den
    for dur, num, den in global_options.allowed_tuplets
]
```

### Voice splitting and staff layout

The script splits overlapping notes into “threads” (voices) per channel:

```
def unthread_notes(channel):
    threads = []
    while channel:
        thread = []
        end_busy_t = 0
        ...
        for e in channel:
            t = e[0]
            if (e[1].__class__ == Note
                and ((t == start_busy_t
                      and e[1].clocks + t == end_busy_t)
                     or t >= end_busy_t)):
                thread.append(e)
                start_busy_t = t
                end_busy_t = t + e[1].clocks
            ...
        threads.append(thread)
        channel = todo
    return threads
```

Tracks include a “main” voice plus per-channel voices:

```
def get_voices(self):
    return ([self.get_voice()]
            + [self.channels[k].get_voice()
               for k in sorted(self.channels.keys())])
```

It chooses a clef based on average pitch:

```
def get_best_clef(average_pitch):
    if average_pitch:
        if average_pitch <= 3*12:
            return Clef(0)
        if average_pitch <= 5*12:
            return Clef(1)
        if average_pitch >= 7*12:
            return Clef(3)
    return Clef(2)
```

When dumping tracks, it assigns voice directions and emits multiple voices in a staff when needed:

```
if average_pitch[vv+1] and voices > 1:
    vl = get_voice_layout(average_pitch[1:])[vv]
    if vl:
        s += '  \\voice' + vl + '\n'
```

### Output layout choices

`midi2ly` generates a layout that uses completion engravers:

```
\layout {
  \context {
    \Voice
    \remove Note_heads_engraver
    \consists Completion_heads_engraver
    \remove Rest_engraver
    \consists Completion_rest_engraver
  }
}
```

This indicates the script is intentionally shaping notation for MIDI-derived durations rather than assuming notation-perfect input.

## How custom LilyPond generation in this app handles performance data

### Explicit grid quantization

`src/lib/lilypond/midi.ts` rounds `start_time` and `duration` to a fixed grid before note rendering logic uses the data:

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

### Chord grouping and simplified voicing

Notes are grouped into events by identical start/duration so chords render as a single token:

```
const key = `${String(start)}:${String(duration)}`;
const entry = grouped.get(key) ?? { start, duration, pitches: [] };
entry.pitches.push(note.pitch);
```

Voices are assigned by a simple non-overlap heuristic:

```
for (const event of sorted) {
  let placed = false;
  for (const voice of voices) {
    if (event.start >= voice.end - epsilon) {
      voice.events.push(event);
      voice.end = event.start + event.duration;
      placed = true;
      break;
    }
  }
  if (!placed) {
    voices.push({ end: event.start + event.duration, events: [event] });
  }
}
```

LilyPond output uses up to four voices in a single staff:

```
const voiceCommands = [
  String.raw`\voiceOne`,
  String.raw`\voiceTwo`,
  String.raw`\voiceThree`,
  String.raw`\voiceFour`,
];
```

## EDM clips (lines/chords) vs polyphonic counterpoint

Given EDM clips are typically single lines or block chords, a grid-first approach is usually more legible than MIDI-derived quantization. The custom generator already assumes this by:

- forcing a fixed grid (`gridSize = 1/16` by default),
- grouping notes into chords by start/duration,
- emitting a single staff with a small number of voices.

This aligns with your expectation that the note list represents musical “intent” rather than literal performance timing.

`midi2ly` can handle timing conundrums, but only if you choose quantization options (`--start-quant`, `--duration-quant`, `--allow-tuplet`) that map the performance into notation-friendly durations. Without those, durations remain close to performance data and can yield awkward note values.

## Treble/bass keyboard clips

`midi2ly` chooses clef from average pitch and can create multiple voices per staff, but it does not inherently split a single track into treble/bass staves unless the MIDI itself separates parts into tracks/channels. Evidence is in how it builds tracks/channels/voices and selects a clef per staff:

```
tracks = [create_track(t) for t in midi_dump[1]]
...
staves.append(Staff(t))
```

```
def get_best_clef(average_pitch):
    if average_pitch:
        if average_pitch <= 3*12:
            return Clef(0)
        if average_pitch <= 5*12:
            return Clef(1)
        if average_pitch >= 7*12:
            return Clef(3)
    return Clef(2)
```

If the keyboard clip is split into separate tracks/channels (left hand vs right hand), `midi2ly` will separate them more naturally. The current custom generator does not do staff splitting at all; it always builds a single staff.

## Takeaways

- `midi2ly` is designed for MIDI performance data but depends on explicit quantization options to avoid messy durations.
- The custom generator already enforces a grid and chord grouping, which is likely better aligned with EDM clips and intended notation.
- If you need treble/bass staves for keyboard clips, you will need either:
  - MIDI input organized into separate tracks/channels for `midi2ly`, or
  - custom logic to split notes by pitch range into two staves before LilyPond generation.
