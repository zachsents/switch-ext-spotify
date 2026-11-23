# switch-ext-spotify

Spotify on every device the user has: playback (play, pause, skip, seek, volume, shuffle, repeat, transfer, the queue), search, their playlists (read, make, edit, add, remove, reorder, replace), their library (saved and followed) and history (recent, top). Events when what's playing changes, when playback starts or pauses, and when it moves to another device; Spotify pushes nothing, so the player is polled every 5 seconds while something plays and every minute otherwise.

A [Switch](https://switch.ax) extension, built on
[switch-ext-kit](https://github.com/zachsents/switch-ext-kit), through the Spotify Web API. Playback control needs Spotify Premium.

## Install

Ask Switch's agent to install `github:zachsents/switch-ext-spotify`, or add it in the desktop's
Extensions view (⌘K, Extensions).

## Setup

1. Make an app at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard): any name,
   Redirect URI `http://127.0.0.1/oauth/callback`, API: Web API.
2. Give Switch its Client ID (`connections_client`, provider `spotify`). PKCE: there's no secret.
3. Connect Spotify in Switch (Connections).

## Develop

```sh
bun install
bun run check
bun start   # serves MCP on stdio
```
