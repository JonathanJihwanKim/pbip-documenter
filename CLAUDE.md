# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Browser-based documentation generator for Power BI PBIP/TMDL semantic models. Part of the `pbip-*` tool family by Jihwan Kim (Microsoft MVP). Live demo: https://jonathanjihwankim.github.io/pbip-documenter/

## Architecture
- **Vanilla JS, no build step** — single-page app deployed to GitHub Pages. Open `index.html` directly in a browser to run locally; no `npm install`, bundler, or transpiler.
- **File System Access API** — reads PBIP folders directly in the browser (Chrome/Edge/Opera 86+; not supported in Firefox/Safari)
- **No backend** — all processing happens client-side; user files never leave the browser
- **Dark mode** — CSS custom properties with `[data-theme="dark"]` + `prefers-color-scheme` auto-detect
- **Responsive** — sidebar collapses to toggle button at 768px

## Development & Testing
- **Run the app locally**: open `index.html` in Chrome/Edge/Opera. No server needed; the File System Access API works on `file://` and `https://`. (Some browsers prefer a local static server — any will do, e.g. `python -m http.server`.)
- **Run tests**: open `tests/test-runner.html` in a browser and click "Run All Tests". Test files (`tests/test-mparser-lineage.js`, `tests/test-lineage-reverse.js`) are loaded as `<script>` tags by the runner.
- **Generate sample data**: open `scripts/generate-sample.html` (Contoso) or `scripts/generate-sample-large.html` (enterprise — internal only) in Chrome and point at the source folder. Output is written to `samples/contoso.json` for demo mode.
- **Node.js is not used** — there is no `package.json`. Don't reach for npm tooling.

## File Structure
- `index.html` — SPA shell with Mondrian/De Stijl themed UI; loads all JS files as `<script>` tags in dependency order
- `styles.css` — App styling with CSS variables (light + dark themes, responsive breakpoints)
- `app.js` — UI logic, File System Access API integration, event handlers, diagram export routing, sponsor toast/banner orchestration
- `tmdl-parser.js` — Line-by-line state machine parser for TMDL files; also exposes `DAXReferenceExtractor`
- `visual-parser.js` — PBIR `visual.json` parser (extracts field references, including `fieldParameters` and `visualContainerObjects`)
- `m-parser.js` — M expression parser (data sources, parameters, 15+ connectors, 10-kind step decomposition, `Value.NativeQuery` SQL extraction)
- `doc-generator.js` — Output formatting (Markdown, HTML, JSON), Physical-Source Index, per-visual back-trace
- `diagram.js` — SVG rendering (relationship diagrams, visual usage maps) with dynamic star-schema layout, FP/CG header tinting, parallel-edge offsetting
- `lineage-engine.js` — Dependency graph builder (data sources → tables → measures → visuals); emits `physicalColumn` nodes, `brokenRefs` array; measure-to-measure chains via `getMeasureChain()` / `getMeasureDependencyEdges()`
- `lineage-diagram.js` — SVG lineage visualization (full, trace, impact, column impact, source trace, measure chain); FP edges dashed purple, broken refs flagged
- `detailed-erd.js` — Full-detail ERD with every column/measure and row-level relationship lines; large-format-print friendly
- `drawio-exporter.js` — draw.io XML export (ERD + lineage diagrams)
- `mermaid-exporter.js` — Mermaid syntax export (erDiagram + flowchart)

## Diagram Export System
All diagram views share a unified toolbar with zoom controls and export buttons:
- **SVG download** — standalone SVG with embedded fonts, explicit dimensions from viewBox
- **draw.io export** — mxGraph XML with `shape=table` containers, ER cardinality arrows, star-schema layout. Reads `fromCardinality`/`toCardinality` from the TMDL parser (don't re-default to many-to-one).
- **Mermaid export** — copies to clipboard; falls back to `.mmd` file download
- Export routing: `app.js` `_handleDiagramExport()` → `_exportDiagramSVG/Drawio/Mermaid()`. The container maps in `_exportDiagramSVG()` and `_getDiagramSVGClone()` (used by print/PDF) map diagram types to DOM container IDs — when adding a new diagram, register it in both. A new Visual Lineage view also goes in `_switchLineageView()`'s view map and in `_resetState()`'s container/select lists.

## TMDL Parser
State machine with states: IDLE → TABLE_BODY → PROPERTIES → EXPRESSION. Handles: table, column, measure, hierarchy, partition, relationship, role, expression. Key challenges: multi-line DAX (indentation-based), backtick blocks, quoted names, bare boolean keywords (`isHidden`, `isKey`, etc. without colons).

## Lineage & Dynamic Features
- **Dynamic Features** (field parameters + calculation groups) are first-class: surfaced in `app.js` via `_getDynamicFeaturesSummary()`, dedicated sidebar section, sponsor value-moment tracking, and dedicated Markdown/HTML/JSON export sections.
- **Field parameter detection** requires `\bNAMEOF\s*(` in the partition source (not generic SWITCH).
- **Calculation group columns** look ordinary in PBIR JSON — the model insights cards and "What PBIR Hides" callouts exist to flag this gap.
- **Auto-date tables** (`LocalDateTable_*`, `DateTableTemplate_*`) are tagged `_isAutoDate` by the parser and filtered out of all visible counts and tables in `doc-generator.js` via `_getVisibleTables()` / `_getAutoDateCount()`.

## Test Datasets
- `D:\Contoso\Contoso` — small dataset (10 tables, 11 measures, 15 visuals); critical pivot table for FP regression testing: `fffa0f95499eb9d4e940` on page `43eb9eb32ca503831335`
- `D:\sample_powerbi` — enterprise dataset (61 tables, 87 relationships, 246 measures, 542 visuals); BigQuery-only, 16 FP tables, incremental refresh, no `.pbip` root
- `samples/contoso.json` — pre-generated demo-mode payload loaded by "Try with Contoso sample data" button

## Related Repositories (sibling tools)
- `isHiddenInViewMode` — PBIR Visual Manager (Van Gogh theme)
- `pbip-impact-analyzer` — Impact Analysis + Safe Refactoring (Picasso Cubism theme)
- `pbip-lineage-explorer` — Source-column tracing

## Conventions
- Same sponsor integration pattern as sibling repos (GitHub Sponsors + Buy Me a Coffee)
- Sponsor toast shows once per session after first download; gratitude toast precedes it
- Footer cross-links to other `pbip-*` tools
- Generated documents include "Generated with pbip-documenter" watermark
- Enterprise sample data is for internal testing only — not exposed in the UI
- When switching datasets, `_resetState()` must be called at the top of `parseModel()` and `loadSampleData()` to clear diagram containers, lineage selects, stale warning banners, and the static M-parser cache, and to return Visual Lineage to the Full Lineage tab
