# Figma Website Builder Ultimate

V7 exports a robust website ZIP from a selected Figma Frame.

## Default: Smart 90+

- `index.html` uses a high-fidelity reference render so freeform designs do not collapse.
- `editable.html` contains semantic editable HTML/CSS generated from the node tree.
- All raster assets are embedded as real WebP bytes; vectors are SVG.
- Design tokens, reusable components, source map, visual diff, reports, and deployment configs are included.

## Install

Figma → Plugins → Development → Import plugin from manifest… → choose `manifest.json`.

## Modes

1. **Smart 90+** — exact visual page + editable alternative.
2. **Editable** — semantic HTML/CSS only.
3. **Pixel-perfect** — exact visual page with accessible interaction hotspots.

## Limit

No tool can guarantee a semantic responsive reconstruction of every arbitrary freeform Figma file. V7 solves this honestly by separating visual fidelity from editable reconstruction instead of pretending both are always identical.
