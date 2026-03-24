# Note Editor — Index Route Research

Date: 2026-03-23

Goal: a simple note editor in the index route. User clicks "Read" to fetch notes from the current Live clip, edits them in a TanStack Table, clicks "Write" to push changes back.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Index Route (src/routes/index.tsx)                          │
│                                                              │
│  [Read from Live]  button                                    │
│       │                                                      │
│       ▼                                                      │
│  useQuery ──► readNotes server fn ──► gql(clip_notes query)  │
│       │                                                      │
│       ▼                                                      │
│  TanStack Table (editable cells)                             │
│       │                                                      │
│  [Write to Live]  button                                     │
│       │                                                      │
│       ▼                                                      │
│  useMutation ──► writeNotes server fn ──► gql(mutation)      │
│       │                                                      │
│       ▼                                                      │
│  invalidateQueries ──► re-read to confirm                    │
└──────────────────────────────────────────────────────────────┘
```

Two server functions, two React hooks, one table. Minimal.

---

## Step 1: Server Functions (`createServerFn`)

TanStack Start's `createServerFn` wraps server-side logic. The returned function is directly compatible with `useMutation`'s `mutationFn`.

### readNotes

```ts
import { createServerFn } from "@tanstack/react-start"

export const readNotes = createServerFn({ method: "GET" })
  .inputValidator((data: { clipId: number }) => data)
  .handler(async ({ data: { clipId } }) => {
    // call liveql via gql()
    return gql(
      `mutation GetNotes($id: Int!) {
        clip_get_notes_extended(id: $id, from_pitch: 0, pitch_span: 128, from_time: 0, time_span: 9999)
      }`,
      Schema.Struct({ clip_get_notes_extended: Domain.NotesDictionary }),
      { id: clipId },
    )
  })
```

But wait — we also need the clip metadata. Two options:

**Option A**: Two separate queries (simpler, more modular)
1. Query `detail_clip` for clip metadata + `id`
2. Then `clip_get_notes_extended` for notes

**Option B**: Single query that gets both (fewer round trips)

We should use `detail_clip` as the entry point since the user selects the clip in Ableton:

```ts
export const readClipAndNotes = createServerFn({ method: "GET" })
  .handler(async () => {
    // 1. Get detail_clip
    const clipData = await gql(
      `{ live_set { view { detail_clip { id name length is_midi_clip } } } }`,
      Schema.Struct({
        live_set: Schema.Struct({
          view: Schema.Struct({
            detail_clip: Schema.NullOr(Domain.ClipDetail),
          }),
        }),
      }),
    )
    const clip = clipData.live_set.view.detail_clip
    if (!clip) throw new Error("No clip selected in Live's Detail View")

    // 2. Get notes for that clip
    const notesData = await gql(
      `mutation GetNotes($id: Int!, $length: Float!) {
        clip_get_notes_extended(id: $id, from_pitch: 0, pitch_span: 128, from_time: 0, time_span: $length)
      }`,
      Schema.Struct({ clip_get_notes_extended: Domain.NotesDictionary }),
      { id: clip.id, length: clip.length },
    )

    return { clip, notes: notesData.clip_get_notes_extended.notes }
  })
```

**Why two calls inside one server fn?** The first call gets the clip `id` and `length`. The second call needs those values. Both go server → liveql → Ableton. Bundling them hides the two-step from the client (single fetch round trip to our server).

### writeNotes

```ts
export const writeNotes = createServerFn({ method: "POST" })
  .inputValidator((data: {
    clipId: number
    newNotes: Domain.NoteInput[]
    modifiedNotes: Domain.NoteInput[]
    removedNoteIds: number[]
  }) => data)
  .handler(async ({ data: { clipId, newNotes, modifiedNotes, removedNoteIds } }) => {
    // Three mutations in sequence:
    if (newNotes.length > 0) {
      await gql(
        `mutation Add($id: Int!, $notes: NotesDictionaryInput!) {
          clip_add_new_notes(id: $id, notes_dictionary: $notes) { id }
        }`,
        Schema.Struct({ clip_add_new_notes: Schema.Struct({ id: Schema.Number }) }),
        { id: clipId, notes: { notes: newNotes } },
      )
    }
    if (modifiedNotes.length > 0) {
      await gql(
        `mutation Mod($id: Int!, $notes: NotesDictionaryInput!) {
          clip_apply_note_modifications(id: $id, notes_dictionary: $notes) { id }
        }`,
        Schema.Struct({ clip_apply_note_modifications: Schema.Struct({ id: Schema.Number }) }),
        { id: clipId, notes: { notes: modifiedNotes } },
      )
    }
    if (removedNoteIds.length > 0) {
      await gql(
        `mutation Del($id: Int!, $ids: [Int!]!) {
          clip_remove_notes_by_id(id: $id, ids: $ids) { id }
        }`,
        Schema.Struct({ clip_remove_notes_by_id: Schema.Struct({ id: Schema.Number }) }),
        { id: clipId, ids: removedNoteIds },
      )
    }
  })
```

**Key pattern from refs**: `createServerFn` returns a function with signature `(opts: { data: TInput }) => Promise<TOutput>`. TanStack Query's `useMutation` passes variables directly, so `mutationFn: writeNotes` receives `{ data: { clipId, ... } }` which matches.

**From `refs/tan-start/examples/react/start-trellaux/src/queries.ts`** — the real-world pattern is:

```ts
const mutation = useMutation({
  mutationFn: writeNotes,   // server fn directly
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notes"] }),
})
mutation.mutate({ data: { clipId, newNotes, modifiedNotes, removedNoteIds } })
```

---

## Step 2: TanStack Table for Note Display

**From `refs/tan-table/examples/react/editable-data/src/main.tsx`** — the editable cell pattern:

```tsx
const defaultColumn: Partial<ColumnDef<NoteRow>> = {
  cell: ({ getValue, row: { index }, column: { id }, table }) => {
    const initialValue = getValue()
    const [value, setValue] = React.useState(initialValue)
    const onBlur = () => table.options.meta?.updateData(index, id, value)
    React.useEffect(() => { setValue(initialValue) }, [initialValue])
    return <input value={value} onChange={e => setValue(e.target.value)} onBlur={onBlur} />
  },
}
```

But for a note editor, we want typed inputs:
- **pitch**: number input (0–127)
- **start_time**: number input (beats, float)
- **duration**: number input (beats, float)
- **velocity**: number input (0–127)
- **mute**: checkbox
- **probability**: number input (0–1)

Columns:

```ts
const columnHelper = createColumnHelper<NoteRow>()

const columns = [
  columnHelper.accessor("pitch", {
    header: "Pitch",
    cell: info => <NumberInput value={info.getValue()} onChange={info.setValue} min={0} max={127} />,
  }),
  columnHelper.accessor("start_time", {
    header: "Start",
    cell: info => <NumberInput value={info.getValue()} onChange={info.setValue} step={0.25} />,
  }),
  columnHelper.accessor("duration", {
    header: "Duration",
    cell: info => <NumberInput value={info.getValue()} onChange={info.setValue} step={0.25} min={0.01} />,
  }),
  columnHelper.accessor("velocity", {
    header: "Vel",
    cell: info => <NumberInput value={info.getValue()} onChange={info.setValue} min={0} max={127} />,
  }),
  columnHelper.accessor("mute", {
    header: "Mute",
    cell: info => <input type="checkbox" checked={info.getValue()} onChange={e => info.setValue(e.target.checked)} />,
  }),
  columnHelper.display({
    id: "actions",
    cell: ({ row }) => <button onClick={() => deleteNote(row.index)}>Delete</button>,
  }),
]
```

### Table + Editable State

We need `NoteRow` — a local type that extends `Note` with edit tracking:

```ts
type NoteRow = Domain.Note.Type & {
  _editState: "unchanged" | "modified" | "new"
  _deleted: boolean
}
```

Or simpler — maintain three sets:
- `notes` array (TanStack Table data source, includes all non-deleted notes)
- `newNoteIds: Set<number>` — notes added in this session (negative temp IDs)
- `modifiedNoteIds: Set<number>` — notes whose fields changed
- `deletedNoteIds: Set<number>` — notes removed from table

When "Write" is clicked, partition the notes into `newNotes`, `modifiedNotes`, `removedNoteIds` and pass to `writeNotes` server fn.

### Row Identity

Use `note_id` as the row ID:

```ts
const table = useReactTable({
  data: notes,
  columns,
  getCoreRowModel: getCoreRowModel(),
  getRowId: row => String(row.note_id),
  defaultColumn,
  meta: {
    updateData: (rowIndex, columnId, value) => {
      setNotes(old => old.map((row, i) =>
        i === rowIndex ? { ...row, [columnId]: value } : row
      ))
      // track modification
      setModifiedNoteIds(prev => new Set(prev).add(notes[rowIndex].note_id))
    },
  },
})
```

---

## Step 3: Wire It Up in the Index Route

```tsx
function RouteComponent() {
  const queryClient = useQueryClient()
  const [notes, setNotes] = React.useState<NoteRow[]>([])
  const [clipInfo, setClipInfo] = React.useState<ClipInfo | null>(null)

  // Read mutation (use as query-like via useMutation)
  const readMutation = useMutation({
    mutationFn: readClipAndNotes,
    onSuccess: (data) => {
      setClipInfo(data.clip)
      setNotes(data.notes.map(n => ({ ...n, _editState: "unchanged" })))
    },
  })

  // Write mutation
  const writeMutation = useMutation({
    mutationFn: writeNotes,
    onSuccess: () => {
      // Re-read to sync note_ids (new notes get real IDs from Live)
      readMutation.mutate({ data: {} })
    },
  })

  // Derive write payload from current state
  const handleWrite = () => {
    if (!clipInfo) return
    writeMutation.mutate({
      data: {
        clipId: clipInfo.id,
        newNotes: notes.filter(n => n.note_id < 0),  // temp IDs
        modifiedNotes: notes.filter(n => modifiedNoteIds.has(n.note_id) && n.note_id > 0),
        removedNoteIds: [...deletedNoteIds],
      },
    })
  }

  return (
    <div>
      <button onClick={() => readMutation.mutate({ data: {} })} disabled={readMutation.isPending}>
        Read from Live
      </button>
      <button onClick={handleWrite} disabled={!clipInfo || writeMutation.isPending}>
        Write to Live
      </button>
      {clipInfo && <p>{clipInfo.name} ({clipInfo.length} beats)</p>}
      <NoteTable notes={notes} />
    </div>
  )
}
```

---

## Step 4: Domain Schemas Needed

Add to `src/lib/Domain.ts`:

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
})

export const NotesDictionary = Schema.Struct({
  notes: Schema.Array(Note),
})

export const ClipDetail = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  length: Schema.Number,
  is_midi_clip: Schema.Boolean,
})
```

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Read approach | Single server fn with two gql calls | Hides two-step from client, single fetch round trip |
| Write approach | Single server fn with up to 3 gql calls | new/modified/deleted partitioned server-side |
| Table lib | TanStack Table v8 | Already installed, supports editable cells |
| Edit tracking | Local `Set<number>` for modified/new/deleted IDs | Simple, no complex state management |
| Row IDs | `note_id` (negative for new notes) | Stable identity through edits |
| Clip selection | `SongView.detail_clip` | User selects in Ableton, no app UI needed |
| Mutations vs queries | `useMutation` for both read and write | `readClipAndNotes` is imperative (button-triggered), not a polling query |

---

## File Plan

| File | Change |
|---|---|
| `src/lib/Domain.ts` | Add `NoteInput`, `NotesDictionary`, `ClipDetail` schemas |
| `src/lib/liveql.ts` (new) | `readClipAndNotes` and `writeNotes` server functions |
| `src/routes/index.tsx` | Replace `QueryCard` demo with note editor UI |
| `src/components/NoteTable.tsx` (new) | TanStack Table component with editable cells |

---

## Open Questions

1. **Adding new notes**: What UI for adding a note? Click on empty row? Dedicated "Add Note" button with defaults?
2. **Sorting**: Should the table be sortable by column? (TanStack Table supports `getSortedRowModel`)
3. **Pitch display**: Show raw MIDI number (0–127) or note name + octave (C3, D#4)?
4. **Undo**: Should edits be undoable before writing? (local history stack)
5. **Polling**: Should we re-read notes periodically to catch changes made directly in Live?
