# dsh-pet

A DeepSeek Harness plugin that shows a floating [Petdex](https://petdex.dev) pixel pet on the desktop and maps DSH session activity to its animation states.

## Features

- Native, borderless, always-on-top pet window (Win32 / AppKit); no WebView, no Node sidecar.
- Settings → **Desk pet** section: browse the Petdex catalog, download, switch and remove pets.
- Host↔Client communication rides DSH's official Typert Remote gateway (`remote.pet`) — no loopback HTTP server.
- Reacts to session events (running / waiting / completed / failed) via content-free state projection.
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

In DSH, open **Plugins → Add plugin** and select the `packages/dsh-pet` directory, or call `plugin_manager install_bundle` with that absolute path. Then open **Settings → Desk pet**.

A release bundle must include the compiled `native/` directory (see `files` in `packages/dsh-pet/package.json`).

## Status mapping

| DSH event | Petdex state |
| --- | --- |
| turn start | `jumping` |
| LLM stream / tool result | `running` |
| approval request | `waiting` |
| turn end / assistant message | `waving` |
| turn error / failed | `failed` |
| review | `review` |
| idle | `idle` |

## Privacy

Only animation state names are sent to the pet process. No prompts, tool arguments, model output, or approval contents leave the Harness.

## License

MIT. Pet artwork belongs to its Petdex submitters and is fetched from the public Petdex catalog at runtime.
