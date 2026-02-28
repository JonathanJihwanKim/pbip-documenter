/**
 * Lineage Engine Module
 * Builds a complete dependency graph from visuals to data sources
 */

class LineageEngine {
    /**
     * @param {Object} parsedModel - From TMDLParser.parseAll()
     * @param {Object} visualData - From VisualParser.parseReport() (optional)
     * @param {Object} measureRefs - From TMDLParser.extractAllReferences() (optional)
     */
    constructor(parsedModel, visualData, measureRefs) {
        this.parsedModel = parsedModel;
        this.visualData = visualData || null;
        this.measureRefs = measureRefs || {};

        // Graph storage
        this.nodes = new Map(); // id → { id, type, name, table?, ... }
        this.edges = []; // [{ from, to, type }]

        // Lookups
        this.measureLookup = null; // measureName → tableName
        this.dataSources = [];

        // Memoization caches
        this._measureChainCache = new Map();
        this._visualLineageCache = new Map();
        this._measureImpactCache = new Map();
    }

    /**
     * Build the full dependency graph
     */
    buildGraph() {
        this.measureLookup = DAXReferenceExtractor.buildMeasureLookup(this.parsedModel.tables);

        // 1. Add data sources from M expressions
        this.dataSources = MExpressionParser.extractAllFromModel(this.parsedModel);
        for (const source of this.dataSources) {
            const id = `source:${MExpressionParser._sourceKey(source)}`;
            this.nodes.set(id, {
                ...source,
                id,
                type: 'dataSource',
                name: this._formatSourceName(source),
                sourceType: source.type
            });
        }

        // 2. Add tables, columns, measures, partitions
        for (const table of this.parsedModel.tables) {
            const tableId = `table:${table.name}`;
            this.nodes.set(tableId, {
                id: tableId,
                type: 'table',
                name: table.name,
                columnCount: table.columns.length,
                measureCount: table.measures.length
            });

            // Columns
            for (const col of table.columns) {
                const colId = `column:${table.name}.${col.name}`;
                this.nodes.set(colId, {
                    id: colId,
                    type: 'column',
                    name: col.name,
                    table: table.name,
                    dataType: col.dataType
                });
                this.edges.push({ from: colId, to: tableId, type: 'belongs_to_table' });
            }

            // Measures
            for (const measure of table.measures) {
                const measureId = `measure:${table.name}.${measure.name}`;
                this.nodes.set(measureId, {
                    id: measureId,
                    type: 'measure',
                    name: measure.name,
                    table: table.name,
                    expression: measure.expression
                });
                // Connect measure to DAX-referenced tables (not the defining table)
                const refs = this.measureRefs[measure.name];
                const daxTables = new Set();
                if (refs) {
                    for (const cr of refs.columnRefs) daxTables.add(cr.table);
                    for (const tr of refs.tableRefs) daxTables.add(tr);
                }
                // Transitive: collect tables from chained measures
                const chain = this.resolveMeasureChain(measure.name);
                for (const m of chain) {
                    const mRefs = this.measureRefs[m.name];
                    if (mRefs) {
                        for (const cr of mRefs.columnRefs) daxTables.add(cr.table);
                        for (const tr of mRefs.tableRefs) daxTables.add(tr);
                    }
                }
                if (daxTables.size > 0) {
                    for (const dt of daxTables) {
                        this.edges.push({ from: measureId, to: `table:${dt}`, type: 'defined_in_table' });
                    }
                } else {
                    // Fallback for measures with no DAX refs (e.g., constant `= 42`)
                    this.edges.push({ from: measureId, to: tableId, type: 'defined_in_table' });
                }
                if (refs) {
                    // Column references
                    for (const colRef of refs.columnRefs) {
                        const refColId = `column:${colRef.table}.${colRef.column}`;
                        this.edges.push({ from: measureId, to: refColId, type: 'references_column' });
                    }
                    // Measure references
                    for (const mRef of refs.measureRefs) {
                        const refTable = this.measureLookup.get(mRef);
                        if (refTable) {
                            const refMeasureId = `measure:${refTable}.${mRef}`;
                            this.edges.push({ from: measureId, to: refMeasureId, type: 'depends_on_measure' });
                        }
                    }
                    // Table references (from DAX functions)
                    for (const tRef of refs.tableRefs) {
                        const refTableId = `table:${tRef}`;
                        this.edges.push({ from: measureId, to: refTableId, type: 'references_table' });
                    }
                }
            }

            // Partitions → data sources
            for (const partition of table.partitions) {
                if (partition.source) {
                    const sources = MExpressionParser.extractDataSources(partition.source);
                    for (const src of sources) {
                        const sourceId = `source:${MExpressionParser._sourceKey(src)}`;
                        if (this.nodes.has(sourceId)) {
                            this.edges.push({ from: tableId, to: sourceId, type: 'connects_to_source' });
                        }
                    }
                }
            }
        }

        // 3. Add expressions (parameters)
        for (const expr of (this.parsedModel.expressions || [])) {
            const exprId = `expression:${expr.name}`;
            this.nodes.set(exprId, {
                id: exprId,
                type: 'expression',
                name: expr.name,
                kind: expr.kind,
                expression: expr.expression
            });
        }

        // 4. Expand calc groups and field parameters into graph nodes
        this._calcGroupTables = new Set();
        this._fieldParamTables = new Set();
        for (const table of this.parsedModel.tables) {
            const cgItems = this._getCalculationGroupItems(table.name);
            if (cgItems) {
                this._calcGroupTables.add(table.name);
                for (const item of cgItems) {
                    const id = `calcItem:${table.name}.${item.name}`;
                    this.nodes.set(id, {
                        id,
                        type: 'calcItem',
                        name: item.name,
                        table: table.name
                    });
                    this.edges.push({ from: id, to: `table:${table.name}`, type: 'belongs_to_table' });
                }
                continue;
            }

            const fpItems = this._getFieldParameterItems(table.name);
            if (fpItems) {
                this._fieldParamTables.add(table.name);
                for (const item of fpItems) {
                    const id = `fpItem:${table.name}.${item.table}.${item.column}`;

                    // Resolve: if NAMEOF references a measure, follow its DAX refs to data tables
                    const resolvedTables = [];
                    const mTable = this.measureLookup.get(item.column);
                    if (mTable) {
                        const refs = this.measureRefs[item.column];
                        if (refs) {
                            for (const cr of refs.columnRefs) {
                                if (!resolvedTables.includes(cr.table)) resolvedTables.push(cr.table);
                            }
                            for (const tr of refs.tableRefs) {
                                if (!resolvedTables.includes(tr)) resolvedTables.push(tr);
                            }
                        }
                    }

                    this.nodes.set(id, {
                        id,
                        type: 'fpItem',
                        name: `${item.table}'[${item.column}]`,
                        table: item.table,
                        sourceTable: table.name,
                        resolvedTables: resolvedTables.length > 0 ? resolvedTables : null
                    });

                    if (resolvedTables.length > 0) {
                        for (const rt of resolvedTables) {
                            this.edges.push({ from: id, to: `table:${rt}`, type: 'belongs_to_table' });
                        }
                    } else {
                        this.edges.push({ from: id, to: `table:${item.table}`, type: 'belongs_to_table' });
                    }
                }
            }
        }

        // 5. Add visuals
        if (this.visualData) {
            for (const visual of this.visualData.visuals) {
                const visualId = `visual:${visual.pageName}|${visual.visualName}`;
                this.nodes.set(visualId, {
                    id: visualId,
                    type: 'visual',
                    name: visual.visualName,
                    pageName: visual.pageName,
                    visualType: visual.visualType
                });

                // Visual → field edges
                for (const field of (visual.fields || [])) {
                    const tableName = field.table || field.entity || '';
                    const fieldName = field.name || field.column || field.hierarchy || '';
                    if (!tableName || !fieldName) continue;

                    if (field.type === 'measure') {
                        const measureId = `measure:${tableName}.${fieldName}`;
                        this.edges.push({ from: visualId, to: measureId, type: 'uses_field' });
                    } else if (field.type === 'column') {
                        // Redirect calc group / field param columns to expanded items
                        if (this._calcGroupTables.has(tableName)) {
                            const cgItems = this._getCalculationGroupItems(tableName);
                            if (cgItems) {
                                for (const item of cgItems) {
                                    const ciId = `calcItem:${tableName}.${item.name}`;
                                    this.edges.push({ from: visualId, to: ciId, type: 'uses_field' });
                                }
                            }
                        } else if (this._fieldParamTables.has(tableName)) {
                            const fpItems = this._getFieldParameterItems(tableName);
                            if (fpItems) {
                                for (const item of fpItems) {
                                    const fpId = `fpItem:${tableName}.${item.table}.${item.column}`;
                                    this.edges.push({ from: visualId, to: fpId, type: 'uses_field' });
                                }
                            }
                        } else {
                            const colId = `column:${tableName}.${fieldName}`;
                            this.edges.push({ from: visualId, to: colId, type: 'uses_field' });
                        }
                    } else if (field.type === 'hierarchy') {
                        // Link to table
                        const tblId = `table:${tableName}`;
                        this.edges.push({ from: visualId, to: tblId, type: 'uses_field' });
                    }
                }
            }
        }
    }

    /**
     * Resolve the full transitive dependency chain for a measure
     * @param {string} measureName
     * @param {Set} visited - For cycle detection
     * @returns {Array<{name: string, table: string}>}
     */
    resolveMeasureChain(measureName, visited = new Set()) {
        if (this._measureChainCache.has(measureName) && visited.size === 0) {
            return this._measureChainCache.get(measureName);
        }

        if (visited.has(measureName)) return []; // Cycle detected
        visited.add(measureName);

        const chain = [];
        const refs = this.measureRefs[measureName];
        if (!refs) return chain;

        for (const refMeasure of refs.measureRefs) {
            const refTable = this.measureLookup.get(refMeasure);
            if (refTable) {
                chain.push({ name: refMeasure, table: refTable });
                // Recurse
                const subChain = this.resolveMeasureChain(refMeasure, new Set(visited));
                chain.push(...subChain);
            }
        }

        // Deduplicate
        const seen = new Set();
        const deduped = chain.filter(m => {
            const key = `${m.table}.${m.name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        if (visited.size === 1) {
            this._measureChainCache.set(measureName, deduped);
        }

        return deduped;
    }

    /**
     * Get full lineage trace from a visual to data sources
     * @param {string} pageName
     * @param {string} visualName
     * @returns {Object} Structured lineage tree
     */
    getVisualLineage(pageName, visualName) {
        const cacheKey = `${pageName}|${visualName}`;
        if (this._visualLineageCache.has(cacheKey)) {
            return this._visualLineageCache.get(cacheKey);
        }

        const visual = this.visualData?.visuals.find(
            v => v.pageName === pageName && v.visualName === visualName
        );
        if (!visual) return null;

        const measures = new Map(); // measureName → { name, table, chain }
        const columns = new Map(); // table.column → { table, column }
        const tables = new Set(); // table names
        const sources = new Map(); // source key → source obj

        for (const field of (visual.fields || [])) {
            const tableName = field.table || field.entity || '';
            const fieldName = field.name || field.column || field.hierarchy || '';
            if (!tableName || !fieldName) continue;

            if (field.type === 'measure') {
                if (!measures.has(fieldName)) {
                    const chain = this.resolveMeasureChain(fieldName);
                    measures.set(fieldName, { name: fieldName, table: tableName, chain });

                    // Collect tables from measure references
                    // Skip adding the defining table if it's a field parameter table
                    // (fpItem expansion already links to the real data tables)
                    if (!this._fieldParamTables.has(tableName)) {
                        tables.add(tableName);
                    }
                    const refs = this.measureRefs[fieldName];
                    if (refs) {
                        for (const cr of refs.columnRefs) tables.add(cr.table);
                        for (const tr of refs.tableRefs) tables.add(tr);
                    }
                    // Tables from chain
                    for (const m of chain) {
                        if (!this._fieldParamTables.has(m.table)) {
                            tables.add(m.table);
                        }
                        const mRefs = this.measureRefs[m.name];
                        if (mRefs) {
                            for (const cr of mRefs.columnRefs) tables.add(cr.table);
                            for (const tr of mRefs.tableRefs) tables.add(tr);
                        }
                    }
                }
            } else {
                const key = `${tableName}.${fieldName}`;
                if (!columns.has(key)) {
                    columns.set(key, { table: tableName, column: fieldName });
                }
                tables.add(tableName);
            }
        }

        // Expand calc group and field parameter columns
        const expandedCalcItems = [];
        const expandedFPItems = [];
        const columnsToRemove = [];

        for (const [key, col] of columns) {
            const cgItems = this._getCalculationGroupItems(col.table);
            if (cgItems) {
                for (const item of cgItems) {
                    expandedCalcItems.push({
                        name: item.name,
                        expression: item.expression || '',
                        sourceTable: col.table
                    });
                }
                columnsToRemove.push(key);
                continue;
            }

            const fpItems = this._getFieldParameterItems(col.table);
            if (fpItems) {
                for (const item of fpItems) {
                    // Resolve: if NAMEOF references a measure, follow its DAX refs to data tables
                    const resolvedTables = [];
                    const mTable = this.measureLookup.get(item.column);
                    if (mTable) {
                        const refs = this.measureRefs[item.column];
                        if (refs) {
                            for (const cr of refs.columnRefs) {
                                if (!resolvedTables.includes(cr.table)) resolvedTables.push(cr.table);
                            }
                            for (const tr of refs.tableRefs) {
                                if (!resolvedTables.includes(tr)) resolvedTables.push(tr);
                            }
                        }
                    }

                    expandedFPItems.push({
                        table: item.table,
                        column: item.column,
                        sourceTable: col.table,
                        resolvedTables: resolvedTables.length > 0 ? resolvedTables : null
                    });

                    // Add resolved data tables (or fallback NAMEOF table) to the tables set
                    if (resolvedTables.length > 0) {
                        for (const rt of resolvedTables) tables.add(rt);
                    } else {
                        tables.add(item.table); // only include defining table as fallback
                    }
                }
                columnsToRemove.push(key);
                continue;
            }
        }

        for (const key of columnsToRemove) {
            columns.delete(key);
        }

        // Remove tables that only appear as NAMEOF targets of field param items.
        // These measures are already represented by fpItem nodes; removing the
        // defining table forces the diagram to draw edges to DAX-referenced
        // data tables instead (e.g. sales instead of Measure).
        if (expandedFPItems.length > 0) {
            const fpNameofTables = new Set(expandedFPItems.map(fp => fp.table));
            for (const ft of fpNameofTables) {
                const hasDirectColumn = Array.from(columns.values()).some(c => c.table === ft);
                if (!hasDirectColumn) {
                    tables.delete(ft);
                }
            }
        }

        // Resolve tables to sources
        const tableSourceMap = {};
        for (const tableName of tables) {
            const table = this.parsedModel.tables.find(t => t.name === tableName);
            if (!table) continue;
            tableSourceMap[tableName] = [];
            for (const partition of (table.partitions || [])) {
                if (partition.source) {
                    const partSources = MExpressionParser.extractDataSources(partition.source);
                    for (const src of partSources) {
                        const key = MExpressionParser._sourceKey(src);
                        if (!sources.has(key)) {
                            sources.set(key, src);
                        }
                        tableSourceMap[tableName].push(src);
                    }
                }
            }
        }

        const result = {
            visual: { name: visualName, page: pageName, type: visual.visualType },
            measures: Array.from(measures.values()),
            columns: Array.from(columns.values()),
            expandedCalcItems,
            expandedFPItems,
            tables: Array.from(tables).map(t => ({
                name: t,
                sources: tableSourceMap[t] || []
            })),
            dataSources: Array.from(sources.values())
        };

        this._visualLineageCache.set(cacheKey, result);
        return result;
    }

    /**
     * Reverse traversal - what visuals/measures depend on this measure
     * @param {string} measureName
     * @returns {Object} { visuals, dependentMeasures }
     */
    getMeasureImpact(measureName) {
        if (this._measureImpactCache.has(measureName)) {
            return this._measureImpactCache.get(measureName);
        }

        const tableName = this.measureLookup.get(measureName);
        if (!tableName) return { visuals: [], dependentMeasures: [] };

        const measureId = `measure:${tableName}.${measureName}`;

        // Find measures that depend on this measure
        const dependentMeasures = [];
        for (const [mName, refs] of Object.entries(this.measureRefs)) {
            if (refs.measureRefs.includes(measureName)) {
                const mTable = this.measureLookup.get(mName);
                if (mTable) {
                    dependentMeasures.push({ name: mName, table: mTable });
                }
            }
        }

        // Find visuals that use this measure directly
        const visuals = [];
        if (this.visualData) {
            for (const visual of this.visualData.visuals) {
                for (const field of (visual.fields || [])) {
                    const fName = field.name || field.column || '';
                    const fTable = field.table || field.entity || '';
                    if (field.type === 'measure' && fName === measureName && fTable === tableName) {
                        visuals.push({
                            name: visual.visualName,
                            page: visual.pageName,
                            type: visual.visualType
                        });
                        break;
                    }
                }
            }

            // Also find visuals that use dependent measures (transitive)
            for (const dm of dependentMeasures) {
                for (const visual of this.visualData.visuals) {
                    const alreadyAdded = visuals.some(
                        v => v.name === visual.visualName && v.page === visual.pageName
                    );
                    if (alreadyAdded) continue;

                    for (const field of (visual.fields || [])) {
                        const fName = field.name || field.column || '';
                        const fTable = field.table || field.entity || '';
                        if (field.type === 'measure' && fName === dm.name && fTable === dm.table) {
                            visuals.push({
                                name: visual.visualName,
                                page: visual.pageName,
                                type: visual.visualType,
                                indirect: true,
                                via: dm.name
                            });
                            break;
                        }
                    }
                }
            }
        }

        const result = { visuals, dependentMeasures };
        this._measureImpactCache.set(measureName, result);
        return result;
    }

    /**
     * Trace a single field to its source
     * @param {string} type - 'measure', 'column', or 'hierarchy'
     * @param {string} table - Table name
     * @param {string} field - Field name
     * @returns {Object} Lineage info
     */
    getFieldLineage(type, table, field) {
        if (type === 'measure') {
            const chain = this.resolveMeasureChain(field);
            const tables = new Set([table]);
            const refs = this.measureRefs[field];
            if (refs) {
                for (const cr of refs.columnRefs) tables.add(cr.table);
                for (const tr of refs.tableRefs) tables.add(tr);
            }
            for (const m of chain) {
                tables.add(m.table);
            }

            const sources = [];
            for (const tName of tables) {
                const tbl = this.parsedModel.tables.find(t => t.name === tName);
                if (tbl) {
                    for (const p of (tbl.partitions || [])) {
                        if (p.source) sources.push(...MExpressionParser.extractDataSources(p.source));
                    }
                }
            }

            return {
                type: 'measure',
                name: field,
                table,
                chain,
                tables: Array.from(tables),
                dataSources: MExpressionParser.deduplicateSources(sources)
            };
        }

        // Column or hierarchy → just trace to table's source
        const tbl = this.parsedModel.tables.find(t => t.name === table);
        const sources = [];
        if (tbl) {
            for (const p of (tbl.partitions || [])) {
                if (p.source) sources.push(...MExpressionParser.extractDataSources(p.source));
            }
        }

        return {
            type,
            name: field,
            table,
            dataSources: MExpressionParser.deduplicateSources(sources)
        };
    }

    /**
     * Get all deduplicated data sources from the model
     * @returns {Array}
     */
    getAllDataSources() {
        return this.dataSources;
    }

    /**
     * Get a compact lineage summary for a visual
     * @param {string} pageName
     * @param {string} visualName
     * @returns {string} e.g. "3 measures → 2 tables → 1 source"
     */
    getLineageSummary(pageName, visualName) {
        const lineage = this.getVisualLineage(pageName, visualName);
        if (!lineage) return '';

        const parts = [];
        if (lineage.measures.length > 0) {
            parts.push(`${lineage.measures.length} measure${lineage.measures.length !== 1 ? 's' : ''}`);
        }
        const colCount = lineage.columns.length + (lineage.expandedCalcItems || []).length + (lineage.expandedFPItems || []).length;
        if (colCount > 0) {
            parts.push(`${colCount} column${colCount !== 1 ? 's' : ''}`);
        }
        if (lineage.tables.length > 0) {
            parts.push(`${lineage.tables.length} table${lineage.tables.length !== 1 ? 's' : ''}`);
        }
        if (lineage.dataSources.length > 0) {
            parts.push(`${lineage.dataSources.length} source${lineage.dataSources.length !== 1 ? 's' : ''}`);
        }

        return parts.join(' \u2192 ');
    }

    /**
     * Returns NAMEOF field items for a field parameter table, or null if not a field parameter.
     */
    _getFieldParameterItems(tableName) {
        const table = this.parsedModel.tables.find(t => t.name === tableName);
        if (!table) return null;

        const allExpressions = [];
        for (const col of table.columns) {
            if (col.expression) allExpressions.push(col.expression);
        }
        for (const part of table.partitions) {
            if (part.source) allExpressions.push(part.source);
        }

        const isFieldParam = allExpressions.some(expr => /NAMEOF|SWITCH/i.test(expr));
        if (!isFieldParam) return null;

        const items = [];
        for (const expr of allExpressions) {
            const matches = [...expr.matchAll(/NAMEOF\s*\(\s*'([^']+)'\[([^\]]+)\]\s*\)/gi)];
            for (const m of matches) items.push({ table: m[1], column: m[2] });
        }
        return items.length > 0 ? items : null;
    }

    /**
     * Returns calculation group items for a table, or null if not a calc group table.
     */
    _getCalculationGroupItems(tableName) {
        const table = this.parsedModel.tables.find(t => t.name === tableName);
        if (!table || !table.calculationGroup || !table.calculationGroup.items || table.calculationGroup.items.length === 0) return null;
        return table.calculationGroup.items;
    }

    /**
     * Format a data source name for display
     */
    _formatSourceName(source) {
        const parts = [source.type];
        const server = source.serverResolved || source.server;
        const db = source.databaseResolved || source.database;
        if (server) parts.push(server);
        if (db) parts.push(db);
        if (source.url) parts.push(source.url);
        if (source.path) parts.push(source.path);
        return parts.join(': ');
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LineageEngine;
}
