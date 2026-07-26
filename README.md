# Sprite Tint for TurboWarp

Unsandboxed TurboWarp extension that adds a sprite tint effect.

## Blocks

- `set tint color [COLOR] opacity [OPACITY]`
- `clear tint`

`OPACITY` is clamped to `0-100`.
`clear graphic effects`, green flag, and stop all also clear the tint.

## Local Test

Run a local server from this folder:

```powershell
python -m http.server 8000
```

Load the extension in TurboWarp:

```text
https://turbowarp.org/editor?extension=http://localhost:8000/sprite-tint.js
```

The extension must run unsandboxed. TurboWarp only allows unsandboxed extensions from `http://localhost:8000/` or the official extension gallery.
