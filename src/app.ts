// Spotify's tools: playback on any of the user's devices, search, their playlists, library and
// history, through the Web API. Each fails with Spotify's own error (playback control needs Premium).
import { Effect, Schema } from "effect"
import { BASIC_CATALOG, defineApp, SWITCH_CATALOG, tool } from "switch-ext-kit"

import pkg from "../package.json"
import { Spotify } from "./api.ts"
import type { Query } from "./api.ts"
import { Paused, Playing, Seeked, spotifyEvents, Started } from "./events.ts"
import { nowPlaying, playback } from "./player.ts"
import {
  album,
  artist,
  deviceOf,
  item,
  list,
  page,
  playlist,
  playlistId,
  rec,
  show,
  str,
  uriOf,
} from "./shape.ts"

const call = (
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options?: { readonly query?: Query; readonly body?: unknown },
) =>
  Effect.gen(function* calling() {
    const spotify = yield* Spotify
    return yield* spotify.call(method, path, options)
  })

const chunks = <A>(xs: readonly A[], size: number) =>
  Array.from({ length: Math.ceil(xs.length / size) }, (_, i) => xs.slice(i * size, (i + 1) * size))

const device = Schema.optionalKey(Schema.String)
const onDevice = (d: string | undefined) => ({ device_id: d })
const paging = {
  limit: Schema.optionalKey(Schema.Int),
  offset: Schema.optionalKey(Schema.Int),
}
const uris = Schema.Array(Schema.String)
const snapshot = (r: unknown) => ({ snapshot_id: str(rec(r).snapshot_id) })

// Playback

const now = tool(
  "now",
  {
    description:
      "What's playing: the track or episode, the device, progress, shuffle, repeat and the context (album, playlist, artist).",
    readOnly: true,
  },
  () => playback,
)

// The widget's own: what it draws, and its play-or-pause key.

const playingNow = tool(
  "playing",
  { description: "What the widget draws.", readOnly: true, appOnly: true },
  () => nowPlaying,
)

const toggle = tool("toggle", { description: "Play or pause.", appOnly: true }, () =>
  Effect.gen(function* toggling() {
    const state = yield* playback
    yield* call("PUT", state.playing ? "/me/player/pause" : "/me/player/play")
    return { playing: !state.playing }
  }),
)

const devices = tool(
  "devices",
  { description: "The user's devices Spotify can play on.", readOnly: true },
  () =>
    Effect.map(call("GET", "/me/player/devices"), (r) => ({
      devices: list(rec(r).devices).map(deviceOf),
    })),
)

const play = tool(
  "play",
  {
    description:
      "Play or resume. uris: tracks or episodes to play; context: an album, playlist, artist or show URI (or link); offset: where in it to start, a position or an item's URI; position_ms: how far into the first; device: a device id, else the active one. Nothing given resumes.",
    input: Schema.Struct({
      uris: Schema.optionalKey(uris),
      context: Schema.optionalKey(Schema.String),
      offset: Schema.optionalKey(Schema.Union([Schema.Int, Schema.String])),
      position_ms: Schema.optionalKey(Schema.Int),
      device,
    }),
  },
  (input) => {
    const { offset } = input
    const body = {
      ...(input.uris !== undefined && { uris: input.uris.map(uriOf) }),
      ...(input.context !== undefined && { context_uri: uriOf(input.context) }),
      ...(offset !== undefined && {
        offset: typeof offset === "number" ? { position: offset } : { uri: uriOf(offset) },
      }),
      ...(input.position_ms !== undefined && { position_ms: input.position_ms }),
    }
    return Effect.as(call("PUT", "/me/player/play", { query: onDevice(input.device), body }), {
      playing: true,
    })
  },
)

const pause = tool("pause", { description: "Pause.", input: Schema.Struct({ device }) }, (input) =>
  Effect.as(call("PUT", "/me/player/pause", { query: onDevice(input.device) }), {
    playing: false,
  }),
)

const next = tool(
  "next",
  { description: "Skip to the next track.", input: Schema.Struct({ device }) },
  (input) =>
    Effect.as(call("POST", "/me/player/next", { query: onDevice(input.device) }), {
      skipped: true,
    }),
)

const previous = tool(
  "previous",
  { description: "Back to the previous track.", input: Schema.Struct({ device }) },
  (input) =>
    Effect.as(call("POST", "/me/player/previous", { query: onDevice(input.device) }), {
      back: true,
    }),
)

const seek = tool(
  "seek",
  {
    description: "Jump to a position in what's playing.",
    input: Schema.Struct({ position_ms: Schema.Int, device }),
  },
  (input) =>
    Effect.as(
      call("PUT", "/me/player/seek", {
        query: { position_ms: input.position_ms, ...onDevice(input.device) },
      }),
      { position_ms: input.position_ms },
    ),
)

const volume = tool(
  "volume",
  {
    description: "Set the volume, 0 to 100.",
    input: Schema.Struct({ percent: Schema.Int, device }),
  },
  (input) =>
    Effect.as(
      call("PUT", "/me/player/volume", {
        query: { volume_percent: input.percent, ...onDevice(input.device) },
      }),
      { volume: input.percent },
    ),
)

const shuffle = tool(
  "shuffle",
  { description: "Shuffle on or off.", input: Schema.Struct({ on: Schema.Boolean, device }) },
  (input) =>
    Effect.as(
      call("PUT", "/me/player/shuffle", { query: { state: input.on, ...onDevice(input.device) } }),
      { shuffle: input.on },
    ),
)

const repeat = tool(
  "repeat",
  {
    description: "Repeat the track, the context (album, playlist), or off.",
    input: Schema.Struct({ mode: Schema.Literals(["track", "context", "off"]), device }),
  },
  (input) =>
    Effect.as(
      call("PUT", "/me/player/repeat", { query: { state: input.mode, ...onDevice(input.device) } }),
      { repeat: input.mode },
    ),
)

const transfer = tool(
  "transfer",
  {
    description:
      "Move playback to a device (an id from devices). play: true starts it there, false keeps its state.",
    input: Schema.Struct({ device: Schema.String, play: Schema.optionalKey(Schema.Boolean) }),
  },
  (input) =>
    Effect.as(
      call("PUT", "/me/player", {
        body: {
          device_ids: [input.device],
          ...(input.play !== undefined && { play: input.play }),
        },
      }),
      { device: input.device },
    ),
)

const queue = tool(
  "queue",
  { description: "What's playing and what's queued after it.", readOnly: true },
  () =>
    Effect.map(call("GET", "/me/player/queue"), (r) => ({
      playing: item(rec(r).currently_playing),
      queue: list(rec(r).queue).flatMap((x) => item(x) ?? []),
    })),
)

const enqueue = tool(
  "enqueue",
  {
    description: "Add a track or episode (URI or link) to the end of the queue.",
    input: Schema.Struct({ uri: Schema.String, device }),
  },
  (input) =>
    Effect.as(
      call("POST", "/me/player/queue", {
        query: { uri: uriOf(input.uri), ...onDevice(input.device) },
      }),
      { queued: uriOf(input.uri) },
    ),
)

// Search

const kinds = ["track", "album", "artist", "playlist", "show", "episode"] as const

const search = tool(
  "search",
  {
    description:
      "Search Spotify's catalog. types: any of track, album, artist, playlist, show, episode. Spotify allows limit up to 10 per type; page with offset. query takes Spotify's filters (artist:, album:, year:, genre:).",
    readOnly: true,
    input: Schema.Struct({
      query: Schema.String,
      types: Schema.Array(Schema.Literals(kinds)),
      ...paging,
    }),
  },
  (input) =>
    Effect.map(
      call("GET", "/search", {
        query: {
          q: input.query,
          type: input.types.join(","),
          limit: input.limit,
          offset: input.offset,
        },
      }),
      (r) => {
        const found = rec(r)
        return {
          ...(found.tracks !== undefined && { tracks: page(found.tracks, item) }),
          ...(found.albums !== undefined && { albums: page(found.albums, album) }),
          ...(found.artists !== undefined && { artists: page(found.artists, artist) }),
          ...(found.playlists !== undefined && { playlists: page(found.playlists, playlist) }),
          ...(found.shows !== undefined && { shows: page(found.shows, show) }),
          ...(found.episodes !== undefined && { episodes: page(found.episodes, item) }),
        }
      },
    ),
)

// Playlists

const playlists = tool(
  "playlists",
  {
    description: "The user's playlists, their own and those they follow.",
    readOnly: true,
    input: Schema.Struct(paging),
  },
  (input) =>
    Effect.map(
      call("GET", "/me/playlists", { query: { limit: input.limit, offset: input.offset } }),
      (r) => page(r, playlist),
    ),
)

const playlistItems = (id: string, limit: number | undefined, offset: number | undefined) =>
  Effect.map(
    call("GET", `/playlists/${id}/items`, {
      query: { limit, offset, additional_types: "track,episode" },
    }),
    (r) =>
      page(r, (entry) => {
        const e = rec(entry)
        // `track` until February 2026's rename to `item`.
        const it = item(e.item ?? e.track)
        return it === null ? null : { ...it, added_at: str(e.added_at) }
      }),
  )

const playlistTool = tool(
  "playlist",
  {
    description:
      "A playlist's details and a page of its items (id, URI or link). Spotify gives items only for playlists the user owns or collaborates on; others' come back with items null.",
    readOnly: true,
    input: Schema.Struct({ playlist: Schema.String, ...paging }),
  },
  (input) =>
    Effect.gen(function* reading() {
      const id = playlistId(input.playlist)
      const [details, items] = yield* Effect.all(
        [
          call("GET", `/playlists/${id}`, {
            query: {
              fields:
                "id,uri,name,description,public,collaborative,owner(id,display_name),snapshot_id",
            },
          }),
          Effect.result(playlistItems(id, input.limit, input.offset)),
        ],
        { concurrency: 2 },
      )
      const p = playlist(details)
      if (items._tag === "Success") {
        return { ...p, items: items.success.total, entries: items.success.items }
      }
      if (items.failure.status === 403 || items.failure.status === 404) {
        return { ...p, items: null, entries: null }
      }
      return yield* Effect.fail(items.failure)
    }),
)

const createPlaylist = tool(
  "create_playlist",
  {
    description:
      "Make a playlist in the user's account. public defaults to Spotify's (true); a collaborative one must be private.",
    input: Schema.Struct({
      name: Schema.String,
      description: Schema.optionalKey(Schema.String),
      public: Schema.optionalKey(Schema.Boolean),
      collaborative: Schema.optionalKey(Schema.Boolean),
    }),
  },
  (input) => Effect.map(call("POST", "/me/playlists", { body: input }), playlist),
)

const editPlaylist = tool(
  "edit_playlist",
  {
    description: "Change a playlist's name, description, public or collaborative.",
    input: Schema.Struct({
      playlist: Schema.String,
      name: Schema.optionalKey(Schema.String),
      description: Schema.optionalKey(Schema.String),
      public: Schema.optionalKey(Schema.Boolean),
      collaborative: Schema.optionalKey(Schema.Boolean),
    }),
  },
  ({ playlist: given, ...details }) =>
    Effect.as(call("PUT", `/playlists/${playlistId(given)}`, { body: details }), {
      edited: playlistId(given),
    }),
)

/** Adds in Spotify's batches of 100, in order, from `position` (else at the end). */
const addItems = (id: string, items: readonly string[], position: number | undefined) =>
  Effect.reduce(
    chunks(items, 100),
    () => ({ snapshot_id: "", at: position }),
    (done, batch) =>
      Effect.map(
        call("POST", `/playlists/${id}/items`, {
          body: { uris: batch, ...(done.at !== undefined && { position: done.at }) },
        }),
        (r) => ({
          ...snapshot(r),
          at: done.at === undefined ? undefined : done.at + batch.length,
        }),
      ),
  )

const addToPlaylist = tool(
  "add_to_playlist",
  {
    description:
      "Add tracks or episodes (URIs or links) to a playlist, in order: at position (0 is the top), else at the end.",
    input: Schema.Struct({
      playlist: Schema.String,
      uris,
      position: Schema.optionalKey(Schema.Int),
    }),
  },
  (input) =>
    Effect.map(
      addItems(playlistId(input.playlist), input.uris.map(uriOf), input.position),
      (r) => ({ added: input.uris.length, snapshot_id: r.snapshot_id }),
    ),
)

const removeFromPlaylist = tool(
  "remove_from_playlist",
  {
    description:
      "Remove tracks or episodes (URIs or links) from a playlist. snapshot: the playlist version they were read from.",
    input: Schema.Struct({
      playlist: Schema.String,
      uris,
      snapshot: Schema.optionalKey(Schema.String),
    }),
  },
  (input) =>
    Effect.map(
      Effect.reduce(
        chunks(input.uris.map(uriOf), 100),
        () => ({ snapshot_id: "" }),
        (_, batch) =>
          Effect.map(
            call("DELETE", `/playlists/${playlistId(input.playlist)}/items`, {
              body: {
                items: batch.map((uri) => ({ uri })),
                ...(input.snapshot !== undefined && { snapshot_id: input.snapshot }),
              },
            }),
            snapshot,
          ),
      ),
      (r) => ({ removed: input.uris.length, snapshot_id: r.snapshot_id }),
    ),
)

const reorderPlaylist = tool(
  "reorder_playlist",
  {
    description:
      "Move count items (default 1) starting at position from to before position to, positions as they are now (0 is the top).",
    input: Schema.Struct({
      playlist: Schema.String,
      from: Schema.Int,
      to: Schema.Int,
      count: Schema.optionalKey(Schema.Int),
      snapshot: Schema.optionalKey(Schema.String),
    }),
  },
  (input) =>
    Effect.map(
      call("PUT", `/playlists/${playlistId(input.playlist)}/items`, {
        body: {
          range_start: input.from,
          insert_before: input.to,
          ...(input.count !== undefined && { range_length: input.count }),
          ...(input.snapshot !== undefined && { snapshot_id: input.snapshot }),
        },
      }),
      snapshot,
    ),
)

const replacePlaylist = tool(
  "replace_playlist",
  {
    description:
      "Replace every item in a playlist with these tracks or episodes (URIs or links), in order; none clears it.",
    input: Schema.Struct({ playlist: Schema.String, uris }),
  },
  (input) =>
    Effect.gen(function* replacing() {
      const id = playlistId(input.playlist)
      const all = input.uris.map(uriOf)
      const first = yield* call("PUT", `/playlists/${id}/items`, {
        body: { uris: all.slice(0, 100) },
      })
      const rest = all.slice(100)
      const last = rest.length === 0 ? snapshot(first) : yield* addItems(id, rest, undefined)
      return { items: all.length, snapshot_id: last.snapshot_id }
    }),
)

// Library

const LIBRARY = {
  tracks: { path: "/me/tracks", key: "track", shape: item },
  albums: { path: "/me/albums", key: "album", shape: album },
  shows: { path: "/me/shows", key: "show", shape: show },
  episodes: { path: "/me/episodes", key: "episode", shape: item },
} as const

const library = tool(
  "library",
  {
    description:
      "The user's saved tracks, albums, shows or episodes (newest first, page with offset), or the artists they follow (page with after, the last artist's id).",
    readOnly: true,
    input: Schema.Struct({
      kind: Schema.Literals(["tracks", "albums", "shows", "episodes", "artists"]),
      ...paging,
      after: Schema.optionalKey(Schema.String),
    }),
  },
  (input) =>
    Effect.gen(function* listing() {
      if (input.kind === "artists") {
        const r = yield* call("GET", "/me/following", {
          query: { type: "artist", limit: input.limit, after: input.after },
        })
        const artists = rec(rec(r).artists)
        return { ...page(artists, artist), after: str(rec(artists.cursors).after) || null }
      }
      const { path, key, shape } = LIBRARY[input.kind]
      const r = yield* call("GET", path, { query: { limit: input.limit, offset: input.offset } })
      return page(r, (entry) => {
        const e = rec(entry)
        const kept = shape(e[key])
        return kept === null ? null : { ...kept, added_at: str(e.added_at) }
      })
    }),
)

/** One library call per 40 URIs, Spotify's most. */
const inLibrary = (method: "PUT" | "DELETE" | "GET", path: string, given: readonly string[]) =>
  Effect.forEach(chunks(given.map(uriOf), 40), (batch) =>
    Effect.map(call(method, path, { query: { uris: batch.join(",") } }), (r) =>
      batch.map((uri, i) => [uri, list(r)[i] === true] as const),
    ),
  ).pipe(Effect.map((done) => done.flat()))

const save = tool(
  "save",
  {
    description:
      "Save to the user's library (URIs or links): tracks, albums, shows and episodes are saved; artists, users and playlists are followed.",
    input: Schema.Struct({ uris }),
  },
  (input) =>
    Effect.map(inLibrary("PUT", "/me/library", input.uris), (done) => ({
      saved: done.map(([uri]) => uri),
    })),
)

const unsave = tool(
  "unsave",
  {
    description:
      "Remove from the user's library (URIs or links): unsaves tracks, albums, shows and episodes; unfollows artists, users and playlists.",
    input: Schema.Struct({ uris }),
  },
  (input) =>
    Effect.map(inLibrary("DELETE", "/me/library", input.uris), (done) => ({
      removed: done.map(([uri]) => uri),
    })),
)

const saved = tool(
  "saved",
  {
    description:
      "Whether each URI (or link) is in the user's library: saved, or for artists, users and playlists, followed.",
    readOnly: true,
    input: Schema.Struct({ uris }),
  },
  (input) =>
    Effect.map(inLibrary("GET", "/me/library/contains", input.uris), (done) => ({
      saved: Object.fromEntries(done),
    })),
)

// History

const recent = tool(
  "recent",
  {
    description:
      "Tracks the user played recently, newest first, with when. Page back with before (a played_at time in ms).",
    readOnly: true,
    input: Schema.Struct({
      limit: Schema.optionalKey(Schema.Int),
      before: Schema.optionalKey(Schema.Int),
    }),
  },
  (input) =>
    Effect.map(
      call("GET", "/me/player/recently-played", {
        query: { limit: input.limit, before: input.before },
      }),
      (r) => ({
        items: list(rec(r).items).flatMap((raw) => {
          const e = rec(raw)
          const played = item(e.track)
          return played === null
            ? []
            : [{ ...played, played_at: str(e.played_at), context: str(rec(e.context).uri) || null }]
        }),
        before: str(rec(rec(r).cursors).before) || null,
      }),
    ),
)

const top = tool(
  "top",
  {
    description:
      "The user's top artists or tracks: over about 4 weeks (short_term), 6 months (medium_term, Spotify's default) or a year (long_term).",
    readOnly: true,
    input: Schema.Struct({
      kind: Schema.Literals(["artists", "tracks"]),
      range: Schema.optionalKey(Schema.Literals(["short_term", "medium_term", "long_term"])),
      ...paging,
    }),
  },
  (input) =>
    Effect.map(
      call("GET", `/me/top/${input.kind}`, {
        query: { time_range: input.range, limit: input.limit, offset: input.offset },
      }),
      (r) => (input.kind === "artists" ? page(r, artist) : page(r, item)),
    ),
)

export const spotifyApp = defineApp<Spotify>({
  name: "spotify",
  version: "1",
  instructions:
    "The user's Spotify: playback on any of their devices, search, playlists, library and history. URIs (spotify:track:…) or open.spotify.com links. Not connected: put the Client ID of the user's Spotify developer app in with connections_client, then connections_request spotify.",
  connections: pkg.extension.connections,
  tools: [
    now,
    playingNow,
    toggle,
    devices,
    play,
    pause,
    next,
    previous,
    seek,
    volume,
    shuffle,
    repeat,
    transfer,
    queue,
    enqueue,
    search,
    playlists,
    playlistTool,
    createPlaylist,
    editPlaylist,
    addToPlaylist,
    removeFromPlaylist,
    reorderPlaylist,
    replacePlaylist,
    library,
    save,
    unsave,
    saved,
    recent,
    top,
  ],
  events: spotifyEvents,
  widgets: [
    {
      name: "playing",
      title: "Playing",
      surfaces: ["space"],
      resource: "ui://spotify/playing",
      tool: "playing",
      refresh: [Playing.type, Started.type, Paused.type, Seeked.type],
      size: { aspect: "wide", empty: "hide" },
      // Nothing when nothing's playing: the list is empty, so the widget is out of its place.
      a2ui: () => [
        { version: "1.0", createSurface: { surfaceId: "playing", catalogId: SWITCH_CATALOG } },
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "playing",
            components: [
              {
                id: "root",
                component: "List",
                catalogId: BASIC_CATALOG,
                children: { componentId: "now", path: "/now" },
              },
              {
                id: "now",
                component: "Playing",
                title: { "@path": "title" },
                by: { "@path": "by" },
                art: { "@path": "art" },
                playing: { "@path": "playing" },
                at: { "@path": "at" },
                length: { "@path": "length" },
                asOf: { "@path": "asOf" },
                back: "previous",
                toggle: "toggle",
                next: "next",
              },
            ],
          },
        },
      ],
    },
  ],
})
