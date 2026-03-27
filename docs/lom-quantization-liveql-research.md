# LOM score rendering needs vs LiveQL

## Sources (web + repo)

- Ableton Live Object Model (Max 9 docs, Live 12.3.5): https://docs.cycling74.com/apiref/lom/
- LiveQL schema: `refs/liveql/liveql-n4m.js`
- LiveQL LOM mapping notes: `refs/liveql/docs/lom-schema-research.md`

## LOM fields that help score rendering (web excerpts)

### Clip time signature

```
### signature_numerator int observe

### signature_denominator int observe
```

### Clip.get_notes_extended (region query)

```
Returns a dictionary of notes that have their start times in the given area...
```

## LiveQL today (current schema coverage)

From `refs/liveql/liveql-n4m.js`:

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
  clip_get_all_notes_extended(id: Int!): NotesDictionary!
  clip_select_all_notes(id: Int!): Clip
  clip_remove_notes_by_id(id: Int!, ids: [Int!]!): Clip
  clip_remove_notes_extended(...): Clip
}
```

`Clip.notes` is a synthetic field backed by `get_all_notes_extended(id)` — returns all notes regardless of loop boundaries, sorted by start_time then pitch.

The `clip_get_all_notes_extended` mutation is also available for explicit queries. The region-bounded `clip_get_notes_extended` mutation remains available for sub-range queries when performance is a concern.

## What is needed in LiveQL for score rendering

### 1) Notes (full range)

- `clip_get_all_notes_extended` is now exposed in the schema. `Clip.notes` uses it by default.

### 2) Clip time signature

- Expose `Clip.signature_numerator` and `Clip.signature_denominator` (already present in the schema) as the meter for barlines and beaming.

## Quantization for notation (app-side)

- Use an app-defined grid (e.g. 1/16) and round durations to clean values (quarter, eighth, etc.).
- This does not require any LOM quantization settings or clip-level quantize calls.

