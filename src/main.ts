// Spotify as a stdio MCP server: its tools, and playback events from watching the player.
import { Layer } from "effect"
import { serveStdio } from "switch-ext-kit"

import { spotifyLayer } from "./api.ts"
import { spotifyApp } from "./app.ts"
import { watching } from "./watch.ts"

await serveStdio(spotifyApp, Layer.provideMerge(watching, spotifyLayer))
