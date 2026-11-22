# Third-Party Notices / 第三方声明

This project (dsh-pet) is an independent, community-made DeepSeek Harness plugin. It is **not** an official product of Petdex or Crafter Station, and is not affiliated with or endorsed by them.

本项目 dsh-pet 是独立的社区 DeepSeek Harness 插件，**并非** Petdex / Crafter Station 的官方产品，与其无隶属或背书关系。

---

## 1. Code and data adapted from Petdex / 借鉴自 Petdex 的代码与数据

Source: <https://github.com/crafter-station/petdex> — licensed under the MIT License, Copyright (c) 2026 Crafter Station.

The following material was copied, adapted, or ported from that repository:

| What was adapted | Source path in petdex | Where it is used here |
| --- | --- | --- |
| Nine-state animation timing table (per-state frame counts, per-frame durations, idle blink timing) | `packages/petdex-desktop-native/src/sprite.zig` | `native/win/dsh-pet.c`, `native/macos/dsh-pet.mm` |
| Atlas geometry constants (192×208 frames, 8×9 grid, state row order) | `packages/petdex-desktop-native/src/sprite.zig`, README | native renderers |
| Brand mark (pixel-cat glyph) | `public/brand/petdex-mark.svg` | `packages/dsh-pet/icon.svg` and the in-settings home link |
| Public manifest field layout / asset host allowlist | `src/lib/public-manifest.ts`, `packages/petdex-cli/src/manifest.ts` | `packages/dsh-pet/index.js`, `client.js` |
| `thumb.webp` / `preview.webp` public artifact URL conventions | `src/lib/pet-thumbnail.ts`, `src/lib/pet-preview.ts` | `packages/dsh-pet/client.js` |

In accordance with the MIT License, the original copyright notice and permission notice are reproduced in full below.

### Petdex MIT License (original)

```text
MIT License

Copyright (c) 2026 Crafter Station

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. Pet artwork and runtime assets / 宠物美术与运行时素材

- Pet sprites are **not** distributed with this plugin. They are fetched at runtime from Petdex's public endpoints (`petdex.dev` / `assets.petdex.dev`) and cached under the user's local `~/.dsh/pets/` directory.
- The copyright of each pet's artwork belongs to its respective submitter, as declared by the creator on Petdex. This plugin claims no rights over the artwork.
- The Petdex brand mark is used to attribute the source of the catalog and the visual assets; all rights to the Petdex brand remain with Crafter Station.

- 宠物精灵图**不随本插件分发**，而是运行时从 Petdex 公开接口拉取，并缓存到用户本地 `~/.dsh/pets/`。
- 每只宠物的美术版权归其在 Petdex 上声明的提交者所有，本插件不主张任何权利。
- Petdex 品牌标识仅用于标注素材与目录来源，品牌权利归 Crafter Station 所有。

If you are a rights holder and want an artwork removed, use Petdex's official takedown process at <https://github.com/crafter-station/petdex/issues>.

---

## 3. Other dependencies / 其他依赖

- **DeepSeek Harness (DSH)** — the host application this plugin plugs into. The plugin uses its public Cordis / Typert Remote APIs; no DSH source code is redistributed here.
- **CodeBuddy `skill-creator`** — used only during development to validate/package the helper skill; not shipped with this plugin.
- Native renderers link only to operating-system libraries (Win32: `user32`, `gdi32`, `ole32`, `windowscodecs`; macOS: AppKit/Foundation). No third-party runtime is bundled.

---

## 4. Disclaimer / 免责声明

THIS PROJECT IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. It is an unofficial integration built by adapting third-party material under the MIT License. It is not developed, tested, or supported by Petdex, Crafter Station, or DeepSeek. Use of Petdex artwork and services is subject to the terms set by their respective owners.

本项目按"现状"提供，不提供任何担保。它是依据 MIT 许可改编第三方材料构建的非官方集成，不由 Petdex、Crafter Station 或 DeepSeek 开发、测试或支持。使用 Petdex 美术素材与服务需遵守其各自权利方设定的条款。
