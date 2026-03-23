import { Schema } from "effect"

/**
 * Base schemas define scalar fields only for each GraphQL object type.
 * Composed schemas (e.g. SongOverview) spread base `.fields` and add
 * nested object relations per-query. This keeps base schemas flat and
 * reusable while letting each query declare exactly the shape it expects.
 */

export const Song = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  is_playing: Schema.Boolean,
})

export const SongView = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
})

export const Track = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  has_midi_input: Schema.Boolean,
  name: Schema.String,
})

export const ClipSlot = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  has_clip: Schema.Boolean,
})

export const Clip = Schema.Struct({
  id: Schema.Number,
  path: Schema.String,
  end_time: Schema.Number,
  is_arrangement_clip: Schema.Boolean,
  is_midi_clip: Schema.Boolean,
  length: Schema.Number,
  looping: Schema.Boolean,
  name: Schema.String,
  signature_denominator: Schema.Number,
  signature_numerator: Schema.Number,
  start_time: Schema.Number,
})

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
})

export const SongOverview = Schema.Struct({
  ...Song.fields,
  tracks: Schema.Array(
    Schema.Struct({
      ...Track.fields,
      clip_slots: Schema.Array(
        Schema.Struct({
          ...ClipSlot.fields,
          clip: Schema.NullOr(Clip),
        }),
      ),
    }),
  ),
})
