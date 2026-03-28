import { createServerFn } from "@tanstack/react-start";
import { Schema } from "effect";

import * as Domain from "@/lib/Domain";
import { gql } from "@/lib/gql";

export const readClip = createServerFn({ method: "GET" }).handler(async () => {
  return gql(
    `{ live_set { view { selected_track { name } detail_clip {
        id name path length is_midi_clip
        signature_numerator signature_denominator
        notes { note_id pitch start_time duration velocity mute probability velocity_deviation release_velocity }
      } } } }`,
    Schema.Struct({
      live_set: Schema.Struct({
        view: Schema.Struct({
          selected_track: Schema.NullOr(Schema.Struct({ name: Schema.String })),
          detail_clip: Schema.NullOr(Domain.ClipWithNotes),
        }),
      }),
    }),
  );
});

interface WriteNotesInput {
  clipId: number;
  newNotes: Domain.NoteInput[];
  modifiedNotes: Domain.NoteInput[];
  removedNoteIds: number[];
}

export const writeNotes = createServerFn({ method: "POST" })
  .inputValidator((data: WriteNotesInput) => data)
  .handler(
    async ({ data: { clipId, newNotes, modifiedNotes, removedNoteIds } }) => {
      if (newNotes.length > 0) {
        await gql(
          `mutation($id: Int!, $notes: NotesDictionaryInput!) {
            clip_add_new_notes(id: $id, notes_dictionary: $notes) { id }
          }`,
          Schema.Struct({
            clip_add_new_notes: Schema.Struct({ id: Schema.Number }),
          }),
          { id: clipId, notes: { notes: newNotes } },
        );
      }
      if (modifiedNotes.length > 0) {
        await gql(
          `mutation($id: Int!, $notes: NotesDictionaryInput!) {
            clip_apply_note_modifications(id: $id, notes_dictionary: $notes) { id }
          }`,
          Schema.Struct({
            clip_apply_note_modifications: Schema.Struct({ id: Schema.Number }),
          }),
          { id: clipId, notes: { notes: modifiedNotes } },
        );
      }
      if (removedNoteIds.length > 0) {
        await gql(
          `mutation($id: Int!, $ids: [Int!]!) {
            clip_remove_notes_by_id(id: $id, ids: $ids) { id }
          }`,
          Schema.Struct({
            clip_remove_notes_by_id: Schema.Struct({ id: Schema.Number }),
          }),
          { id: clipId, ids: removedNoteIds },
        );
      }
    },
  );
