# PBIP Documenter

**Generate comprehensive documentation from Power BI PBIP/TMDL semantic models.**

A free, open-source browser-based tool that parses your TMDL files and generates professional documentation — including model overviews, measure catalogs with DAX, relationship diagrams, visual usage mapping, and more.

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-❤-ea4aaa?style=flat-square)](https://github.com/sponsors/JonathanJihwanKim)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-orange?style=flat-square)](https://buymeacoffee.com/jihwankim)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

## Features

### Core Documentation
- **Model Overview** — database name, compatibility level, culture, table/column/measure counts
- **Table Inventory** — columns with data types, descriptions, format strings, hidden status
- **Measure Catalog** — DAX expressions with syntax highlighting, display folders, format strings, referenced columns/measures
- **Relationships** — from/to columns, cardinality, cross-filter direction, active/inactive status
- **Roles** — role names, permissions, RLS filter expressions per table
- **Expressions** — shared/parameter M expressions

### Visual Features
- **Relationship Diagram** — SVG visualization of table relationships with cardinality indicators
- **Visual Usage Map** — shows which report visuals use each measure/column (requires Report folder)

### Export Formats
- **Markdown** (.md) — single file with full documentation
- **HTML** (.html) — styled, print-to-PDF friendly, DAX syntax highlighted
- **JSON** (.json) — machine-readable metadata export
- **SVG** (.svg) — relationship diagram export

## Quick Start

1. Open the tool: [jonathanjihwankim.github.io/pbip-documenter](https://jonathanjihwankim.github.io/pbip-documenter/)
2. Click **Open PBIP Folder**
3. Select your PBIP project folder (containing `.SemanticModel` and optionally `.Report`)
4. Browse the parsed model in the sidebar
5. Download documentation in your preferred format

> **Note:** Your files never leave your browser. All parsing happens client-side.

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
├── MyProject.Report/ (optional, for visual usage)
│   └── definition/
│       └── pages/
│           └── Page1/
│               ├── page.json
│               └── visuals/
│                   └── visual1/
│                       └── visual.json
```

## Also by Jihwan Kim

| Tool | Description |
|------|-------------|
| [PBIR Visual Manager](https://jonathanjihwankim.github.io/isHiddenInViewMode/) | Manage visual properties in Power BI PBIR reports |
| [PBIP Impact Analyzer](https://jonathanjihwankim.github.io/pbip-impact-analyzer/) | Analyze dependencies and safely refactor semantic models |
| **PBIP Documenter** | Generate documentation from TMDL (you are here) |

## Support This Tool

If this tool saves you time, consider supporting development:

- [**GitHub Sponsors**](https://github.com/sponsors/JonathanJihwanKim) — monthly sponsorship
- [**Buy Me a Coffee**](https://buymeacoffee.com/jihwankim) — one-time support

## License

[MIT](LICENSE) — Jihwan Kim
