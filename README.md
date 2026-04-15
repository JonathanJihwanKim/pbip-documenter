# PBIP Documenter

**Generate comprehensive, bidirectional documentation from Power BI PBIP/TMDL semantic models — instantly, in your browser.**

[![Try It Now](https://img.shields.io/badge/Try%20It%20Now-▶%20Live%20Demo-1a3a5c?style=for-the-badge&logo=powerbi)](https://jonathanjihwankim.github.io/pbip-documenter/)
[![Fund This Tool](https://img.shields.io/badge/Fund_This_Tool-❤_from_7_EUR/mo-ea4aaa?style=for-the-badge)](https://github.com/sponsors/JonathanJihwanKim)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕-orange?style=for-the-badge)](https://buymeacoffee.com/jihwankim)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

> **No PBIP file?** [Try the live demo with Contoso sample data](https://jonathanjihwankim.github.io/pbip-documenter/) — no setup required, runs entirely in your browser.

<!-- Screenshot: capture from D:\sample_powerbi overview view and save as docs/screenshot-overview.png -->
<!-- ![Model Overview](docs/screenshot-overview.png) -->

---

## What is PBIP / TMDL?

**PBIP** (Power BI Project) is a developer-friendly file format introduced in Power BI Desktop that stores your semantic model and reports as plain text files instead of a binary `.pbix`. It integrates with Git and CI/CD pipelines.

**TMDL** (Tabular Model Definition Language) is the text-based format within PBIP that describes every table, column, measure, relationship, and role in your semantic model — one `.tmdl` file per object, readable and diffable in any editor.

If you've enabled "Save as Power BI Project" in Power BI Desktop (Preview → Developer mode), your workspace folder already contains PBIP files ready for this tool.

---

## Who is this for?

### Power BI Developer
You write DAX measures and want to know:
- What tables and columns does each measure reference?
- Where (which pages, which visuals) is each measure displayed?
- Which measures depend on other measures?

**What you get:** Measure Catalog with full DAX + referenced columns/measures, "Used in Visuals" grouped by page, and measure dependency chains.

### Data Engineer
You own the source systems and want to know:
- Which physical tables (e.g. `dbo.FactSales`) were loaded into the model?
- Were columns renamed between source and model?
- Which DAX measures and report visuals ultimately consume each source table or column?

**What you get:** Expanded Data Sources view showing physical→model table mapping, column renames detected from Power Query, and a "Where Used" catalog per model column.

### Product Owner / Manager
You need the big picture:
- How large is this model? How many measures, tables, visuals, data sources?
- What are the most-used measures and source tables?
- Are there any dynamic features (field parameters, calculation groups) that behave differently than PBIR JSON suggests?

**What you get:** Executive Summary at the top of every export with model stats, top measures by visual coverage, and top source tables by consumption.

---

## Quick Start

1. Open the tool: **[jonathanjihwankim.github.io/pbip-documenter](https://jonathanjihwankim.github.io/pbip-documenter/)**
2. Select your persona (Power BI Developer / Data Engineer / Product Owner) — the app highlights the most relevant section after parsing
3. Click **Open Project Folder** and select your PBIP project folder
4. The tool auto-discovers `.SemanticModel` and `.Report` folders
5. Browse the parsed model in the sidebar — tables, measures, relationships, data sources, visuals, and more
6. Download documentation:
   - **Full Report (.html)** — self-contained with DAX highlighting, collapsible sections, column usage, data source drill-down
   - **Full Report (.md)** — clean Markdown with tables, ASCII layout grids, ideal for Git wikis
   - **JSON** — machine-readable with `whereUsed` blocks per column and `consumers` blocks per data source

### Manual documentation vs. PBIP Documenter

| | Manual | PBIP Documenter |
|---|---|---|
| 10 tables, 11 measures, 15 visuals | ~45 minutes | **< 10 seconds** |
| Source → model column lineage | Spreadsheet by hand | Auto-detected from M queries |
| Visual lineage tracing | Not feasible | Built-in |
| Relationship diagrams | Draw by hand | Auto-generated SVG |
| Keeps up with model changes | Start over | Re-run instantly |
| Privacy | Varies | 100% client-side |

---

## What You Get

Point the tool at your PBIP project folder and get professional, bidirectional documentation:

### For Power BI Developers (forward view)
- **Measure Catalog** — DAX expressions with syntax highlighting, display folders, format strings, referenced columns and measures, "Used in Visuals" by page
- **Table Inventory** — columns with data types, descriptions, sort-by, summarize-by, and hidden status
- **Relationships** — from/to columns, cardinality, cross-filter direction, active/inactive
- **Roles** — permission levels and RLS filter expressions per table

### For Data Engineers (reverse view)
- **Data Sources** — expanded view with physical table names (schema + table from Navigation steps), Power Query column renames, computed columns, and full consumer catalog (measures + visuals + pages)
- **Column Usage (Where Used)** — per table, every visible column shows which measures reference it and which visuals display it
- **Source Trace Lineage** — click a physical source table to open a forward lineage diagram: source → model table → measures → visuals

### For Product Owners (summary view)
- **Executive Summary** — model stats at a glance: tables, measures, relationships, pages, visuals, data sources, dynamic features, broken references
- **Top Measures** — ranked by number of visuals they appear in
- **Top Source Tables** — ranked by downstream visual coverage
- **Dynamic Features** — field parameters and calculation groups that PBIR JSON doesn't fully represent

### Interactive Diagrams
- **Relationship Diagram** — SVG with pan, zoom, and zoom-to-fit; star-schema layout
- **Visual Lineage** — full model, visual trace, measure impact, column impact, and source trace modes
- **Visual Usage Diagram** — field-to-visual mapping

### Export
- **HTML** — fully self-contained, embeds CSS + SVG, DAX syntax highlighting, collapsible sections, table of contents
- **Markdown** — clean document with fenced DAX blocks, ASCII page layout grids, and structured tables
- **JSON** — machine-readable with `whereUsed` and `consumers` blocks for downstream tooling

> Your files never leave your browser. All parsing happens client-side — nothing is uploaded anywhere.

---

## Browser Support

Requires the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API):

| Browser | Support |
|---------|---------|
| Chrome 86+ | ✅ Supported |
| Edge 86+ | ✅ Supported |
| Opera 72+ | ✅ Supported |
| Firefox | ❌ Not supported |
| Safari | ❌ Not supported |

---

## PBIP Folder Structure

The tool expects a standard PBIP project layout:

<details>
<summary>Show folder structure</summary>

```
MyProject/
├── MyProject.SemanticModel/
│   └── definition/
│       ├── database.tmdl
│       ├── model.tmdl
│       ├── relationships.tmdl
│       ├── expressions.tmdl        (optional — shared M expressions / parameters)
│       ├── tables/
│       │   ├── Sales.tmdl
│       │   ├── Product.tmdl
│       │   └── ...
│       └── roles/                  (optional)
│           └── Reader.tmdl
└── MyProject.Report/               (optional — enables visual analysis)
    └── definition/
        └── pages/
            └── Page1/
                ├── page.json
                └── visuals/
                    └── visual1/
                        └── visual.json
```

</details>

---

## Also by Jihwan Kim

| Tool | Description |
|------|-------------|
| [PBIR Visual Manager](https://jonathanjihwankim.github.io/isHiddenInViewMode/) | Manage `isHiddenInViewMode` and visual properties in PBIR reports |
| [PBIP Impact Analyzer](https://jonathanjihwankim.github.io/pbip-impact-analyzer/) | Analyze what breaks when you change a measure, column, or table |
| **PBIP Documenter** | Generate bidirectional documentation from TMDL (you are here) |

---

## Support Development

This tool is **free forever** — built and maintained solo by [Jihwan Kim](https://github.com/JonathanJihwanKim) (Microsoft MVP). If PBIP Documenter saves you even 30 minutes of documentation work, please consider sponsoring.

<a href="https://github.com/sponsors/JonathanJihwanKim"><img src="https://img.shields.io/badge/GitHub%20Sponsors-❤%20Monthly%20from%207%20EUR-ea4aaa?style=for-the-badge" alt="GitHub Sponsors" /></a> <a href="https://buymeacoffee.com/jihwankim"><img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-☕%20One--time%20support-orange?style=for-the-badge" alt="Buy Me a Coffee" /></a>

### Sponsor Tiers

| Tier | Amount | Recognition |
|------|--------|-------------|
| **Gold** | 50+ EUR/mo | Logo + link on README and app footer |
| **Silver** | 10+ EUR/mo | Name + link on README + shoutout in release notes |
| **Bronze** | Monthly supporter | Name + link on README |
| **Coffee** | One-time | Name listed in Hall of Sponsors |

### Hall of Sponsors

| Name | Tier |
|------|------|
| [Alessandro Tiberti Bertin](https://www.linkedin.com/in/aletb/) | Bronze |

---

## License

[MIT](LICENSE) — Jihwan Kim

**Built for:** Power BI · Microsoft Fabric · PBIP · PBIR · TMDL · Semantic Models · DAX · Data Governance · CI/CD · Developer Tools
