# Live Set Navigator Research

Date: 2026-04-09

## Goal

Explore a navigator control for index route that can:

- show tracks + clip slots in current Live Set
- indicate currently selected clip
- let user pick a different clip
- refresh on demand via toolbar button (no realtime sync required)

## What Exists (Evidence)

### 1) LiveQL already exposes session-grid traversal

`refs/liveql/liveql-n4m.js:93-123`:

```graphql
type Song {
  view: SongView!
  track(index: Int!): Track
  tracks: [Track!]!
}

type Track {
  clip_slot(index: Int!): ClipSlot
  clip_slots: [ClipSlot!]!
  name: String!
}

type ClipSlot {
  clip: Clip
  has_clip: Boolean!
}
```

This is enough to fetch all tracks and clip metadata for a navigator.

### 2) LiveQL exposes current Live UI clip selection (read-only in current schema)

`refs/liveql/liveql-n4m.js:102-107`:

```graphql
type SongView {
  selected_track: Track
  detail_clip: Clip
}
```

Resolver wiring (`refs/liveql/liveql-n4m.js:382-386`) maps these to Live's current selection.

### 3) LiveQL can fire a chosen clip by id

`refs/liveql/liveql-n4m.js:194`:

```graphql
clip_fire(id: Int!): Clip
```

Current app already uses this:

- server fn: `src/lib/liveql.ts:61-69`
- button mutation call: `src/routes/index.tsx:159-166`

### 4) Current app read flow is tied to `view.detail_clip`

`src/lib/liveql.ts:7-13` currently queries only:

```graphql
{ live_set { view { selected_track { name } detail_clip { ... notes { ... } } } } }
```

So index page can only read notes for whatever clip is selected in Live UI right now.

### 5) Domain model already has a good shape for navigator fetches

`src/lib/Domain.ts:87-100` has `SongOverview`:

```ts
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
});
```

Not currently used, but directly relevant.

## Feasibility vs Requirement

### A) See tracks + clips

Feasible now. No LiveQL changes needed.

Example refresh query:

```graphql
{
  live_set {
    id
    is_playing
    view {
      selected_track {
        id
        name
      }
      detail_clip {
        id
        name
        path
        is_arrangement_clip
      }
    }
    tracks {
      id
      name
      clip_slots {
        id
        has_clip
        clip {
          id
          name
          path
          is_midi_clip
          is_arrangement_clip
          length
        }
      }
    }
  }
}
```

### B) Show which clip is currently selected in Live

Feasible now via `live_set.view.detail_clip`.

Caveat: `detail_clip` can be arrangement clip too (`Clip.is_arrangement_clip` exists), so it may not map to a session grid cell.

### C) Select a different clip in app UI

Feasible now if interpreted as app-local selection (select for app actions, not force Live UI selection).

Approach:

1. store app-local selected clip id (or trackIndex+slotIndex)
2. when user clicks a clip in navigator, use that selection for actions (`fire`, `read notes`, `write notes`)

No LiveQL schema change required.

### D) Programmatically change selected clip in Ableton Live UI

Not feasible with current schema.

Why: no mutation on `SongView` for selection/highlight. `SongView` exposes only read fields (`selected_track`, `detail_clip`) in current typeDefs.

## Refresh-Only Interaction Model (Suggested v1)

### UX model

- Toolbar: add refresh icon button.
- Button click triggers one fetch for navigator metadata.
- No polling, no subscriptions, no auto-sync.

### Data model split

Use two payload classes:

1. **Navigator overview** (tracks/slots/clip metadata, no notes)
2. **Active clip detail** (single clip notes + signature etc)

Reason: all-notes for all clips on refresh is expensive/unnecessary.

### Server function shape

- `readLiveSetOverview` (`GET`): fetch query above.
- keep current `readClip` for "current Live selection" behavior.
- add `readClipBySlot` (`GET`) for app-selected clip:

```graphql
query ($trackIndex: Int!, $slotIndex: Int!) {
  live_set {
    track(index: $trackIndex) {
      clip_slot(index: $slotIndex) {
        clip {
          id
          name
          path
          length
          is_midi_clip
          signature_numerator
          signature_denominator
          notes {
            note_id
            pitch
            start_time
            duration
            velocity
            mute
            probability
            velocity_deviation
            release_velocity
          }
        }
      }
    }
  }
}
```

This uses schema capabilities already present: `Song.track(index)` + `Track.clip_slot(index)`.

## TanStack Start/Router Alignment

Docs support this pattern:

- server fn callable from event handlers/components (`refs/tan-start/docs/start/framework/react/guide/server-functions.md:45-50`)
- loaders can also preload route data (`refs/tan-router/docs/router/guide/data-loading.md:58-76`)

For your requested refresh button, event-driven mutation is simpler than loader-first.

## Proposed v1 slice for index route

1. Add `readLiveSetOverview` server fn + schema.
2. Add toolbar refresh icon button (`lucide-react` already installed).
3. Render compact navigator:
   - rows = tracks
   - cells = clip slots
   - empty slots shown muted
4. Highlight:
   - Live-selected clip from `view.detail_clip.id`
   - app-selected clip from local state
5. Clicking non-empty slot sets app-selected clip.
6. Keep existing note editor path unchanged initially; only wire navigator selection + visual state first.

## Risks / Gaps

- No playing/triggered slot state in current GraphQL `ClipSlot` type (`has_clip` only).
- No API to set Live UI selection.
- `detail_clip` may be arrangement clip, not session clip.

## Questions Before Implementation

1. "Select a different clip" should mean:

- app-local selection only
- or must also force Live UI Detail View selection?

app-local selection only

2. Navigator density preference for v1:

- compact grid (track rows, slot pills)
- or list-only (tracks expandable to clips)

compact grid

3. On clip click in navigator, should v1 also immediately load notes for that clip, or only set selection first?

load notes
