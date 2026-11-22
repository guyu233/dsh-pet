# dsh-pet

A DeepSeek Harness plugin that shows a floating [Petdex](https://petdex.dev) pixel pet on the desktop and maps DSH session activity to its animation states.

## Features

- Native, borderless, always-on-top pet window (Win32 / AppKit); no WebView, no Node sidecar.
- Settings → **Desk pet** section: browse the Petdex catalog, download, switch and remove pets.
- **Quick message bar**: pick a session, send a message (Enter), or stop the current turn — via the official `sessionController.prompt/cancel`.
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

## License

MIT. Pet artwork belongs to its Petdex submitters and is fetched from the public Petdex catalog at runtime.
