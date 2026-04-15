'use strict';
// Quick Node.js smoke test for extractTableLineage and extractTableLineageFromModel
// Run: node tests/test-mparser-lineage.js

const MExpressionParser = require('../m-parser.js');
MExpressionParser._declaredParams = new Set();

let pass = 0, fail = 0;

function assert(label, cond, got) {
    if (cond) { console.log('  PASS:', label); pass++; }
    else       { console.log('  FAIL:', label, '→ got:', JSON.stringify(got)); fail++; }
}

console.log('--- extractTableLineage ---');

// 1. Navigation Schema+Item extraction
const m1 = `let Source = Sql.Database("srv","DW"), t = Source{[Schema="dbo",Item="FactSales"]}[Data] in t`;
const r1 = MExpressionParser.extractTableLineage(m1);
assert('schema=dbo',        r1.physicalSchema === 'dbo',       r1.physicalSchema);
assert('table=FactSales',   r1.physicalTable  === 'FactSales',  r1.physicalTable);
assert('no renames',        r1.renames.length === 0,            r1.renames.length);

// 2. Item-first ordering
const m2 = `let S = Sql.Database("x","y"), T = S{[Item="DimProduct",Schema="prd"]}[Data] in T`;
const r2 = MExpressionParser.extractTableLineage(m2);
assert('Item-first table', r2.physicalTable === 'DimProduct', r2.physicalTable);
assert('Item-first schema', r2.physicalSchema === 'prd', r2.physicalSchema);

// 3. RenameColumns extraction
const m3 = `let S = Sql.Database("x","y"), T = S{[Schema="dbo",Item="Order"]}[Data],
R = Table.RenameColumns(T, {{"OrderID","Order ID"},{"Qty","Quantity"}}) in R`;
const r3 = MExpressionParser.extractTableLineage(m3);
assert('renames count=2', r3.renames.length === 2, r3.renames.length);
assert('rename OrderID',  r3.renames[0].sourceName === 'OrderID' && r3.renames[0].modelName === 'Order ID', r3.renames[0]);
assert('rename Qty',      r3.renames[1].sourceName === 'Qty'     && r3.renames[1].modelName === 'Quantity', r3.renames[1]);

// 4. SelectColumns
const m4 = `let S = Sql.Database("x","y"), T = S{[Schema="s",Item="Dim"]}[Data],
C = Table.SelectColumns(T, {"ID","Name","Status"}) in C`;
const r4 = MExpressionParser.extractTableLineage(m4);
assert('selectedColumns count=3', r4.selectedColumns && r4.selectedColumns.length === 3, r4.selectedColumns);
assert('selectedColumns[0]=ID', r4.selectedColumns && r4.selectedColumns[0] === 'ID', r4.selectedColumns && r4.selectedColumns[0]);

// 5. AddColumn
const m5 = `let S = Sql.Database("x","y"), T = S{[Schema="s",Item="Fact"]}[Data],
A = Table.AddColumn(T, "ComputedCol", each [A] + [B]) in A`;
const r5 = MExpressionParser.extractTableLineage(m5);
assert('addedColumns=[ComputedCol]', r5.addedColumns.length === 1 && r5.addedColumns[0] === 'ComputedCol', r5.addedColumns);

// 6. No navigation (e.g. CSV) returns nulls
const m6 = `let S = Csv.Document(File.Contents("C:/data.csv")) in S`;
const r6 = MExpressionParser.extractTableLineage(m6);
assert('csv no physicalTable', r6.physicalTable === null, r6.physicalTable);

// 7. extractTableLineageFromModel
const model = {
    tables: [
        { name: 'Sales', partitions: [{ source: m1 }] },
        { name: 'Product', partitions: [{ source: m2 }] },
        { name: 'Params', partitions: [{ source: m6 }] }
    ]
};
const map = MExpressionParser.extractTableLineageFromModel(model);
assert('map has Sales',   map.has('Sales'),   'no Sales');
assert('map has Product', map.has('Product'), 'no Product');
assert('map has no Params (no nav)', !map.has('Params'), 'Params present unexpectedly');
assert('Sales.physicalTable=FactSales', map.get('Sales').physicalTable === 'FactSales', map.get('Sales').physicalTable);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
