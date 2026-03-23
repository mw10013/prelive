import { queryOptions, useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Schema } from "effect"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import * as Domain from "@/lib/Domain"
import { gql } from "@/lib/gql"

const songStatusOptions = queryOptions({
  queryKey: ["live_set", "status"],
  queryFn: () =>
    gql(
      `{ live_set { id is_playing } }`,
      Schema.Struct({
        live_set: Schema.Struct({
          id: Schema.Number,
          is_playing: Schema.Boolean,
        }),
      }),
    ),
})

const trackListOptions = queryOptions({
  queryKey: ["live_set", "tracks"],
  queryFn: () =>
    gql(
      `{ live_set { tracks { id name has_midi_input } } }`,
      Schema.Struct({
        live_set: Schema.Struct({
          tracks: Schema.Array(
            Schema.Struct({
              id: Schema.Number,
              name: Schema.String,
              has_midi_input: Schema.Boolean,
            }),
          ),
        }),
      }),
    ),
})

const overviewOptions = queryOptions({
  queryKey: ["live_set", "overview"],
  queryFn: () =>
    gql(
      `{ live_set {
        id path is_playing
        tracks {
          id path name has_midi_input
          clip_slots {
            id path has_clip
            clip { id path name looping length is_midi_clip end_time
                   is_arrangement_clip signature_denominator signature_numerator start_time }
          }
        }
      } }`,
      Schema.Struct({ live_set: Domain.SongOverview }),
    ),
})

export const Route = createFileRoute("/")({
  component: RouteComponent,
})

function QueryCard({
  title,
  description,
  query,
}: {
  title: string
  description: string
  query: ReturnType<typeof useQuery>
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {query.isError && (
          <p className="text-sm text-destructive">
            {query.error instanceof Error ? query.error.message : "Unknown error"}
          </p>
        )}
        {query.isSuccess && (
          <pre className="overflow-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(query.data, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

function RouteComponent() {
  const songStatus = useQuery(songStatusOptions)
  const trackList = useQuery(trackListOptions)
  const overview = useQuery(overviewOptions)

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">prelive</h1>
      <QueryCard
        title="Song Status"
        description="{ live_set { id is_playing } }"
        query={songStatus}
      />
      <QueryCard
        title="Track List"
        description="{ live_set { tracks { id name has_midi_input } } }"
        query={trackList}
      />
      <QueryCard
        title="Full Overview"
        description="live_set → tracks → clip_slots → clip"
        query={overview}
      />
    </div>
  )
}
