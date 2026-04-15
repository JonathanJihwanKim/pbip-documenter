'use strict';
// Smoke test for new reverse-walker methods in lineage-engine.js
// Run: node tests/test-lineage-reverse.js

const MExpressionParser = require('../m-parser.js');

// Minimal stubs needed by lineage-engine before loading it
global.DAXReferenceExtractor = class {
    static buildMeasureLookup(tables) {
        const m = new Map();
        for (const t of tables) for (const ms of (t.measures || [])) m.set(ms.name, t.name);
        return m;
    }
};
global.MExpressionParser = MExpressionParser;

// Load lineage-engine (exports LineageEngine)
const LineageEngine = require('../lineage-engine.js');

let pass = 0, fail = 0;
function assert(label, cond, got) {
    if (cond) { console.log('  PASS:', label); pass++; }
    else       { console.log('  FAIL:', label, '->', JSON.stringify(got)); fail++; }
}

// Minimal model
const mExpr = `let Source = Sql.Database("srv","DW"), T = Source{[Schema="dbo",Item="FactSales"]}[Data], R = Table.RenameColumns(T, {{"Amount","Total Amount"}}) in R`;
const model = {
    database: { name: 'TestDB' },
    model: {},
    tables: [
        {
            name: 'Sales',
            columns: [{ name: 'Total Amount', dataType: 'decimal' }],
            measures: [{ name: 'Total Sales', expression: 'SUM(Sales[Total Amount])' }],
            partitions: [{ name: 'p1', source: mExpr }],
            hierarchies: [], calculationGroup: null
        }
    ],
    relationships: [],
    roles: [],
    expressions: []
};

const measureRefs = {
    'Total Sales': {
        columnRefs: [{ table: 'Sales', column: 'Total Amount' }],
        measureRefs: [],
        tableRefs: []
    }
};

const visualData = {
    pages: [{ displayName: 'Page 1', visuals: [] }],
    visuals: [
        { pageName: 'Page 1', visualName: 'Chart1', visualType: 'barChart',
          fields: [{ type: 'measure', table: 'Sales', name: 'Total Sales' }] }
    ]
};

const engine = new LineageEngine(model, visualData, measureRefs);
engine.buildGraph();

console.log('--- tableLineage ---');
assert('tableLineage has Sales', engine.tableLineage.has('Sales'), [...engine.tableLineage.keys()]);
const tl = engine.tableLineage.get('Sales');
assert('physicalTable=FactSales', tl.physicalTable === 'FactSales', tl.physicalTable);
assert('physicalSchema=dbo', tl.physicalSchema === 'dbo', tl.physicalSchema);
assert('rename Amount→Total Amount', tl.renames.length === 1 && tl.renames[0].sourceName === 'Amount', tl.renames);

console.log('--- getDataSourceConsumers ---');
const srcKey = `source:${MExpressionParser._sourceKey({ type: 'SQL Server', server: 'srv', database: 'DW' })}`;
console.log('  sourceKey:', srcKey);
const sourceNodes = [...engine.nodes.values()].filter(n => n.type === 'dataSource');
console.log('  source nodes:', sourceNodes.map(n => n.id));
const actualSrcId = sourceNodes[0]?.id;
if (actualSrcId) {
    const cons = engine.getDataSourceConsumers(actualSrcId);
    assert('consumers.tables has Sales', cons.tables.some(t => t.name === 'Sales'), cons.tables.map(t => t.name));
    assert('consumers.measures has Total Sales', cons.measures.some(m => m.name === 'Total Sales'), cons.measures);
}

console.log('--- getColumnConsumers ---');
const cc = engine.getColumnConsumers('Sales', 'Total Amount');
assert('cc.measures has Total Sales', cc.measures.some(m => m.name === 'Total Sales'), cc.measures);

console.log('--- getTopMeasuresByVisualCount ---');
const top = engine.getTopMeasuresByVisualCount(5);
assert('top measures has Total Sales', top.length > 0 && top[0].name === 'Total Sales', top);
assert('visualCount=1', top[0].visualCount === 1, top[0].visualCount);

console.log('--- getPhysicalTableConsumers ---');
const ptc = engine.getPhysicalTableConsumers('FactSales', 'dbo');
assert('ptc.tables has Sales', ptc.tables.some(t => t.name === 'Sales'), ptc.tables.map(t => t.name));
assert('ptc.measures has Total Sales', ptc.measures.some(m => m.name === 'Total Sales'), ptc.measures);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
