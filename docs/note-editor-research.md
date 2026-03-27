# Note Editor — Index Route Research

Date: 2026-03-23

Goal: simple note editor. Button to read notes from the Live clip in the Detail View, TanStack Table to display/edit, button to write changes back.

---

## What liveql Gives Us

Verified from `refs/liveql/liveql-n4m.js` schema and resolvers.

### Reading a clip and its notes — one query

`SongView.detail_clip` is in the schema (line 106). `Clip.notes` is a field (line 137) backed by a resolver that calls `get_all_notes_extended(id)` and returns `[Note!]` sorted by start_time then pitch. Returns all notes regardless of loop boundaries. No mutation needed for reading.

```graphql
{
  live_set {
    view {
      detail_clip {
        id
        name
        length
        is_midi_clip
        notes {
          note_id
          pitch
          start_time
          duration
          velocity
          mute
          probability
        }
      }
    }
  }
}
```

Returns `null` for `detail_clip` if no clip is open in Live's Detail View. Returns `null` for `notes` if not a MIDI clip.

### Writing notes — three mutations

All verified in the schema (lines 188–203):

| Liveql Mutation                                       | LOM Call                              | When                             |
| ----------------------------------------------------- | ------------------------------------- | -------------------------------- |
| `clip_add_new_notes(id, notes_dictionary)`            | `Clip.add_new_notes(dict)`            | New notes (omit `note_id`)       |
| `clip_apply_note_modifications(id, notes_dictionary)` | `Clip.apply_note_modifications(dict)` | Edited notes (include `note_id`) |
| `clip_remove_notes_by_id(id, ids)`                    | `Clip.remove_notes_by_id(ids...)`     | Deleted notes                    |

The input type `NotesDictionaryInput { notes: [NoteInput!]! }` is in the schema (line 174). `NoteInput.note_id` is optional (line 163).

### Playback

| Liveql Mutation          | Effect          |
| ------------------------ | --------------- |
| `song_start_playing(id)` | Start transport |
| `song_stop_playing(id)`  | Stop transport  |
| `clip_fire(id)`          | Launch the clip |

---

## Architecture

```
src/routes/index.tsx          — route component, state, buttons
src/components/NoteTable.tsx  — TanStack Table with editable cells
src/lib/liveql.ts             — server functions (readClip, writeNotes)
src/lib/Domain.ts             — Effect schemas (already exists, needs additions)
src/lib/gql.ts                — GraphQL fetch helper (already exists)
```

### Data Flow

```
[Read from Live] click
  → useMutation(readClip)
  → server fn: gql(detail_clip + notes query)
  → sets local state: { clip, notes }

[TanStack Table]
  → renders notes as editable rows
  → tracks modified/deleted/new note IDs in local Sets

[Write to Live] click
  → partition notes by edit state (new / modified / deleted)
  → useMutation(writeNotes)
  → server fn: up to 3 gql mutations
  → on success: re-read to sync note_ids
```

---

## Server Functions

TanStack Start's `createServerFn` returns a function with signature `(opts: { data: TInput }) => Promise<TOutput>`. From `refs/tan-start/examples/react/start-trellaux/src/queries.ts`, the real-world pattern is to pass the server fn directly as `useMutation`'s `mutationFn`.

### readClip — fetches detail_clip + notes in one server round trip

```ts
import { createServerFn } from "@tanstack/react-start";

export const readClip = createServerFn({ method: "GET" }).handler(async () => {
  return gql(
    `{ live_set { view { detail_clip {
        id name length is_midi_clip
        notes { note_id pitch start_time duration velocity mute probability }
      } } } }`,
    Schema.Struct({
      live_set: Schema.Struct({
        view: Schema.Struct({
          detail_clip: Schema.NullOr(Domain.ClipWithNotes),
        }),
      }),
    }),
  );
});
```

No input. No parameters. The user picks the clip in Ableton, we read whatever is in the Detail View.

### writeNotes — partitions edits into up to 3 mutations

```ts
export const writeNotes = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      clipId: number;
      newNotes: Domain.NoteInput[];
      modifiedNotes: Domain.NoteInput[];
      removedNoteIds: number[];
    }) => data,
  )
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
```

---

## Table

From `refs/tan-table/examples/react/editable-data/src/main.tsx`:

TanStack Table's editable pattern: define a `defaultColumn` with a custom `cell` that renders an `<input>`, sync local state on `onBlur`, and push changes up via `table.options.meta.updateData`.

### Columns

| Column     | Input                     | Constraints                |
| ---------- | ------------------------- | -------------------------- |
| pitch      | `<input type="number">`   | 0–127                      |
| start_time | `<input type="number">`   | beats, step 0.25           |
| duration   | `<input type="number">`   | beats, step 0.25, min 0.01 |
| velocity   | `<input type="number">`   | 0–127                      |
| mute       | `<input type="checkbox">` | boolean                    |
| delete     | `<button>`                | removes row                |

### Edit tracking

Maintain three local `Set`s alongside the `notes` array:

- `modifiedNoteIds: Set<number>` — notes where any field changed (tracks `note_id`)
- `deletedNoteIds: Set<number>` — notes removed from table
- New notes get a temporary negative `note_id` (e.g., `nextTempId--`) and are identified by `note_id < 0`

On write, partition the `notes` array:

- `newNotes`: `notes.filter(n => n.note_id < 0)` (strip temp id, Live assigns real id)
- `modifiedNotes`: `notes.filter(n => modifiedNoteIds.has(n.note_id))`
- `removedNoteIds`: `[...deletedNoteIds]`

### Row identity

```ts
const table = useReactTable({
  data: notes,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getRowId: (row) => String(row.note_id),
});
```

---

## Route Component

```tsx
function RouteComponent() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [clipInfo, setClipInfo] = useState<ClipInfo | null>(null);
  const [modifiedNoteIds, setModifiedNoteIds] = useState<Set<number>>(
    new Set(),
  );
  const [deletedNoteIds, setDeletedNoteIds] = useState<Set<number>>(new Set());

  const readMutation = useMutation({
    mutationFn: readClip,
    onSuccess: (data) => {
      const detailClip = data.live_set.view.detail_clip;
      if (!detailClip) return;
      setClipInfo({
        id: detailClip.id,
        name: detailClip.name,
        length: detailClip.length,
      });
      setNotes(detailClip.notes ?? []);
      setModifiedNoteIds(new Set());
      setDeletedNoteIds(new Set());
    },
  });

  const writeMutation = useMutation({
    mutationFn: writeNotes,
    onSuccess: () => readMutation.mutate({ data: {} }),
  });

  const handleWrite = () => {
    if (!clipInfo) return;
    writeMutation.mutate({
      data: {
        clipId: clipInfo.id,
        newNotes: notes.filter((n) => n.note_id < 0),
        modifiedNotes: notes.filter(
          (n) => modifiedNoteIds.has(n.note_id) && n.note_id > 0,
        ),
        removedNoteIds: [...deletedNoteIds],
      },
    });
  };

  return (
    <div>
      <button onClick={() => readMutation.mutate({ data: {} })}>
        Read from Live
      </button>
      <button onClick={handleWrite} disabled={!clipInfo}>
        Write to Live
      </button>
      {clipInfo && (
        <p>
          {clipInfo.name} ({clipInfo.length} beats)
        </p>
      )}
      <NoteTable
        notes={notes}
        onUpdate={(rowIndex, columnId, value) => {
          setNotes((old) =>
            old.map((row, i) =>
              i === rowIndex ? { ...row, [columnId]: value } : row,
            ),
          );
          setModifiedNoteIds((prev) =>
            new Set(prev).add(notes[rowIndex].note_id),
          );
        }}
        onDelete={(rowIndex) => {
          setDeletedNoteIds((prev) =>
            new Set(prev).add(notes[rowIndex].note_id),
          );
          setNotes((old) => old.filter((_, i) => i !== rowIndex));
        }}
      />
    </div>
  );
}
```

---

## Domain Schemas — additions to `src/lib/Domain.ts`

```ts
export const NoteInput = Schema.Struct({
  note_id: Schema.optional(Schema.Number),
  pitch: Schema.Number,
  start_time: Schema.Number,
  duration: Schema.Number,
  velocity: Schema.optional(Schema.Number),
  mute: Schema.optional(Schema.Boolean),
  probability: Schema.optional(Schema.Number),
  velocity_deviation: Schema.optional(Schema.Number),
  release_velocity: Schema.optional(Schema.Number),
});

export const ClipWithNotes = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  length: Schema.Number,
  is_midi_clip: Schema.Boolean,
  notes: Schema.NullOr(Schema.Array(Note)),
});
```

---

## Decisions

| Decision        | Choice                                       | Why                                                          |
| --------------- | -------------------------------------------- | ------------------------------------------------------------ |
| Read notes      | `Clip.notes` field, no mutation              | Resolver handles `get_all_notes_extended` internally. One query. |
| Write notes     | Three mutations (add/modify/remove)          | Matches liveql schema exactly                                |
| Read trigger    | `useMutation`, not `useQuery`                | Imperative button press, not polling                         |
| Write → re-read | `onSuccess` calls `readMutation.mutate`      | New notes get real `note_id`s from Live                      |
| Clip selection  | `SongView.detail_clip`                       | User selects in Ableton, no app navigation UI needed         |
| Table library   | TanStack Table v8                            | Installed, has editable cell pattern in examples             |
| Edit tracking   | Three `Set<number>` (modified, deleted, new) | Minimal state, partition at write time                       |
| New note IDs    | Temporary negative integers                  | Distinguish new from existing in the partition               |

---

## Open Questions

All resolved.

| #   | Question      | Decision                                                                                        |
| --- | ------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Add note UI   | Click on empty row for now. Text fields for each.                                               |
| 2   | Pitch display | Raw number (0–127).                                                                             |
| 3   | Sort          | Not applicable — notes come sorted from server (start_time asc, pitch asc). This is music data. |

### TanStack Start / createServerFn

Project **is** already using TanStack Start (`StartClient` in `main.tsx`). `createServerFn` from `@tanstack/react-start` works alongside `createFileRoute` — same file or separate file. No pre-work needed.

Pattern:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

const readClip = createServerFn({ method: 'GET' }).handler(async () => { ... })

export const Route = createFileRoute('/')({
  component: RouteComponent,
  // can also use loader: () => readClip() for SSR
})
```
