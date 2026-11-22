# dsh-pet

A lightweight floating pixel companion for DeepSeek Harness, powered by the public [Petdex](https://petdex.dev) catalog.

## What it does

- Runs a borderless, always-on-top pet window outside the DSH page, started and stopped together with the plugin.
- Reacts to the active session: thinking and tool calls, waiting for approval, completion and failure.
- Downloads pets from the public Petdex manifest at runtime, and lets you choose or remove installed pets.
- Lives entirely in **Settings → Desk pet** — no extra sidebar panel.

## Privacy

Only normalized animation states are sent to the pet process. Prompts, tool arguments, model output and approval contents are never forwarded.

## Performance

The renderer is a small native binary (Win32 or AppKit) with no WebView or Node runtime. It decodes one spritesheet, draws one frame at a time with `background-position`-style blitting, and only wakes on state changes plus a low-frequency animation tick. When DSH exits, the plugin's lifecycle effect terminates the child process, so there is no leftover process.

## Requirements

A native binary must be present for your platform. Build it with `scripts/build-native.ps1`, or install a release that bundles it. Pet browsing requires network access to petdex.dev; installed pets are cached locally under `~/.dsh/pets/`.
