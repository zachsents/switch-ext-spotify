// The player as it stands: what's playing, where, how far in, shuffle and repeat; and the same as
// the widget draws it.
import { Effect } from "effect"

import { Spotify } from "./api.ts"
import { device, item, list, rec, str } from "./shape.ts"

/** The art's smallest picture still sharp at 48 px on a 2x screen, else its largest. */
const SHARP = 96

/** The player as Spotify has it, as of when it was read; null when nothing is playing anywhere (204). */
const reading = Effect.gen(function* read() {
  const spotify = yield* Spotify
  const raw = yield* spotify.call("GET", "/me/player", {
    query: { additional_types: "track,episode" },
  })
  return raw === null ? null : { p: rec(raw), asOf: Date.now() }
})

export const playback = reading.pipe(
  Effect.map((read) => {
    if (read === null) {
      return { playing: false, item: null, device: null, context: null }
    }
    const { p } = read
    return {
      playing: p.is_playing === true,
      item: item(p.item),
      device: device(p.device),
      progress_ms: typeof p.progress_ms === "number" ? p.progress_ms : null,
      shuffle: p.shuffle_state === true,
      repeat: str(p.repeat_state),
      context: str(rec(p.context).uri) || null,
    }
  }),
)

export type Playback = Effect.Success<typeof playback>

/** A track's album art, or an episode's (else its show's). */
export const artOf = (raw: unknown) => {
  const t = rec(raw)
  const own = list(rec(t.album).images).length > 0 ? rec(t.album).images : t.images
  const pictures = list(own).length > 0 ? list(own) : list(rec(t.show).images)
  const sized = pictures
    .map((x) => ({ url: str(rec(x).url), width: Number(rec(x).width) || 0 }))
    .filter((x) => x.url !== "")
    .toSorted((a, b) => a.width - b.width)
  return (sized.find((x) => x.width >= SHARP) ?? sized.at(-1))?.url ?? ""
}

/** What the widget draws: what's playing, or nothing when nothing is. */
export const nowPlaying = reading.pipe(
  Effect.map((read) => {
    const playing = read === null ? null : item(read.p.item)
    if (read === null || playing === null) {
      return { now: [] }
    }
    const { p } = read
    return {
      now: [
        {
          title: playing.name,
          by: playing.type === "track" ? playing.artists.join(", ") : (playing.show ?? ""),
          art: artOf(p.item),
          playing: p.is_playing === true,
          at: typeof p.progress_ms === "number" ? p.progress_ms : 0,
          length: playing.duration_ms,
          asOf: read.asOf,
        },
      ],
    }
  }),
)
