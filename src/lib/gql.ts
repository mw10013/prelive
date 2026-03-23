import { Schema } from "effect"

const ENDPOINT = "http://localhost:4000/graphql"

interface GqlResponse {
  data?: unknown
  errors?: { message: string }[]
}

export async function gql<T>(
  query: string,
  dataSchema: Schema.Decoder<T>,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  })
  const json = (await response.json()) as GqlResponse
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "))
  }
  return Schema.decodeUnknownSync(dataSchema)(json.data)
}
