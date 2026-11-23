// The player as it stands: what's playing, where, how far in, shuffle and repeat.
import { Effect } from "effect"

import { Spotify } from "./api.ts"
import { device, item, rec, str } from "./shape.ts"

export const playback = Effect.gen(function* reading() {
  const spotify = yield* Spotify
  const raw = yield* spotify.call("GET", "/me/player", {
    query: { additional_types: "track,episode" },
  })
  // 204: nothing is playing anywhere.
  if (raw === null) {
    return { playing: false, item: null, device: null, context: null }
  }
  const p = rec(raw)
  return {
    playing: p.is_playing === true,
    item: item(p.item),
    device: device(p.device),
    progress_ms: typeof p.progress_ms === "number" ? p.progress_ms : null,
    shuffle: p.shuffle_state === true,
    repeat: str(p.repeat_state),
    context: str(rec(p.context).uri) || null,
  }
})

export type Playback = Effect.Success<typeof playback>
