# dsh-pet

A DeepSeek Harness plugin that shows a floating [Petdex](https://petdex.dev) pixel pet on the desktop and maps DSH session activity to its animation states.

## Features

- Native, borderless, always-on-top pet window (Win32 / AppKit); no WebView, no Node sidecar.
- Settings → **Desk pet** section: browse the Petdex catalog with live fuzzy search (name, slug, author, kind), real per-pet preview thumbnails, download, switch and remove pets.
- **Quick message bar**: pick a session, send a message (Enter), or stop the current turn — via the official `sessionController.prompt/cancel`.
- Host↔Client communication rides DSH's official Typert Remote gateway (`remote.pet`) — no loopback HTTP server.
- Reacts to session events (running / waiting / completed / failed) via content-free state projection, with the **official Petdex animation timing table** (per-state frame counts and durations, including idle's irregular blink) ported from Petdex's `sprite.zig`.
- Catalog previews use Petdex's official `thumb.webp` (static) and `preview.webp` (6-frame strip, plays on hover); downloaded pets carry a Petdex-compatible `pet.json`.
- Tokenised fuzzy search (space-separated terms, AND-matched across name/slug/author/kind).
- Starts with the plugin and exits with DSH through Cordis lifecycle effects — no process residue.
- Runtime catalog fetch means the plugin package stays tiny.

## Layout

```text
packages/dsh-pet/            DSH bundle (Host + Client settings section)
native/win/dsh-pet.c         Win32 renderer (WIC WebP/PNG + layered window)
native/macos/dsh-pet.mm      AppKit renderer
scripts/build-native.ps1     Builds native binaries into the bundle
```

## Build native renderer

Windows (Visual Studio Developer PowerShell):

```powershell
& .\scripts\build-native.ps1 -Platform win32
```

macOS (on a Mac):

```powershell
pwsh ./scripts/build-native.ps1 -Platform macos -Arch arm64
```

The binaries land under `packages/dsh-pet/native/<platform>-<arch>/`.

## Install into DSH

The bundle is a standard DSH bundle package: `package.json` declares `dsh.bundle.patch` and the Host entry default-exports a Cordis Service; the Client half registers the Settings section. It follows the official bundle format (verified with `scripts/verify-bundle.mjs`, 53 checks).

Two supported install paths:

1. **Local directory (recommended)** — in DSH open **Plugins → Add plugin** and select the absolute path:
   ```
   d:\dsh-pet\packages\dsh-pet
   ```
   Or call `plugin_manager` with `action: install_bundle`, `target` set to that absolute directory. Local installs link the whole directory, so the compiled `native/win32-x64/dsh-pet.exe` is included.

2. **Tarball** — a distributable npm tarball is built at `dist/guyu233-dsh-pet-0.1.0.tgz` (`npm pack` from the bundle directory). DSH accepts `.tgz` / `.tar.gz` specs; `files` in `package.json` controls its contents and includes the native binary.

After installing, open **Settings → Desk pet**. The compiled Win32 binary ships in the package; macOS binaries can be added with `scripts/build-native.ps1 -Platform macos` on a Mac (see `files` in `package.json`).

### Format compliance

- `dsh.bundle.patch` → `cordis.patch.yml`, which inserts one plugin row.
- `exports`: `.` → Host, `./client` → Client, `./locale/*.json`, `./icon`.
- `engines.dsh: ^0.2.2-rc.5` satisfies the installed runtime `0.2.2-rc.5` (verified with semver `includePrerelease`).
- `dsh.bundle.platforms` intentionally omitted (omission allows all hosts; the Host warns gracefully if the native binary is missing).
- Display metadata (`meta.title`/`description`/`detail`) present in `en.json` and `zh.json`; original icon in `icon.svg`.

## Status mapping

Only events verified against the official core docs and the installed Harness are observed:

| DSH event (verified) | Petdex state |
| --- | --- |
| `agent/status` = running | `running` |
| `agent/status` = idle | `waving` (then settles to `idle`) |
| `tools/result` | `running` briefly, then back to the agent status |
| `approval/request` | `waiting` |
| `agent/error` | `failed` |
| no activity | `idle` |

## Privacy

Only animation state names are sent to the OS-level pet process. No prompts, tool arguments, model output, or approval contents leave the Harness for rendering. The quick-message bar sends your typed text into the selected DSH session through the official `sessionController.prompt` (it is a real message to the agent, not telemetry).

## Attribution and license

This is an independent, unofficial plugin. Parts of it (the animation timing table, atlas geometry, brand mark, manifest layout, and preview URL conventions) were adapted from [Petdex](https://github.com/crafter-station/petdex) under its MIT License (Copyright © 2026 Crafter Station). Pet artwork belongs to its respective submitters and is fetched at runtime, never redistributed.

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for the full attribution list, the original Petdex MIT notice, asset ownership, and the disclaimer. The project's own code is MIT (see [LICENSE](./LICENSE)).
