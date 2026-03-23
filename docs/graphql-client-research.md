# GraphQL Client Research

**Stack:** React 19, TanStack Query 5.95, Effect 4.0, TypeScript 5.8
**Server:** liveql — GraphQL Yoga at `http://localhost:4000` (Ableton Live LOM)
**Repo:** https://github.com/mw10013/liveql

---

## Approach: Effect Schema Only (no codegen)

Effect Schemas give **both** compile-time types and runtime validation in one definition. No build step, no generated files.

```
┌──────────────────────────────────────┐
│  Effect Schema (define once)         │
│  - Compile-time: TS types flow out   │
│  - Runtime: validates wire JSON      │
├──────────────────────────────────────┤
│  TanStack Query                      │
│  - queryOptions + useQuery           │
│  - caching, refetch                  │
└──────────────────────────────────────┘
```

---

## GraphQL Primer

Three operation types: **query** (read), **mutation** (write), **subscription** (unused here).

A query is a string. You POST `{ "query": "...", "variables": {...} }` to the server. Server responds `{ "data": {...}, "errors": [...] }`.

```graphql
{ live_set { is_playing tracks { name } } }
```

For liveql, one root field (`live_set`). You select down from there.

---

## Schema Design

**Base schemas** — one per GraphQL type, scalar fields only:

```ts
import { Schema } from "effect"

const Song = Schema.Struct({
  id: Schema.Number, path: Schema.String, is_playing: Schema.Boolean,
})
const Track = Schema.Struct({
  id: Schema.Number, path: Schema.String, has_midi_input: Schema.Boolean, name: Schema.String,
})
const ClipSlot = Schema.Struct({
  id: Schema.Number, path: Schema.String, has_clip: Schema.Boolean,
})
const Clip = Schema.Struct({
  id: Schema.Number, path: Schema.String, end_time: Schema.Number,
  is_arrangement_clip: Schema.Boolean, is_midi_clip: Schema.Boolean,
  length: Schema.Number, looping: Schema.Boolean, name: Schema.String,
  signature_denominator: Schema.Number, signature_numerator: Schema.Number, start_time: Schema.Number,
})
const Note = Schema.Struct({
  note_id: Schema.Number, pitch: Schema.Number, start_time: Schema.Number,
  duration: Schema.Number, velocity: Schema.Number, mute: Schema.Boolean,
  probability: Schema.Number, velocity_deviation: Schema.Number, release_velocity: Schema.Number,
})
```

**Composed schemas** — for specific queries, built from base:

```ts
const SongOverview = Schema.Struct({
  ...Song.fields,
  tracks: Schema.Array(Schema.Struct({
    ...Track.fields,
    clip_slots: Schema.Array(Schema.Struct({
      ...ClipSlot.fields, clip: Schema.NullOr(Clip),
    })),
  })),
})
```

Queries always request all scalar fields. Not optimizing for over-fetching.

---

## Execute Helper (strict mode)

Throw on any `errors`, then validate `data` with Effect Schema:

```ts
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientResponse, FetchHttpClient, HttpBody } from "effect/unstable/http"

const ENDPOINT = "http://localhost:4000/graphql"

function gqlEffect<T>(
  query: string,
  variables: Record<string, unknown> | undefined,
  dataSchema: Schema.Codec<T, unknown>,
): Effect.Effect<T, Schema.SchemaError | Error, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* client.post(ENDPOINT, {
      headers: { "Content-Type": "application/json" },
      body: HttpBody.jsonUnsafe({ query, variables }),
    })

    const json = yield* response.json

    if (json.errors?.length) {
      yield* Effect.fail(new Error(json.errors.map((e: any) => e.message).join("; ")))
    }

    return yield* Schema.decodeUnknownEffect(dataSchema)(json.data)
  })
}

function gql<T>(query: string, dataSchema: Schema.Codec<T, unknown>, variables?: Record<string, unknown>): Promise<T> {
  return Effect.runPromise(
    gqlEffect(query, variables, dataSchema).pipe(Effect.provide(FetchHttpClient.layer))
  )
}
```

Three response shapes:
| Shape | `data` | `errors` | Strict mode behavior |
|---|---|---|---|
| Success | present | absent | Validate shape, return |
| Partial | present (some nulls) | present | **Throw** |
| Failure | null | present | **Throw** |

---

## TanStack Query Integration

```ts
import { queryOptions, useQuery } from "@tanstack/react-query"

const songQueryOptions = queryOptions({
  queryKey: ['live_set'] as const,
  queryFn: () => gql(`{
    live_set {
      id path is_playing
      tracks {
        id path name has_midi_input
        clip_slots {
          id path has_clip
          clip { id path name looping length is_midi_clip end_time
                 is_arrangement_clip signature_denominator signature_numerator start_time }
        }
      }
    }
  }`, Schema.Struct({ live_set: SongOverview })),
})

function SongView() {
  const { data } = useQuery(songQueryOptions)
  return <div>{data?.live_set.is_playing ? "Playing" : "Stopped"}</div>
}
```

Mutation:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query"

const rename = useMutation({
  mutationFn: (name: string) => gql(
    `mutation { track_set_name(id: ${trackId}, name: "${name}") { id name } }`,
    Schema.Struct({ track_set_name: Schema.Struct({ id: Schema.Number, name: Schema.String }) }),
  ),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['live_set'] }),
})
```

---

## Query String Patterns

```ts
// Basic
`{ live_set { is_playing } }`

// Nested
`{ live_set { tracks { name clip_slots { has_clip clip { name looping } } } } }`

// Field argument
`{ live_set { track(index: 0) { name } } }`

// Mutation
`mutation { song_start_playing(id: 1) { is_playing } }`

// Mutation with variables (for user input)
`mutation RenameTrack($id: Int!, $name: String!) {
  track_set_name(id: $id, name: $name) { id name }
}`
// variables: { id: 5, name: "Synth Lead" }
```

Plain strings. No builder library needed for this schema size.

---

## Decisions

- **Strict mode:** throw on any GraphQL errors (no partial responses)
- **Schema generation:** LLM generates Effect Schemas from the liveql SDL
- **Base schemas:** scalar fields only per object type; composed per query
- **Variables:** deferred, hardcoded arguments for now
- **HTTP:** `FetchHttpClient.layer` directly, no auth
- **Schema drift:** runtime validation errors catch it

---

## What's NOT used

- No codegen (`@graphql-codegen/cli`)
- No graphql-request / Graffle (Effect HttpClient handles HTTP)
- No Apollo / urql (TanStack Query handles caching)
- No query builder (plain strings)

---

## Full liveql schema

<details>
<summary>SDL from liveql-n4m.js</summary>

```graphql
type Query { live_set: Song! }

type Song { id: Int! path: String! is_playing: Boolean! view: SongView! track(index: Int!): Track tracks: [Track!]! }
type SongView { id: Int! path: String! selected_track: Track detail_clip: Clip }
type Track { id: Int! path: String! clip_slot(index: Int!): ClipSlot clip_slots: [ClipSlot!]! has_midi_input: Boolean! name: String! }
type ClipSlot { id: Int! path: String! clip: Clip has_clip: Boolean! }
type Clip { id: Int! path: String! end_time: Float! is_arrangement_clip: Boolean! is_midi_clip: Boolean! length: Float! looping: Boolean! name: String! signature_denominator: Int! signature_numerator: Int! start_time: Float! notes: [Note!] }
type Note { note_id: Int! pitch: Int! start_time: Float! duration: Float! velocity: Float! mute: Boolean! probability: Float! velocity_deviation: Float! release_velocity: Float! }

type Mutation {
  song_start_playing(id: Int!): Song
  song_stop_playing(id: Int!): Song
  track_set_name(id: Int!, name: String!): Track
  clip_set_looping(id: Int!, looping: Boolean!): Clip
  clip_set_properties(id: Int!, properties: ClipPropertiesInput!): Clip
  clip_add_new_notes(id: Int!, notes_dictionary: NotesDictionaryInput!): Clip
  clip_apply_note_modifications(id: Int!, notes_dictionary: NotesDictionaryInput!): Clip
  clip_fire(id: Int!): Clip
  clip_get_notes_extended(id: Int!, from_pitch: Int!, pitch_span: Int!, from_time: Float!, time_span: Float!): NotesDictionary!
  clip_get_selected_notes_extended(id: Int!): NotesDictionary!
  clip_select_all_notes(id: Int!): Clip
  clip_remove_notes_by_id(id: Int!, ids: [Int!]!): Clip
  clip_remove_notes_extended(id: Int!, from_pitch: Int!, pitch_span: Int!, from_time: Float!, time_span: Float!): Clip
}
```
</details>

---

## Implementation Plan

### File Structure

```
src/lib/
  gql.ts          — GraphQL client (Effect service + gql helper)
  Domain.ts       — Effect Schemas for liveql types
src/routes/
  index.tsx       — test queries rendered in cards
```

### Step 1: Base Schemas (`src/lib/schemas.ts`)

One `Schema.Struct` per GraphQL object type, scalar fields only. Float fields → `Schema.Number`.

```ts
import { Schema } from "effect"

const Song = Schema.Struct({
  id: Schema.Number, path: Schema.String, is_playing: Schema.Boolean,
})
const SongView = Schema.Struct({
  id: Schema.Number, path: Schema.String,
})
const Track = Schema.Struct({
  id: Schema.Number, path: Schema.String, has_midi_input: Schema.Boolean, name: Schema.String,
})
const ClipSlot = Schema.Struct({
  id: Schema.Number, path: Schema.String, has_clip: Schema.Boolean,
})
const Clip = Schema.Struct({
  id: Schema.Number, path: Schema.String, end_time: Schema.Number,
  is_arrangement_clip: Schema.Boolean, is_midi_clip: Schema.Boolean,
  length: Schema.Number, looping: Schema.Boolean, name: Schema.String,
  signature_denominator: Schema.Number, signature_numerator: Schema.Number, start_time: Schema.Number,
})
const Note = Schema.Struct({
  note_id: Schema.Number, pitch: Schema.Number, start_time: Schema.Number,
  duration: Schema.Number, velocity: Schema.Number, mute: Schema.Boolean,
  probability: Schema.Number, velocity_deviation: Schema.Number, release_velocity: Schema.Number,
})
```

Composed schemas built per-query from base fields (e.g. `SongOverview` from the research section above).

### Step 2: GraphQL Client (`src/lib/gql.ts`)

Use Effect 4 `HttpClient` + `HttpClientRequest` idioms. POST the GraphQL envelope, check for `errors`, decode `data` with the caller's schema.

```ts
import { Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"

const ENDPOINT = "http://localhost:4000/graphql"

const GqlEnvelope = Schema.Struct({
  data: Schema.UndefinedOr(Schema.Unknown),
  errors: Schema.optionalKey(Schema.Array(Schema.Struct({ message: Schema.String }))),
})

function gqlEffect<T>(
  query: string,
  dataSchema: Schema.Schema<T>,
  variables?: Record<string, unknown>,
): Effect.Effect<T, Error | Schema.SchemaError, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    const response = yield* HttpClientRequest.post(ENDPOINT).pipe(
      HttpClientRequest.bodyJsonUnsafe({ query, variables }),
      client.execute,
    )
    const envelope = yield* HttpClientResponse.schemaBodyJson(GqlEnvelope)(response)
    if (envelope.errors?.length) {
      yield* Effect.fail(new Error(envelope.errors.map((e) => e.message).join("; ")))
    }
    return yield* Schema.decodeUnknownEffect(dataSchema)(envelope.data)
  })
}

function gql<T>(
  query: string,
  dataSchema: Schema.Schema<T>,
  variables?: Record<string, unknown>,
): Promise<T> {
  return gqlEffect(query, dataSchema, variables).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.runPromise,
  )
}
```

Key patterns from Effect 4:
- `HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body), client.execute)` — idiomatic request building
- `HttpClientResponse.schemaBodyJson(schema)(response)` — decode JSON body with schema
- `Schema.decodeUnknownEffect(schema)(data)` — validate the inner `data` field
- `Effect.provide(FetchHttpClient.layer)` — provide HTTP implementation at the edge

### Step 3: Test Queries in Index Route (`src/routes/index.tsx`)

Replace the skeleton with a few live queries to validate the full stack. Use TanStack Query `queryOptions` + `useQuery` — no loader (queries hit liveql client-side).

**Query 1 — Song status:** `{ live_set { id is_playing } }`
**Query 2 — Track list:** `{ live_set { tracks { id name has_midi_input } } }`
**Query 3 — Full overview:** `{ live_set { id is_playing tracks { id name clip_slots { id has_clip clip { id name looping } } } } }`

```ts
const songStatusOptions = queryOptions({
  queryKey: ["live_set", "status"],
  queryFn: () => gql(
    `{ live_set { id is_playing } }`,
    Schema.Struct({ live_set: Schema.Struct({ id: Schema.Number, is_playing: Schema.Boolean }) }),
  ),
})

const trackListOptions = queryOptions({
  queryKey: ["live_set", "tracks"],
  queryFn: () => gql(
    `{ live_set { tracks { id name has_midi_input } } }`,
    Schema.Struct({
      live_set: Schema.Struct({
        tracks: Schema.Array(Schema.Struct({ id: Schema.Number, name: Schema.String, has_midi_input: Schema.Boolean })),
      }),
    }),
  ),
})
```

Render each query result in a `Card`. Show loading/error states via `useQuery` status. Display raw JSON with `<pre>` for quick validation.

### Step 4: Verify

1. `pnpm dev` — start prelive on :4500
2. Start liveql on :4000 (Ableton Live must be open)
3. Open `http://localhost:4500` — confirm all three cards populate with live data
4. `pnpm typecheck && pnpm lint` — no errors
