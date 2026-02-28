# PBIP Documenter

**Generate comprehensive documentation from Power BI PBIP/TMDL semantic models — instantly, in your browser.**

[![Try It Now](https://img.shields.io/badge/Try%20It%20Now-▶%20Live%20Demo-1a3a5c?style=for-the-badge&logo=powerbi)](https://jonathanjihwankim.github.io/pbip-documenter/)
[![Fund This Tool](https://img.shields.io/badge/Fund_This_Tool-❤_from_7_EUR/mo-ea4aaa?style=for-the-badge)](https://github.com/sponsors/JonathanJihwanKim)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-orange?style=for-the-badge)](https://buymeacoffee.com/jihwankim)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

> **No PBIP file?** [Try the live demo with Contoso sample data](https://jonathanjihwankim.github.io/pbip-documenter/) — no setup required.

<!-- TODO: Capture a screenshot of the app with a real model loaded (relationship diagram or model overview), save as docs/screenshot.png, and uncomment below -->
<!-- ![PBIP Documenter Screenshot](docs/screenshot.png) -->

### Manual documentation vs. PBIP Documenter

| | Manual | PBIP Documenter |
|---|---|---|
| 10 tables, 11 measures, 15 visuals | ~45 minutes | **< 10 seconds** |
| Visual lineage tracing | Not feasible | Built-in |
| Relationship diagrams | Draw by hand | Auto-generated SVG |
| Keeps up with model changes | Start over | Re-run instantly |
| Privacy | Varies | 100% client-side |

## What You Get

Point the tool at your PBIP project folder and get instant, professional documentation:

- **Full model documentation** — tables, columns, measures with DAX syntax highlighting, and cross-references
- **Interactive relationship diagram** — SVG visualization with pan/zoom, showing all table connections
- **Visual usage mapping** — see exactly which report visuals use each measure and column
- **Page layout minimaps** — pixel-accurate SVG previews of visual positions on each report page
- **Field parameter & calculation group detection** — automatically identified and annotated
- **Export as self-contained HTML or Markdown** — ready for wikis, Git repos, or printing to PDF

> Your files never leave your browser. All parsing happens client-side — nothing is uploaded anywhere.

## Quick Start

1. Open the tool: **[jonathanjihwankim.github.io/pbip-documenter](https://jonathanjihwankim.github.io/pbip-documenter/)**
2. Click **Open Project Folder** and select your PBIP project folder
3. The tool auto-discovers your `.SemanticModel` and `.Report` folders (if multiple models exist, a discovery panel lets you choose)
4. Browse the parsed model using the sidebar — tables, measures, relationships, visuals, and more
5. Download documentation:
   - **Full Report (.html)** — self-contained with embedded diagrams, collapsible sections, and DAX highlighting
   - **Full Report (.md)** — clean Markdown with ASCII layout grids, ideal for Git repos and wikis
   - Each format offers three scopes: **All**, **Semantic Model Only**, or **Visuals Only**

## Support Development

This tool is **free forever** — built and maintained solo by [Jihwan Kim](https://github.com/JonathanJihwanKim) (Microsoft MVP). If PBIP Documenter saves you even 30 minutes of manual documentation work, please consider sponsoring. Every contribution goes directly toward new features and maintenance.

**Funding goal: 0 / 200 EUR per month** `░░░░░░░░░░░░░░░░░░░░ 0%`

<a href="https://github.com/sponsors/JonathanJihwanKim"><img src="https://img.shields.io/badge/GitHub%20Sponsors-❤%20Monthly%20from%207%20EUR-ea4aaa?style=for-the-badge" alt="GitHub Sponsors" /></a> <a href="https://buymeacoffee.com/jihwankim"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕%20One--time%20support-orange?style=for-the-badge" alt="Buy Me a Coffee" /></a>

## Features

### Semantic Model Documentation
- **Model Overview** — database name, compatibility level, culture, and aggregate counts
- **Table Inventory** — columns with data types, descriptions, format strings, hidden status
- **Measure Catalog** — DAX expressions with syntax highlighting, display folders, format strings, and automatic cross-reference extraction (which columns and measures each formula uses)
- **Relationships** — from/to columns, cardinality, cross-filter direction, active/inactive status
- **Roles** — role names, permission levels, RLS filter expressions per table
- **Expressions** — shared and parameter M expressions

### Report Analysis
- **Visual Field Mapping** — every visual's fields organized by role (Values, Category, Series, Filters, Tooltips)
- **Page Layout Minimap** — SVG canvas showing actual visual positions, color-coded by type (tables, charts, slicers, cards); hover for names, click to jump to details
- **Visual Usage Map** — two views: "By Visual" (which fields each visual uses) and "By Field" (which visuals use each field)

### Smart Detection
- **Field Parameters** — automatically detected via NAMEOF/SWITCH patterns in expressions; available fields listed as clickable chips
- **Calculation Groups** — identified and rendered with individual calc item cards and collapsible DAX expressions

### Interactive Diagrams
- **Relationship Diagram** — SVG with pan, zoom, and zoom-to-fit controls; shows only relationship-participating columns; disconnected tables displayed as compact standalone cards
- **Visual Usage Diagram** — SVG mapping of fields to the visuals that consume them

### Export
- **HTML** — fully self-contained file with embedded CSS, SVG diagrams, DAX syntax highlighting, collapsible sections, table of contents with anchor links
- **Markdown** — clean document with ASCII page layout grids, fenced DAX code blocks, structured tables, and visual field breakdowns

> **Free forever, no paywalls.** Help keep it that way — [support development](https://github.com/sponsors/JonathanJihwanKim).

## Browser Support

Requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API):
- ✅ Chrome 86+
- ✅ Edge 86+
- ✅ Opera 72+
- ❌ Firefox (not supported)
- ❌ Safari (not supported)

## PBIP Folder Structure

The tool expects a standard PBIP project structure:

```
MyProject/
├── MyProject.SemanticModel/
│   └── definition/
│       ├── database.tmdl
│       ├── model.tmdl
│       ├── relationships.tmdl
│       ├── expressions.tmdl (optional)
│       ├── tables/
│       │   ├── Sales.tmdl
│       │   ├── Product.tmdl
│       │   └── ...
│       └── roles/ (optional)
│           └── Reader.tmdl
├── MyProject.Report/ (optional, for visual analysis)
│   └── definition/
│       └── pages/
│           └── Page1/
│               ├── page.json
│               └── visuals/
│                   └── visual1/
│                       └── visual.json
```

## Sponsors & Support

I'm **Jihwan Kim** ([Microsoft MVP](https://github.com/JonathanJihwanKim)), and I build PBIP tools so Power BI developers can work faster. This project is **free forever** — no paywalls, no premium tiers. Sponsoring keeps it that way and funds what comes next.

<a href="https://github.com/sponsors/JonathanJihwanKim"><img src="https://img.shields.io/badge/GitHub%20Sponsors-❤%20Monthly%20from%207%20EUR-ea4aaa?style=for-the-badge" alt="GitHub Sponsors" /></a> <a href="https://buymeacoffee.com/jihwankim"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕%20One--time%20support-orange?style=for-the-badge" alt="Buy Me a Coffee" /></a>

### What Your Support Funds
- New features (lineage diagrams, DAX formatting, CI/CD integration)
- Bug fixes, browser compatibility, and performance improvements
- Community support and documentation

### Sponsor Tiers

| Tier | Amount | Recognition |
|------|--------|-------------|
| **Gold** | 50+ EUR/mo | Logo + link on README and app footer |
| **Silver** | 10+ EUR/mo | Name + link on README |
| **Coffee** | One-time | Name listed below |

### Hall of Sponsors

> **Be the first!** Your name, logo, or company will appear right here. [Become a sponsor](https://github.com/sponsors/JonathanJihwanKim) and join the wall.

## Also by Jihwan Kim

| Tool | Description |
|------|-------------|
| [PBIR Visual Manager](https://jonathanjihwankim.github.io/isHiddenInViewMode/) | Manage visual properties in Power BI PBIR reports |
| [PBIP Impact Analyzer](https://jonathanjihwankim.github.io/pbip-impact-analyzer/) | Analyze dependencies and safely refactor semantic models |
| **PBIP Documenter** | Generate documentation from TMDL (you are here) |

## License

[MIT](LICENSE) — Jihwan Kim
