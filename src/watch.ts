// Playback events from polling the player, since the Web API pushes nothing: every 5 seconds while
// something plays, every minute otherwise (paused, nothing playing, not connected), and as long as
// Spotify asks after a 429. The first reading only sets where things stand.
import { Effect, Layer } from "effect"
import { AppEvents } from "switch-ext-kit"

import { DeviceChanged, Paused, Playing, Started } from "./events.ts"
import { playback } from "./player.ts"
import type { Playback } from "./player.ts"

const PLAYING_MS = 5000
const IDLE_MS = 60_000

export const watching = Layer.effectDiscard(
  Effect.forkScoped(
    Effect.gen(function* polling() {
      const events = yield* AppEvents
      const emit = (draft: Parameters<typeof events.emit>[0]) =>
        Effect.ignore(events.emit(draft), { log: "Warn" })
      let last: Playback | null = null
      for (;;) {
        const read = yield* Effect.result(playback)
        if (read._tag === "Failure") {
          const asked = read.failure.retryAfter
          yield* Effect.sleep(asked === undefined ? IDLE_MS : asked * 1000)
          continue
        }
        const now = read.success
        if (last !== null) {
          if (now.item !== null && now.item.uri !== last.item?.uri) {
            yield* emit(Playing.make({ item: now.item, device: now.device, context: now.context }))
          }
          if (now.playing && !last.playing) {
            yield* emit(Started.make({ item: now.item, device: now.device }))
          }
          if (!now.playing && last.playing) {
            yield* emit(Paused.make({ item: last.item, device: last.device }))
          }
          if (now.device !== null && now.device.id !== last.device?.id) {
            yield* emit(DeviceChanged.make({ device: now.device, from: last.device }))
          }
        }
        last = now
        yield* Effect.sleep(now.playing ? PLAYING_MS : IDLE_MS)
      }
    }),
  ),
)
