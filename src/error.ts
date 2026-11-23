// What Spotify said went wrong.
import { Data } from "effect"

/** What Spotify said went wrong, as it said it; status 0 when it wasn't reached. */
export class SpotifyError extends Data.TaggedError("SpotifyError")<{
  readonly status: number
  readonly message: string
  /** Seconds Spotify asked to wait, on a 429. */
  readonly retryAfter?: number
}> {}
