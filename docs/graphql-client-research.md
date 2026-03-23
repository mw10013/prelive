# GraphQL Client Research for TypeScript

**Date:** 2026-03-23
**Context:** Client hitting liveql — a GraphQL Yoga server for Ableton Live's Object Model
**Stack:** React 19, TanStack Query 5.95, TanStack Router/Start, Effect 4.0 (beta), TypeScript 5.8, Vite 7
**Server:** `http://localhost:4000`, GraphQL Yoga, serves GraphiQL at the same address

---

## The Server Schema (liveql)

The liveql server exposes Ableton Live's LOM through GraphQL. Here is the full schema (from `liveql-n4m.js`):

```graphql
type Query {
  live_set: Song!
}

type Song {
  id: Int!
  path: String!
  is_playing: Boolean!
  view: SongView!
  track(index: Int!): Track
  tracks: [Track!]!
}

type SongView {
  id: Int!
  path: String!
  selected_track: Track
  detail_clip: Clip
}

type Track {
  id: Int!
  path: String!
  clip_slot(index: Int!): ClipSlot
  clip_slots: [ClipSlot!]!
  has_midi_input: Boolean!
  name: String!
}

type ClipSlot {
  id: Int!
  path: String!
  clip: Clip
  has_clip: Boolean!
}

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

type Note {
  note_id: Int!
  pitch: Int!
  start_time: Float!
  duration: Float!
  velocity: Float!
  mute: Boolean!
  probability: Float!
  velocity_deviation: Float!
  release_velocity: Float!
}

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

---

## GraphQL Primer (the terminology)

GraphQL has three operation types:
- **Query** — read data
- **Mutation** — write data
- **Subscription** — real-time updates (liveql doesn't use these)

A **query string** is a GraphQL document that describes what data you want:

```graphql
{
  live_set {
    is_playing
    tracks {
      name
      clip_slots {
        has_clip
      }
    }
  }
}
```

You POST this as JSON to the server:

```json
{
  "query": "{ live_set { is_playing tracks { name clip_slots { has_clip } } } }"
}
```

The server responds:

```json
{
  "data": {
    "live_set": {
      "is_playing": true,
      "tracks": [
        { "name": "Drums", "clip_slots": [{ "has_clip": true }] }
      ]
    }
  }
}
```

**Key concepts:**
- The query selects **fields** from **types** defined in the schema
- Fields can take **arguments** like `track(index: 0)`
- **Variables** parameterize queries (separate from the query string)
- A **selection set** is the `{ field1 field2 nested { ... } }` part
- The `data` envelope is the standard GraphQL response format

For liveql, queries are simple because there's one root field: `live_set`. You select down from there.

---

## The Approach: Effect Schema Only (no codegen)

### Why Effect Schema instead of codegen

1. We already depend on Effect — no new dependency
2. Effect Schemas give us **both** compile-time types AND runtime validation in one definition
3. The liveql schema is small (10 types) — hand-writing or LLM-generating schemas is feasible
4. We control the types that flow through the entire codebase
5. No build step, no generated files, no watch process

### How it works

```ts
// 1. Define schemas that match the GraphQL types
const Note = Schema.Struct({
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

// 2. TypeScript types flow from schemas automatically
type Note = Schema.Schema.Type<typeof Note>
// { readonly note_id: number; readonly pitch: number; ... }

// 3. Define a schema for the response envelope
const LiveSetResponse = Schema.Struct({
  data: Schema.Struct({
    live_set: Schema.Struct({
      is_playing: Schema.Boolean,
      tracks: Schema.Array(Schema.Struct({
        name: Schema.String,
        clip_slots: Schema.Array(Schema.Struct({
          has_clip: Schema.Boolean,
        })),
      })),
    }),
  }),
})

// 4. Write a GraphQL query string (just a string)
const query = `{
  live_set {
    is_playing
    tracks {
      name
      clip_slots { has_clip }
    }
  }
}`

// 5. POST, validate, get typed data
const data = yield* Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.post("http://localhost:4000/graphql", {
    headers: { "Content-Type": "application/json" },
    body: HttpBody.jsonUnsafe({ query }),
  })
  const validated = yield* response.pipe(
    HttpClientResponse.schemaBodyJson(LiveSetResponse)
  )
  return validated.data.live_set
})
// data is typed as { is_playing: boolean; tracks: Array<{ name: string; clip_slots: ... }> }
// validated at runtime by Effect Schema
```

### The key insight

Effect Schemas are **bidirectional**: they define the shape AND produce the TypeScript type. One definition, two benefits:

| Definition | Compile-time | Runtime |
|---|---|---|
| `Schema.Struct({ pitch: Schema.Number })` | TS type: `{ pitch: number }` | Validates JSON has a numeric `pitch` field |

Compare to codegen: the TS types come from codegen, but there's no runtime check. You trust the server blindly.

### Schema generation from the server

Since the liveql server runs GraphiQL at `http://localhost:4000`, we can introspect the schema. The SDL is already in the server source. An LLM can take the SDL and generate the Effect Schemas.

Possible workflow:
1. Copy the `typeDefs` from `liveql-n4m.js` (or run an introspection query)
2. Feed to an LLM → get Effect Schema definitions
3. Review and commit the schemas
4. When the server schema changes, re-generate

This is a one-time cost. The liveql schema is stable.

---

## Constructing Query Strings

For liveql, queries are plain strings. The schema is shallow and the operations are straightforward. No builder library needed.

### Query patterns

**Basic query — read data:**
```ts
const isPlayingQuery = `{
  live_set {
    is_playing
  }
}`
```

**Nested query — traverse the object graph:**
```ts
const trackClipsQuery = `{
  live_set {
    tracks {
      name
      clip_slots {
        has_clip
        clip {
          name
          looping
          notes {
            pitch
            start_time
            duration
            velocity
          }
        }
      }
    }
  }
}`
```

**Parameterized query — field arguments:**
```ts
const specificTrackQuery = `{
  live_set {
    track(index: 0) {
      name
      has_midi_input
    }
  }
}`
```

**Mutation — write data:**
```ts
const startPlayingMutation = `mutation {
  song_start_playing(id: 1) {
    is_playing
  }
}`
```

**Mutation with variables:**
```ts
// Define the operation with variable placeholders
const renameTrack = `mutation RenameTrack($id: Int!, $name: String!) {
  track_set_name(id: $id, name: $name) {
    id
    name
  }
}`

// Variables passed separately
const variables = { id: 5, name: "Synth Lead" }
```

For liveql, most mutations can be written without variables since arguments are hardcoded in the query string. Variables are useful when the values come from user input.

---

## Full Integration: Effect Schema + TanStack Query

### The execute helper

```ts
import { Effect, Schema, Exit } from "effect"
import { HttpClient, HttpClientResponse, FetchHttpClient, HttpBody } from "effect/unstable/http"

const ENDPOINT = "http://localhost:4000/graphql"

interface GraphQLResponse<T> {
  data: T
  errors?: Array<{ message: string }>
}

function buildResponseSchema<T extends Schema.Schema.Any>(dataSchema: T) {
  return Schema.Struct({
    data: dataSchema,
    errors: Schema.optionalKey(Schema.Array(Schema.Struct({
      message: Schema.String,
    }))),
  })
}

// Core: execute a query string, validate with Effect Schema, return typed data
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

    const responseSchema = buildResponseSchema(dataSchema)
    const validated = yield* response.pipe(
      HttpClientResponse.schemaBodyJson(responseSchema)
    )

    if (validated.errors?.length) {
      yield* Effect.fail(new Error(validated.errors.map(e => e.message).join("; ")))
    }

    return validated.data
  })
}

// Bridge to Promise for TanStack Query
function gql<T>(
  query: string,
  dataSchema: Schema.Codec<T, unknown>,
  variables?: Record<string, unknown>,
): Promise<T> {
  return Effect.runPromise(
    gqlEffect(query, variables, dataSchema).pipe(
      Effect.provide(FetchHttpClient.layer)
    )
  )
}
```

### Define schemas for the types you query

```ts
import { Schema } from "effect"

const Note = Schema.Struct({
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

const Clip = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  looping: Schema.Boolean,
  length: Schema.Number,
  is_midi_clip: Schema.Boolean,
  notes: Schema.NullOr(Schema.Array(Note)),
})

const ClipSlot = Schema.Struct({
  has_clip: Schema.Boolean,
  clip: Schema.NullOr(Clip),
})

const Track = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  has_midi_input: Schema.Boolean,
  clip_slots: Schema.Array(ClipSlot),
})

const Song = Schema.Struct({
  is_playing: Schema.Boolean,
  tracks: Schema.Array(Track),
})
```

### Wire into TanStack Query

```ts
import { queryOptions, useQuery } from "@tanstack/react-query"

// Reusable query options
const songQueryOptions = queryOptions({
  queryKey: ['live_set'] as const,
  queryFn: () => gql(
    `{
      live_set {
        is_playing
        tracks {
          id
          name
          has_midi_input
          clip_slots {
            has_clip
            clip {
              id
              name
              looping
              length
              is_midi_clip
            }
          }
        }
      }
    }`,
    Song
  ),
})

function SongView() {
  const { data } = useQuery(songQueryOptions)
  // data is typed as Schema.Schema.Type<typeof Song>
  // validated at runtime against the actual server response
  return <div>{data?.is_playing ? "Playing" : "Stopped"}</div>
}
```

### Mutations

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query"

function TrackNameEditor({ trackId }: { trackId: number }) {
  const queryClient = useQueryClient()

  const rename = useMutation({
    mutationFn: (name: string) => gql(
      `mutation {
        track_set_name(id: ${trackId}, name: "${name}") {
          id
          name
        }
      }`,
      Schema.Struct({ track_set_name: Schema.Struct({ id: Schema.Number, name: Schema.String }) })
    ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['live_set'] }),
  })

  return <input onBlur={(e) => rename.mutate(e.target.value)} />
}
```

---

## The Schema ↔ Query Relationship

You don't need a schema for every possible query. You define schemas for the **response shapes you actually use**. Different queries against the same GraphQL type can return different subsets of fields — each gets its own Effect Schema.

```ts
// Query 1: just names
const TracksNamesResponse = Schema.Struct({
  is_playing: Schema.Boolean,
  tracks: Schema.Array(Schema.Struct({
    name: Schema.String,
  })),
})

// Query 2: full detail
const TracksDetailResponse = Schema.Struct({
  is_playing: Schema.Boolean,
  tracks: Schema.Array(Schema.Struct({
    id: Schema.Number,
    name: Schema.String,
    has_midi_input: Schema.Boolean,
    clip_slots: Schema.Array(Schema.Struct({
      has_clip: Schema.Boolean,
      clip: Schema.NullOr(Clip),
    })),
  })),
})
```

This is intentional — GraphQL's whole point is you select only the fields you need. The Effect Schema should match the shape of what you asked for.

---

## What's NOT in this approach

- **No codegen** — no `@graphql-codegen/cli`, no generated files, no watch process
- **No gql.tada** — no template literal type parsing
- **No graphql-request / Graffle** — Effect's HttpClient handles HTTP
- **No Apollo / urql** — TanStack Query handles caching
- **No query builder** — plain strings, the schema is small enough

---

## Open Questions

1. **Schema generation:** Do we want to hand-write the Effect Schemas, or use an LLM to generate them from the liveql SDL? Hand-writing is ~10 types, very manageable.

We would want the llm to generate. but that's just the developer prompting.

2. **Shared schemas vs per-query schemas:** Do we define one `Track` schema and use it everywhere, or one per query? (See "Schema ↔ Query Relationship" above — per-query is more accurate but more verbose.)

I think we want to have schemas for each object type containing all the scalar fields. For instance, Song would have id, path, is_playing, but not view, track, or tracks.

We might build on that with SongWithTracks that includes nested tracks, but not right away.

As a general pattern, the queries themselves should always get all the scalar fields. We are fussed about optimization at this point.

3. **Variables:** Most liveql queries use hardcoded arguments. Do we need variable support now, or can we add it later?

I think we can wait.

4. **Error handling:** How should we handle GraphQL partial responses (`data` + `errors` simultaneously)?

I need more research on this since I don't understand what you mean. Provide examples, maybe mermaid diagram. make recommendation.

5. **Effect Layer for HttpClient:** Should we create a custom Layer that adds auth headers / base URL, or just use `FetchHttpClient.layer` directly?

No auth is involved so keep it simple.

6. **Schema drift:** When the server schema changes, how do we know our Effect Schemas are out of date? (Runtime validation catches this — but silently, unless we log.)

Runtime validation will error. That's all we have with regard to drift.

7. **Introspection in dev:** Should we auto-introspect the schema on startup and diff against our Effect Schemas?

No

---

## References

- [liveql repo](https://github.com/mw10013/liveql) — the GraphQL Yoga server
- [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http/draft/) — how queries are sent/received
- [GraphQL introspection](https://graphql.org/learn/introspection/) — how to query the schema itself
- Effect v4 refs: `refs/effect4/packages/effect/src/Schema.ts`, `refs/effect4/packages/effect/src/unstable/http/`
- TanStack Query refs: `refs/tan-query/packages/react-query/src/queryOptions.ts`
