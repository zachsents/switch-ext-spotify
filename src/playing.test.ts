// The widget's data: what's playing, with its art sharp at 48 px; nothing when nothing is. And the
// watcher's jumps: a seek or a restart within the same track, never plain play or a new track.
import { expect, test } from "bun:test"
import { Effect } from "effect"

import { Spotify } from "./api.ts"
import { artOf, nowPlaying } from "./player.ts"
import { jumped, untilNext } from "./watch.ts"

const images = [
  { url: "big", width: 640 },
  { url: "mid", width: 300 },
  { url: "small", width: 64 },
]
const track = {
  uri: "spotify:track:1",
  type: "track",
  name: "Song",
  artists: [{ name: "A" }, { name: "B" }],
  album: { name: "Album", images },
  duration_ms: 200_000,
}

const read = async (player: unknown) => {
  const got = await Effect.runPromise(
    Effect.provideService(nowPlaying, Spotify, {
      call: () => Effect.succeed(player),
      changed: Effect.void,
    }),
  )
  return got
}

test("what's playing, as the widget draws it", async () => {
  const got = await read({ is_playing: true, progress_ms: 42_000, item: track })
  expect(got.now).toHaveLength(1)
  expect(got.now[0]).toMatchObject({
    title: "Song",
    by: "A, B",
    art: "mid",
    playing: true,
    at: 42_000,
    length: 200_000,
  })
})

test("nothing playing anywhere, or nothing to show, is nothing", async () => {
  const none = await read(null)
  const empty = await read({ is_playing: false, item: null })
  expect(none.now).toEqual([])
  expect(empty.now).toEqual([])
})

test("an episode's art falls back to its show's", () => {
  expect(artOf({ type: "episode", images: [], show: { images } })).toBe("mid")
  expect(artOf({ album: { images: [{ url: "only", width: 64 }] } })).toBe("only")
  expect(artOf({})).toBe("")
})

test("a jump is a seek within the same track", () => {
  const item = { uri: "u", type: "track" as const, name: "", artists: [], duration_ms: 1 }
  const at = (progress_ms: number, playing = true, uri = "u") => ({
    playing,
    item: { ...item, uri },
    device: null,
    progress_ms,
    shuffle: false,
    repeat: "off",
    context: null,
  })
  expect(jumped(at(10_000), at(15_000), 5000)).toBe(false)
  expect(jumped(at(100_000), at(1000), 5000)).toBe(true)
  expect(jumped(at(10_000, false), at(10_000, false), 60_000)).toBe(false)
  expect(jumped(at(100_000), at(1000, true, "v"), 5000)).toBe(false)
})

test("playing started elsewhere is read within seconds, not a minute", () => {
  expect(untilNext(false)).toBeLessThanOrEqual(10_000)
  expect(untilNext(true)).toBeLessThanOrEqual(5000)
})
