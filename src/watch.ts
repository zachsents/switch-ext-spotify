// Playback events from polling the player, since the Web API pushes nothing: every 5 seconds while
// something plays, every minute otherwise (paused, nothing playing, not connected), and as long as
// Spotify asks after a 429. A call that changes the player (from the agent or the widget) has it
// read again half a second and two seconds later, once Spotify has caught up. The first reading
// only sets where things stand.
import { Effect, Layer } from "effect"
import { AppEvents } from "switch-ext-kit"

import { Spotify } from "./api.ts"
import { DeviceChanged, Paused, Playing, Seeked, Started } from "./events.ts"
import { playback } from "./player.ts"
import type { Playback } from "./player.ts"

const PLAYING_MS = 5000
const IDLE_MS = 60_000
/** After a change: when to read again, then again. */
const SOON_MS = [500, 1500]
/** How far off where it should be is a jump, not drift. */
const JUMP_MS = 3000

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
      for (;;) {
        const read = yield* Effect.result(playback)
        if (read._tag === "Failure") {
          const asked = read.failure.retryAfter
          yield* Effect.sleep(asked === undefined ? IDLE_MS : asked * 1000)
          continue
        }
        const now = read.success
        const at = Date.now()
        for (const draft of last === null ? [] : changes(last, now, at - lastAt)) {
          yield* emit(draft)
        }
        last = now
        lastAt = at
        const [next, ...rest] = soon
        soon = rest
        const wait = Effect.sleep(next ?? (now.playing ? PLAYING_MS : IDLE_MS))
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
