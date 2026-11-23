// Spotify's objects, cut to what an agent reads: names and URIs, not images, markets or hrefs.
import { Schema } from "effect"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
export const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})
export const str = (v: unknown): string => (typeof v === "string" ? v : "")
export const list = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])
const num = (v: unknown): number => (typeof v === "number" ? v : 0)
const names = (v: unknown) => list(v).map((a) => str(rec(a).name))

/** A track or an episode: what plays. */
export const Item = Schema.Struct({
  uri: Schema.String,
  type: Schema.Literals(["track", "episode"]),
  name: Schema.String,
  artists: Schema.Array(Schema.String),
  album: Schema.optionalKey(Schema.String),
  show: Schema.optionalKey(Schema.String),
  duration_ms: Schema.Finite,
})

export const Device = Schema.Struct({
  id: Schema.NullOr(Schema.String),
  name: Schema.String,
  type: Schema.String,
})

/** A track or episode; null for nothing (a playlist's removed track, an ad). */
export const item = (v: unknown): typeof Item.Type | null => {
  const t = rec(v)
  if (str(t.uri) === "") {
    return null
  }
  const base = { uri: str(t.uri), name: str(t.name), duration_ms: num(t.duration_ms) }
  return t.type === "episode"
    ? { ...base, type: "episode", artists: [], show: str(rec(t.show).name) }
    : { ...base, type: "track", artists: names(t.artists), album: str(rec(t.album).name) }
}

export const device = (v: unknown): typeof Device.Type | null => {
  const d = rec(v)
  return str(d.name) === ""
    ? null
    : { id: typeof d.id === "string" ? d.id : null, name: str(d.name), type: str(d.type) }
}

export const deviceOf = (v: unknown) => {
  const d = rec(v)
  return {
    ...device(d),
    active: d.is_active === true,
    volume: typeof d.volume_percent === "number" ? d.volume_percent : null,
  }
}

export const album = (v: unknown) => {
  const a = rec(v)
  return {
    uri: str(a.uri),
    name: str(a.name),
    artists: names(a.artists),
    release_date: str(a.release_date),
    tracks: num(a.total_tracks),
  }
}

export const artist = (v: unknown) => {
  const a = rec(v)
  return { uri: str(a.uri), name: str(a.name), genres: list(a.genres).map(str) }
}

export const playlist = (v: unknown) => {
  const p = rec(v)
  const owner = rec(p.owner)
  return {
    uri: str(p.uri),
    id: str(p.id),
    name: str(p.name),
    owner: str(owner.display_name) || str(owner.id),
    owner_id: str(owner.id),
    description: str(p.description),
    public: p.public === true,
    collaborative: p.collaborative === true,
    // Renamed from `tracks` in February 2026.
    items: num(rec(p.items ?? p.tracks).total),
    snapshot_id: str(p.snapshot_id),
  }
}

export const show = (v: unknown) => {
  const s = rec(v)
  return { uri: str(s.uri), name: str(s.name), episodes: num(s.total_episodes) }
}

/** A page's entries, nulls (unavailable items Spotify lists as null) left out. */
export const page = <A>(v: unknown, f: (x: unknown) => A | null) => {
  const p = rec(v)
  return {
    total: num(p.total),
    items: list(p.items).flatMap((x) => {
      const out = x === null ? null : f(x)
      return out === null ? [] : [out]
    }),
  }
}

/** A Spotify URI from a URI or an open.spotify.com link. */
export const uriOf = (s: string) => {
  const trimmed = s.trim()
  if (!trimmed.startsWith("https://open.spotify.com/")) {
    return trimmed
  }
  const parts = new URL(trimmed).pathname.split("/").filter((p) => p !== "")
  const at = parts.findIndex((p) =>
    ["track", "album", "artist", "playlist", "show", "episode", "user"].includes(p),
  )
  return at === -1 ? trimmed : `spotify:${parts[at]}:${parts[at + 1] ?? ""}`
}

/** A playlist's id from its id, URI or link. */
export const playlistId = (s: string) => {
  const uri = uriOf(s)
  return uri.startsWith("spotify:playlist:") ? uri.slice("spotify:playlist:".length) : uri
}
