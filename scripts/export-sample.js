/**
 * One-time script to export Contoso parsed data as samples/contoso.json
 * Run: node scripts/export-sample.js
 */
const fs = require('fs');
const path = require('path');

// Load parsers
const { TMDLParser, DAXReferenceExtractor } = require('../tmdl-parser.js');
const VisualParser = require('../visual-parser.js');

const SEMANTIC_MODEL_PATH = 'D:\\Contoso\\Contoso\\import_contoso_sales.SemanticModel';
const REPORT_PATH = 'D:\\Contoso\\Contoso\\import_contoso_sales.Report';

// ── Read all TMDL files ──────────────────────────────────────────────────────

function readTMDLFiles(modelRoot) {
    const files = {};
    const definitionDir = path.join(modelRoot, 'definition');

    // Root .tmdl files
    for (const name of ['database.tmdl', 'model.tmdl', 'relationships.tmdl', 'expressions.tmdl']) {
        const p = path.join(definitionDir, name);
        if (fs.existsSync(p)) {
            files[name.replace('.tmdl', '')] = fs.readFileSync(p, 'utf8');
        }
    }

    // Tables
    const tablesDir = path.join(definitionDir, 'tables');
    files.tables = {};
    if (fs.existsSync(tablesDir)) {
        for (const f of fs.readdirSync(tablesDir)) {
            if (f.endsWith('.tmdl')) {
                const tableName = f.slice(0, -5); // remove .tmdl
                files.tables[tableName] = fs.readFileSync(path.join(tablesDir, f), 'utf8');
            }
        }
    }

    // Roles
    const rolesDir = path.join(definitionDir, 'roles');
    files.roles = {};
    if (fs.existsSync(rolesDir)) {
        for (const f of fs.readdirSync(rolesDir)) {
            if (f.endsWith('.tmdl')) {
                const roleName = f.slice(0, -5);
                files.roles[roleName] = fs.readFileSync(path.join(rolesDir, f), 'utf8');
            }
        }
    }

    return files;
}

// ── Read all visual.json files ───────────────────────────────────────────────

function readReportFiles(reportRoot) {
    const pagesDir = path.join(reportRoot, 'definition', 'pages');
    const pages = [];

    if (!fs.existsSync(pagesDir)) return pages;

    // Read report.json for page order and names
    const reportJsonPath = path.join(reportRoot, 'definition', 'report.json');
    let reportJson = null;
    if (fs.existsSync(reportJsonPath)) {
        reportJson = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'));
    }

    for (const pageId of fs.readdirSync(pagesDir)) {
        const pageDir = path.join(pagesDir, pageId);
        if (!fs.statSync(pageDir).isDirectory()) continue;

        // Read page.json for page name and dimensions
        const pageJsonPath = path.join(pageDir, 'page.json');
        let pageName = pageId;
        let pageWidth = 1280, pageHeight = 720;
        if (fs.existsSync(pageJsonPath)) {
            const pj = JSON.parse(fs.readFileSync(pageJsonPath, 'utf8'));
            pageName = pj.displayName || pageId;
            pageWidth = pj.width || 1280;
            pageHeight = pj.height || 720;
        }

        const visualsDir = path.join(pageDir, 'visuals');
        const visuals = [];
        if (fs.existsSync(visualsDir)) {
            for (const visualId of fs.readdirSync(visualsDir)) {
                const visualJsonPath = path.join(visualsDir, visualId, 'visual.json');
                if (fs.existsSync(visualJsonPath)) {
                    try {
                        const vj = JSON.parse(fs.readFileSync(visualJsonPath, 'utf8'));
                        visuals.push(vj);
                    } catch (e) {
                        console.warn(`Failed to parse ${visualJsonPath}:`, e.message);
                    }
                }
            }
        }

        pages.push({ pageId, pageName, pageWidth, pageHeight, visuals });
    }

    return pages;
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log('Reading Contoso files...');
const tmdlFiles = readTMDLFiles(SEMANTIC_MODEL_PATH);
const reportPages = readReportFiles(REPORT_PATH);

console.log(`Found ${Object.keys(tmdlFiles.tables || {}).length} table TMDL files`);
console.log(`Found ${reportPages.length} report pages`);

// Parse TMDL
console.log('Parsing TMDL...');
const parser = new TMDLParser();

// Build the files map that TMDLParser.parseAll() expects
const parseInput = {};
if (tmdlFiles.database) parseInput['database.tmdl'] = tmdlFiles.database;
if (tmdlFiles.model) parseInput['model.tmdl'] = tmdlFiles.model;
if (tmdlFiles.relationships) parseInput['relationships.tmdl'] = tmdlFiles.relationships;
if (tmdlFiles.expressions) parseInput['expressions.tmdl'] = tmdlFiles.expressions;
for (const [name, content] of Object.entries(tmdlFiles.tables || {})) {
    parseInput[`tables/${name}.tmdl`] = content;
}
for (const [name, content] of Object.entries(tmdlFiles.roles || {})) {
    parseInput[`roles/${name}.tmdl`] = content;
}

const parsedModel = parser.parseAll(parseInput);
const measureRefs = parser.extractAllReferences();

const totalMeasures = parsedModel.tables.reduce((s, t) => s + t.measures.length, 0);
console.log(`Parsed ${parsedModel.tables.length} tables, ${totalMeasures} measures`);

// Parse visuals
console.log('Parsing visuals...');
const visualParser = new VisualParser();
const visualData = visualParser.parseReport(reportPages);

console.log(`Parsed ${visualData.visuals.length} visuals across ${visualData.pages.length} pages`);

// Export
const output = {
    parsedModel,
    measureRefs,
    visualData,
    fieldUsageMap: visualParser.getFieldUsageMap(),
    _meta: {
        exportedAt: new Date().toISOString(),
        source: 'import_contoso_sales',
        note: 'Pre-parsed demo data for pbip-documenter sample mode'
    }
};

const outPath = path.join(__dirname, '..', 'samples', 'contoso.json');
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');
const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
console.log(`✓ Exported to samples/contoso.json (${sizeMB} MB)`);
