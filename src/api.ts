// The Spotify Web API as the user's connected account. The account and its access tokens come from
// Switch's connections through the host (`connections/list`, `connections/token`); this keeps none.
import { Context, Deferred, Effect, Layer, Queue } from "effect"
import { Peer } from "switch-ext-kit"
import type { PeerService, Send } from "switch-ext-kit"

import { SpotifyError } from "./error.ts"
import { list, rec, str } from "./shape.ts"

const API = "https://api.spotify.com/v1"
const PROVIDER = "spotify"

export type Query = Readonly<Record<string, string | number | boolean | undefined>>

export interface SpotifyShape {
  /** One Web API call: its JSON, or null when Spotify sends nothing back (204, an empty body). */
  readonly call: (
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options?: { readonly query?: Query; readonly body?: unknown },
  ) => Effect.Effect<unknown, SpotifyError>
  /** Waits until a call changes the player (play, pause, skip, seek, a device). */
  readonly changed: Effect.Effect<void>
}

export class Spotify extends Context.Service<Spotify, SpotifyShape>()("spotify/Spotify") {}

/** Spotify's error body: `{ error: { status, message, reason? } }` from the API, `{ error, error_description }` from accounts. */
const errorOf = (status: number, body: unknown) => {
  const e = rec(body).error
  const inner = rec(e)
  const message =
    str(inner.message) || str(rec(body).error_description) || str(e) || `Spotify said ${status}`
  return str(inner.reason) === "" ? message : `${message} (${str(inner.reason)})`
}

const parse = (text: string): unknown => {
  if (text.trim() === "") {
    return null
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const unreached = (e: unknown) =>
  e instanceof SpotifyError
    ? e
    : new SpotifyError({ status: 0, message: e instanceof Error ? e.message : String(e) })

const make = Effect.gen(function* making() {
  const ready = yield* Deferred.make<Send | null>()
  const changes = yield* Queue.sliding<true>(1)
  let held: { readonly token: string; readonly expires: number } | null = null

  const ask = (method: string, params: Readonly<Record<string, unknown>>) =>
    Effect.gen(function* asking() {
      const send = yield* Deferred.await(ready)
      if (send === null) {
        return yield* Effect.fail(new SpotifyError({ status: 0, message: "No host" }))
      }
      return rec(
        yield* Effect.tryPromise({ try: async () => await send(method, params), catch: unreached }),
      )
    })

  /** A fresh access token for the connected account, kept until a minute before it expires. */
  const token = Effect.gen(function* tokening() {
    if (held !== null && held.expires > Date.now() + 60_000) {
      return held.token
    }
    const listed = yield* ask("connections/list", { provider: PROVIDER })
    const [first] = list(listed.accounts)
    const account = str(rec(first).account)
    if (account === "") {
      return yield* Effect.fail(
        new SpotifyError({ status: 401, message: "Spotify isn't connected" }),
      )
    }
    const t = yield* ask("connections/token", { provider: PROVIDER, account })
    if (str(t.token) === "") {
      return yield* Effect.fail(
        new SpotifyError({ status: 401, message: "Spotify isn't connected" }),
      )
    }
    held = { token: str(t.token), expires: typeof t.expires === "number" ? t.expires : 0 }
    return held.token
  })

  const request: SpotifyShape["call"] = (method, path, options = {}) =>
    token.pipe(
      Effect.flatMap((bearer) =>
        Effect.tryPromise({
          try: async () => {
            const url = new URL(`${API}${path}`)
            for (const [k, v] of Object.entries(options.query ?? {})) {
              if (v !== undefined) {
                url.searchParams.set(k, String(v))
              }
            }
            const res = await fetch(url, {
              method,
              headers: {
                Authorization: `Bearer ${bearer}`,
                ...(options.body !== undefined && { "Content-Type": "application/json" }),
              },
              ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
            })
            const body = parse(await res.text())
            if (!res.ok) {
              if (res.status === 401) {
                held = null
              }
              const wait = Number(res.headers.get("retry-after"))
              throw new SpotifyError({
                status: res.status,
                message: errorOf(res.status, body),
                ...(wait > 0 && { retryAfter: wait }),
              })
            }
            return body
          },
          catch: unreached,
        }),
      ),
    )

  const call: SpotifyShape["call"] = (method, path, options) =>
    method !== "GET" && path.startsWith("/me/player")
      ? Effect.tap(request(method, path, options), () => Queue.offer(changes, true))
      : request(method, path, options)

  const peer = {
    attach: (send: Send | null) => {
      Deferred.doneUnsafe(ready, Effect.succeed(send))
    },
  }
  return { spotify: { call, changed: Effect.asVoid(Queue.take(changes)) }, peer }
})

/** Spotify, and the `Peer` that `serve` hands the host's connection to. */
export const spotifyLayer: Layer.Layer<Spotify | PeerService> = Layer.effectContext(
  make.pipe(
    Effect.map(({ spotify, peer }) => Context.make(Spotify, spotify).pipe(Context.add(Peer, peer))),
  ),
)
