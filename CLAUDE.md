# PBIP Documenter

## Project Overview
Browser-based documentation generator for Power BI PBIP/TMDL semantic models. Part of the `pbip-*` tool family by Jihwan Kim (Microsoft MVP).

## Architecture
- **Vanilla JS, no build step** — single-page app deployed to GitHub Pages
- **File System Access API** — reads PBIP folders directly in the browser (Chrome/Edge/Opera)
- **No backend** — all processing happens client-side

## File Structure
- `index.html` — SPA shell with Mondrian/De Stijl themed UI
- `styles.css` — App styling with CSS variables
- `app.js` — UI logic, File System Access API integration, event handlers
- `tmdl-parser.js` — Line-by-line state machine parser for TMDL files
- `visual-parser.js` — PBIR visual.json parser (extracts field references)
- `doc-generator.js` — Output formatting (Markdown, HTML, JSON)
- `diagram.js` — SVG rendering (relationship diagrams, visual usage maps)

## TMDL Parser
State machine with states: IDLE → TABLE_BODY → PROPERTIES → EXPRESSION
Handles: table, column, measure, hierarchy, partition, relationship, role, expression
Key challenges: multi-line DAX (indentation-based), backtick blocks, quoted names

## Related Repositories
- `isHiddenInViewMode` — PBIR Visual Manager (Van Gogh theme)
- `pbip-impact-analyzer` — Impact Analysis + Safe Refactoring (Picasso Cubism theme)

## Conventions
- Same sponsor integration pattern as sibling repos (GitHub Sponsors + Buy Me a Coffee)
- Sponsor toast shows once per session after first download
- Footer cross-links to other tools
- Generated documents include "Generated with pbip-documenter" watermark
