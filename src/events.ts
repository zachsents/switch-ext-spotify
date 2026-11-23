// What Spotify tells the brain, so watches can fire on playback. Spotify pushes nothing to the Web
// API, so the player is polled (watch.ts).
import { Schema } from "effect"
import { defineEvent } from "switch-ext-kit"

import { Device, Item } from "./shape.ts"

/** Something else is playing: a new track or episode. */
export const Playing = defineEvent(
  "spotify.playing",
  1,
  Schema.Struct({
    item: Item,
    device: Schema.NullOr(Device),
    context: Schema.NullOr(Schema.String),
  }),
)

/** Playback started or resumed. */
export const Started = defineEvent(
  "spotify.started",
  1,
  Schema.Struct({ item: Schema.NullOr(Item), device: Schema.NullOr(Device) }),
)

/** Playback paused or stopped. */
export const Paused = defineEvent(
  "spotify.paused",
  1,
  Schema.Struct({ item: Schema.NullOr(Item), device: Schema.NullOr(Device) }),
)

/** Playback moved to another device. */
export const DeviceChanged = defineEvent(
  "spotify.device",
  1,
  Schema.Struct({ device: Device, from: Schema.NullOr(Device) }),
)

/** It jumped within the same track or episode: a seek, or back to its start. */
export const Seeked = defineEvent(
  "spotify.seeked",
  1,
  Schema.Struct({ item: Item, progress_ms: Schema.Finite }),
)

export const spotifyEvents = [Playing, Started, Paused, DeviceChanged, Seeked]
