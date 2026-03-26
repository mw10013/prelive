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
  clip_select_all_notes(id: Int!): Clip
  clip_remove_notes_by_id(id: Int!, ids: [Int!]!): Clip
  clip_remove_notes_extended(...): Clip
}
```

There is no access to full note range today, and `Clip.notes` is synthetic.

From the repo’s LOM notes, `Clip.notes` is backed by `get_notes_extended` with a time span limited to `0..clip.length`:

```
get_notes_extended(id, 0, 128, 0, parent.length)
```

This means score rendering can miss notes outside the current `0..clip.length` span unless we expose `get_all_notes_extended`.

## What is needed in LiveQL for score rendering

### 1) Notes (full range)

- Expose `clip_get_all_notes_extended` so the renderer can get all notes, not just those inside `0..clip.length`.

### 2) Clip time signature

- Expose `Clip.signature_numerator` and `Clip.signature_denominator` (already present in the schema) as the meter for barlines and beaming.

## Minimal LiveQL additions (concrete list)

- Query/mutation: `clip_get_all_notes_extended`.
- `Clip` time signature is already in the schema, keep it as-is.
