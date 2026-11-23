// Playback events from polling the player, since the Web API pushes nothing: every 5 seconds while
// something plays, every 10 otherwise (paused, nothing playing), every minute while it can't read
// it (not connected, offline), and as long as Spotify asks after a 429. A call that changes the player (from the agent or the widget) has it
// read again half a second and two seconds later, once Spotify has caught up. The first reading
// only sets where things stand. A heartbeat every 5 minutes from this loop, and at once when what's
// failing changes.
import { Cause, Effect, Exit, Layer } from "effect"
import { AppEvents } from "switch-ext-kit"

import { Spotify } from "./api.ts"
import { SpotifyError } from "./error.ts"
import { DeviceChanged, Heartbeat, Paused, Playing, Seeked, Started } from "./events.ts"
import { playback } from "./player.ts"
import type { Playback } from "./player.ts"

const PLAYING_MS = 5000
/** Paused or nothing playing: soon enough that playing from another app shows within seconds. */
const IDLE_MS = 10_000
const FAILED_MS = 60_000
/** How long until the next reading, as things stand. */
export const untilNext = (playing: boolean) => (playing ? PLAYING_MS : IDLE_MS)
/** After a change: when to read again, then again. */
const SOON_MS = [500, 1500]
/** How far off where it should be is a jump, not drift. */
const JUMP_MS = 3000
const BEAT_MS = 5 * 60_000

/** What's wrong with reading the player, in one line. */
const problemOf = (e: unknown) => {
  if (!(e instanceof SpotifyError)) {
    return `Can't read the player: ${e instanceof Error ? e.message : String(e)}`
  }
  if (e.status === 401 || e.status === 0) {
    return `Can't read the player: ${e.message}`
  }
  return `Can't read the player: ${e.message} (${e.status})`
}

/** Where it should be now, had it played on since `last` was read `ms` ago. */
export const jumped = (last: Playback, now: Playback, ms: number) => {
  if (
    now.item === null ||
    now.item.uri !== last.item?.uri ||
    typeof now.progress_ms !== "number" ||
    typeof last.progress_ms !== "number"
  ) {
    return false
  }
  const expected = last.progress_ms + (last.playing ? ms : 0)
  return Math.abs(now.progress_ms - expected) > JUMP_MS
}

/** What changed between two readings `ms` apart, as events. */
export const changes = (last: Playback, now: Playback, ms: number) => [
  ...(now.item !== null && now.item.uri !== last.item?.uri
    ? [Playing.make({ item: now.item, device: now.device, context: now.context })]
    : []),
  ...(now.playing && !last.playing ? [Started.make({ item: now.item, device: now.device })] : []),
  ...(!now.playing && last.playing ? [Paused.make({ item: last.item, device: last.device })] : []),
  ...(now.device !== null && now.device.id !== last.device?.id
    ? [DeviceChanged.make({ device: now.device, from: last.device })]
    : []),
  ...(now.item !== null && now.progress_ms !== null && jumped(last, now, ms)
    ? [Seeked.make({ item: now.item, progress_ms: now.progress_ms })]
    : []),
]

export const watching = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.gen(function* polling() {
      const events = yield* AppEvents
      const spotify = yield* Spotify
      const emit = (draft: Parameters<typeof events.emit>[0]) =>
        Effect.ignore(events.emit(draft), { log: "Warn" })
      let last: Playback | null = null
      let lastAt = 0
      let soon: number[] = []
      let failing: string | null = null
      let beatAt = 0
      /** A heartbeat when what's failing changed or the last is 5 minutes old. */
      const beat = (now: string | null) =>
        Effect.gen(function* beating() {
          const at = Date.now()
          if (now === failing && at - beatAt < BEAT_MS) {
            return
          }
          failing = now
          beatAt = at
          const playing = last?.playing === true
          yield* emit(
            Heartbeat.make({
              entity: "sense:spotify",
              summary: now ?? (playing ? "Playing" : "Not playing"),
              facts: { failing: now, playing, device: last?.device?.name ?? null },
            }),
          )
        })
      for (;;) {
        const read = yield* Effect.exit(playback)
        if (Exit.isFailure(read)) {
          const error = Cause.squash(read.cause)
          yield* beat(problemOf(error))
          const asked = error instanceof SpotifyError ? error.retryAfter : undefined
          // A long wait Spotify asks for still beats every 5 minutes.
          let left = asked === undefined ? FAILED_MS : asked * 1000
          while (left > 0) {
            const step = Math.min(left, BEAT_MS)
            yield* Effect.sleep(step)
            left -= step
            yield* beat(failing)
          }
          continue
        }
        const now = read.value
        const at = Date.now()
        for (const draft of last === null ? [] : changes(last, now, at - lastAt)) {
          yield* emit(draft)
        }
        last = now
        lastAt = at
        yield* beat(null)
        const [next, ...rest] = soon
        soon = rest
        const wait = Effect.sleep(next ?? untilNext(now.playing))
        const changed = yield* Effect.raceFirst(
          Effect.as(wait, false),
          Effect.as(spotify.changed, true),
        )
        if (changed) {
          const [first = 0, ...after] = SOON_MS
          soon = after
          yield* Effect.sleep(first)
        }
      }
    }),
  ),
)
