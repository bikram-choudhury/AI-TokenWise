# TokenWise — Release Guide

This document describes the end-to-end process for building and publishing releases of TokenWise for **Windows** and **macOS**.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18 | `node --version` |
| npm | ≥ 9 | bundled with Node |
| GitHub CLI (`gh`) | latest | `gh --version`; must be authenticated (`gh auth status`) |
| electron-builder | auto-installed | dev dependency |

> **Platform restriction:** macOS `.dmg` packages can **only** be built on a macOS machine. Windows `.exe` (NSIS) packages can **only** be built on a Windows machine. Do not attempt cross-platform builds.

---

## 1. Prepare the Release

### 1.1 Update the version

Edit `package.json` at the project root and bump the `"version"` field following [Semantic Versioning](https://semver.org/):

- **patch** (`0.1.x`) — bug fixes, dependency updates  
- **minor** (`0.x.0`) — new features, backward-compatible  
- **major** (`x.0.0`) — breaking changes

```json
{
  "version": "0.1.2"
}
```

### 1.2 Install / verify dependencies

```powershell
# Windows / macOS
npm run install:all
```

---

## 2. Build

### Windows (run on a Windows machine)

```powershell
npm run electron:pack:win
```

Output: `dist/TokenWise Setup <version>.exe` (NSIS x64 installer)

### macOS (run on a macOS machine)

```bash
npm run electron:pack:mac
```

Output:
- `dist/TokenWise-<version>.dmg` — Intel x64
- `dist/TokenWise-<version>-arm64.dmg` — Apple Silicon

### All platforms at once (builds only the current OS target)

```bash
npm run electron:pack
```

> The `electron:pack:linux` script also exists and produces an `.AppImage` (x64), built on Linux.

---

## 3. Commit, Tag, and Push

Run these steps after the builds are ready (on every release platform):

```bash
# Stage the version bump and any rebuilt dist-electron artifacts
git add package.json dist-electron/main.js dist-electron/server.js

git commit -m "chore(release): v<version>"

# Create an annotated tag
git tag -a v<version> -m "TokenWise v<version>"

# Push branch and tag
git push origin main
git push origin v<version>
```

---

## 4. Publish the GitHub Release

Use `gh release create` once all platform binaries are available. Attach every installer to the same tag.

### Windows only

```powershell
gh release create v<version> `
  "dist/TokenWise Setup <version>.exe" `
  --title "TokenWise v<version>" `
  --notes "Release notes here"
```

### macOS only (run on macOS after the Windows release already exists)

```bash
gh release upload v<version> \
  "dist/TokenWise-<version>.dmg" \
  "dist/TokenWise-<version>-arm64.dmg"
```

### Both platforms in one command (if all files are on the same machine)

```bash
gh release create v<version> \
  "dist/TokenWise Setup <version>.exe" \
  "dist/TokenWise-<version>.dmg" \
  "dist/TokenWise-<version>-arm64.dmg" \
  --title "TokenWise v<version>" \
  --notes "Release notes here"
```

---

## 5. Release Notes Template

```markdown
## What's Changed

- <Description of change 1>
- <Description of change 2>

**Downloads**
| Platform | File |
|----------|------|
| Windows x64 | `TokenWise Setup <version>.exe` |
| macOS x64 | `TokenWise-<version>.dmg` |
| macOS arm64 | `TokenWise-<version>-arm64.dmg` |

**Full Changelog:** https://github.com/bikram-choudhury/AI-TokenWise/compare/v<prev>...v<version>
```

---

## 6. Verify the Release

```bash
gh release view v<version>
```

Open the release on GitHub to confirm all expected assets are attached.

---

## Checklist

- [ ] `package.json` version bumped
- [ ] `npm run install:all` run (no missing deps)
- [ ] Windows build: `TokenWise Setup <version>.exe` produced
- [ ] macOS build: `.dmg` files produced (run on macOS)
- [ ] Artifacts committed and pushed
- [ ] Tag created and pushed
- [ ] `gh release create` / `gh release upload` run
- [ ] Release verified on GitHub
