# LOM score rendering needs vs LiveQL

## Sources (web + repo)

- Ableton Live Object Model (Max 9 docs, Live 12.3.5): https://docs.cycling74.com/apiref/lom/
- LiveQL schema: `refs/liveql/liveql-n4m.js`
- LiveQL LOM mapping notes: `refs/liveql/docs/lom-schema-research.md`

## LOM fields that actually help score rendering (web excerpts)

### Clip time signature and bounds

```
### signature_numerator int observe

### signature_denominator int observe
```

```
### loop_start float observe

For looped clips: loop start.
For unlooped clips: clip start.
```

```
### loop_end float observe

For looped clips: loop end.
For unlooped clips: clip end.
```

```
### looping bool observe

1 = clip is looped. Unwarped audio cannot be looped.
```

```
### start_marker float observe

The start marker of the clip in beats, independent of the loop state. Cannot be set behind the end marker.
```

```
### end_marker float observe

The end marker of the clip in beats, independent of the loop state. Cannot be set before the start marker.
```

### Song tempo

```
### tempo float observe

Current tempo of the Live Set in BPM, 20.0 ... 999.0. The tempo may be automated, so it can change depending on the current song time.
```

## LiveQL today (current schema coverage)

The current GraphQL schema does not expose quantization or groove settings. From `refs/liveql/liveql-n4m.js`:

```
type Clip {
  id: Int!
  path: String!
  end_time: Float!
  is_arrangement_clip: Boolean!
  is_midi_clip: Boolean!
  length: Float!
  looping: Boolean!
  name: String!
  signature_denominator: Int!
  signature_numerator: Int!
  start_time: Float!
  notes: [Note!]
}

type Mutation {
  ...
  clip_fire(id: Int!): Clip
  clip_get_notes_extended(...): NotesDictionary!
  clip_get_selected_notes_extended(id: Int!): NotesDictionary!
  clip_select_all_notes(id: Int!): Clip
  clip_remove_notes_by_id(id: Int!, ids: [Int!]!): Clip
  clip_remove_notes_extended(...): Clip
}
```

There is no access to clip loop boundaries or song tempo in the schema today, and `Clip.notes` is synthetic.

From the repo’s LOM notes, `Clip.notes` is backed by `get_notes_extended` with a time span limited to `0..clip.length`:

```
get_notes_extended(id, 0, 128, 0, parent.length)
```

This means score rendering can miss notes outside the current loop/marker range unless we expose `get_all_notes_extended` or the full clip bounds.

## What is actually needed in LiveQL for score rendering

### 1) Notes (full range)

- Expose `clip_get_all_notes_extended` so the renderer can get all notes, not just those inside `0..clip.length`.

### 2) Clip time signature

- Expose `Clip.signature_numerator` and `Clip.signature_denominator` (already present in the schema) as the meter for barlines and beaming.

### 3) Clip bounds for measure range

- Expose `Clip.loop_start`, `Clip.loop_end`, `Clip.looping` to decide the region to render.
- Expose `Clip.start_marker`, `Clip.end_marker` to render the actual clip range when not looped.

### 4) Song tempo (optional)

- Expose `Song.tempo` if you want LilyPond `\midi` playback tempo to match Live. Not required for static notation.

## How this supports performance data + keyboard data

- Performance data: render directly from raw note timing but limit the region by loop/marker bounds; do not depend on Live quantization settings.
- Keyboard data: use pitch-based staff split in the app; no extra LOM fields required.

## Minimal LiveQL additions (concrete list)

- Query/mutation: `clip_get_all_notes_extended`.
- `Clip` fields: `loop_start`, `loop_end`, `looping`, `start_marker`, `end_marker`.
- `Song` fields: `tempo` (optional, only for LilyPond MIDI playback).
