# Research: Fire/Trigger Clip from Index Route

## Goal

Add a "Play Clip" button to the index route that:

- Is enabled when clip notes have been read (i.e. `notes.length > 0`)
- Fires the clip via `clip_fire` mutation on click

## What Exists

### LiveQL has `clip_fire` — unused

`refs/liveql/liveql-n4m.js:193`

```graphql
clip_fire(id: Int!): Clip
```

Resolver (`refs/liveql/liveql-n4m.js:332`): calls `call(args.id, "fire")` on the Live API object. This triggers the clip in Ableton Live's session view.

**Not wired up anywhere in `src/`.**

### Global transport already works

`src/lib/liveql.ts` has `togglePlay()` server fn that calls `song_start_playing` / `song_stop_playing`. Bound to Space bar in `index.tsx:68-89`.

### Current state in index route

`src/routes/index.tsx` tracks:

- `clipInfo: ClipInfo | null` — has `id`, `name`, `path`, `length`, `signature_numerator`, `signature_denominator`
- `notes: Note[]` — populated by `readClip()` after "Read from Live"
- `readMutation` — the read flow, sets both `notes` and `clipInfo`

When `notes.length > 0`, we have `clipInfo.id` — enough to call `clip_fire`.

## Implementation Plan

### 1. Add `fireClip` server fn in `src/lib/liveql.ts`

```ts
export const fireClip = createServerFn({ method: "POST" })
  .inputValidator((data: { clipId: number }) => data)
  .handler(async ({ data }) => {
    const res = await gqlRequest(
      `mutation FireClip($id: Int!) {
        clip_fire(id: $id) { id name }
      }`,
      { id: data.clipId },
    );
    return res.data;
  });
```

Follows same pattern as `togglePlay` and `writeNotes`.

### 2. Add mutation + button in `src/routes/index.tsx`

- `fireClipMutation = useMutation({ mutationFn: fireClip })`
- Button: disabled when `notes.length === 0` or `!clipInfo`
- On click: `fireClipMutation.mutate({ clipId: clipInfo.id })`
- Optional: show loading/error state via `fireClipMutation.isPending`

### 3. Keyboard shortcut (optional — separate iteration?)

Space already toggles global transport. Options:

- Different key for clip fire (e.g. Enter, or Cmd+Enter)
- Keep Space as-is, make clip fire button-only for now

## Open Questions

1. **Stop behavior**: `clip_fire` fires the clip. There's no `clip_stop` mutation in the schema. Should we add one, or rely on Live's transport? LiveQL schema only has `song_start_playing`/`song_stop_playing` for transport control.

No stop needed.

2. **Keyboard shortcut**: Keep Space for global transport? Add another key for clip fire? Or button-only first?

button only 3. **Visual feedback**: Should the button indicate playing state? Would require polling `clip.is_playing` — but the Clip type doesn't expose that field. Could add it to the schema, or skip for v1.

no, fire and forget 4. **Clip launch quantization**: `clip_fire` calls Live's `fire()` which respects the global launch quantization. Is this the desired behavior, or do we need fire with `force_legato` / quantization override? (Live API has `fire(force_legato, launch_quantization, clip_slot)`)

simple fire 5. **Interaction with write**: Should fire happen automatically after write? Or always manual?

manual

## Key Files

| File                            | Relevance                           |
| ------------------------------- | ----------------------------------- |
| `src/lib/liveql.ts`             | Add `fireClip` server fn here       |
| `src/routes/index.tsx`          | Add button + mutation here          |
| `refs/liveql/liveql-n4m.js:193` | `clip_fire` schema definition       |
| `refs/liveql/liveql-n4m.js:332` | `clip_fire` resolver                |
| `src/lib/Domain.ts`             | Clip schema (no `is_playing` field) |
