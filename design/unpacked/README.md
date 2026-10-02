# Readable copies of the design files

The original design files are single-file bundles: their content is compressed and encoded
inside one HTML file, so they cannot be searched or read as text. The files here are the same
content, unpacked, with embedded fonts removed.

| File | Source |
|---|---|
| `chairside-demo.html` | `Chairside Demo v3 (offline).html` — markup (lines 1–1367), then data and logic (lines 1368–2153) |
| `architecture-explorer.html` | `Architecture Explorer (1).html` — markup, then all diagram and guide content as data |

These are **reference material, not application code**. Do not import from them, copy their
markup, or run them. To see the design working, open the original file in a browser.

How to find a screen: `docs/product/design-reference.md` has the line ranges.

## Regenerating

If the design is exported again:

```
node design/unpacked/unpack.mjs "<path to bundled .html>" design/unpacked/chairside-demo.html
```

Line numbers in `docs/product/design-reference.md` and in backlog tasks will shift. Update
them in the same change.
