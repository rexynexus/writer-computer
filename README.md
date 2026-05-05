# Writer

Writer is a local-first desktop markdown editor for folders of plain-text notes, docs, and personal wikis.

It is built with Tauri v2, React, Zustand, CodeMirror, and Rust. The app keeps documents on disk, respects workspace `.gitignore` rules, supports multiple windows, and renders extended markdown such as tables and Mermaid diagrams.

## Platform Support

- **macOS** - signed release flow via `scripts/distribute.sh`
- **Windows** - NSIS installer (x64), standard window chrome, WebView2

## Repository

- `apps/desktop/` - Tauri desktop app.
- `apps/desktop/src/` - React frontend.
- `apps/desktop/src-tauri/src/` - Rust commands, workspace state, watcher, updater, and CLI integration.
- `apps/website/` - landing page.
- `docs/` - project and agent workflow docs.
- `SPECs/` - feature specs and design notes.

## Development

This repo uses Vite+ through the `vp` CLI. Use `vp` instead of calling the package manager or Vite tooling directly.

```bash
vp install
vp dev
```

On Windows, if `vp` is not available, use pnpm and npx directly:

```bash
pnpm install
npx @tauri-apps/cli@2 dev
```

## Validation

```bash
vp check
vp test
```

Rust validation runs from the Tauri crate:

```bash
cd apps/desktop/src-tauri
cargo test
cargo clippy
cargo fmt --check
```

## Building

### macOS

macOS releases are cut locally with `scripts/distribute.sh`. See `docs/releasing.md` for the signed, notarized release workflow and updater publishing details.

### Windows

Prerequisites: Rust (stable-msvc), Node.js 20+, pnpm, Visual Studio Build Tools (C++ workload), WebView2 runtime.

```bash
cd apps/desktop
npx @tauri-apps/cli@2 build --bundles nsis
```

The installer is produced at `apps/desktop/src-tauri/target/release/bundle/nsis/Writer_<version>_x64-setup.exe`.
