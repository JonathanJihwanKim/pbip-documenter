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

        // Build physical table lineage map: tableName → {physicalSchema, physicalTable, renames, ...}
        this.tableLineage = MExpressionParser.extractTableLineageFromModel(this.parsedModel);

        // Build M-step map: tableName → [{name, kind, exprText, refs}]
        this.mSteps = MExpressionParser.parseMStepsFromModel(this.parsedModel);

        // 1. Add data sources from M expressions
        this.dataSources = MExpressionParser.extractAllFromModel(this.parsedModel);
        // Build per-table source key map using fully resolved sources (handles params + shared exprs)
        this._tableSourceKeys = MExpressionParser.buildTableSourceKeyMap(this.parsedModel);
        // Issue #20: trace which loaded tables (transitively) reference each shared expression
        // so non-loaded data sources can attribute consumers.
        this._buildNonLoadedExpressionConsumers();
        for (const source of this.dataSources) {
            const id = `source:${MExpressionParser._sourceKey(source)}`;
            const sqlTableRefs = source.nativeQuery
                ? MExpressionParser._extractSQLTableRefs(source.nativeQuery)
                : [];
            this.nodes.set(id, {
                ...source,
                id,
                type: 'dataSource',
                name: this._formatSourceName(source),
                sourceType: source.type,
                sqlTableRefs: sqlTableRefs.length ? sqlTableRefs : undefined
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

            // Partitions → data sources (use pre-resolved key map to handle shared expressions + parameters)
            const tblLineage = this.tableLineage.get(table.name) || null;
            const srcKeys = this._tableSourceKeys?.get(table.name);
            if (srcKeys) {
                for (const srcKey of srcKeys) {
                    const sourceId = `source:${srcKey}`;
                    if (this.nodes.has(sourceId)) {
                        this.edges.push({
                            from: tableId,
                            to: sourceId,
                            type: 'connects_to_source',
                            physicalSchema:  tblLineage?.physicalSchema  || null,
                            physicalTable:   tblLineage?.physicalTable   || null,
                            physicalDataset: tblLineage?.physicalDataset || null,
                            physicalProject: tblLineage?.physicalProject || null,
                            renames:         tblLineage?.renames         || [],
                            selectedColumns: tblLineage?.selectedColumns || null,
                            addedColumns:    tblLineage?.addedColumns    || []
                        });
                    }
                }
            }

            // Column → physical-column edges
            // Emit for ALL model columns when we know the source table (not just renamed ones).
            // For renamed columns use the sourceName; otherwise default to the model column name.
            if (tblLineage && tblLineage.physicalTable) {
                const renameMap = new Map((tblLineage.renames || []).map(r => [r.modelName, r.sourceName]));
                const physPrefix = `${tblLineage.physicalSchema || ''}.${tblLineage.physicalTable}`;
                for (const col of table.columns) {
                    if (col.expression) continue; // calc columns handled separately below
                    const colId = `column:${table.name}.${col.name}`;
                    if (!this.nodes.has(colId)) continue;
                    const sourceName = renameMap.get(col.name) || col.name;
                    const physColId = `physicalColumn:${physPrefix}.${sourceName}`;
                    if (!this.nodes.has(physColId)) {
                        this.nodes.set(physColId, {
                            id: physColId,
                            type: 'physicalColumn',
                            name: sourceName,
                            physicalSchema:  tblLineage.physicalSchema,
                            physicalTable:   tblLineage.physicalTable,
                            physicalDataset: tblLineage.physicalDataset || null,
                            physicalProject: tblLineage.physicalProject || null
                        });
                    }
                    this.edges.push({
                        from: colId,
                        to: physColId,
                        type: 'maps_to_physical_column',
                        modelName: col.name,
                        sourceName
                    });
                }
            }

            // Calculated-column DAX edges
            for (const col of table.columns) {
                if (!col.expression) continue;
                const colKey = `${table.name}[${col.name}]`;
                const colId  = `column:${table.name}.${col.name}`;
                const refs   = this.measureRefs[colKey];
                if (!refs) continue;
                for (const cr of (refs.columnRefs || [])) {
                    this.edges.push({ from: colId, to: `column:${cr.table}.${cr.column}`, type: 'references_column' });
                }
                for (const mr of (refs.measureRefs || [])) {
                    const mt = this.measureLookup.get(mr);
                    if (mt) this.edges.push({ from: colId, to: `measure:${mt}.${mr}`, type: 'depends_on_measure' });
                }
                for (const tr of (refs.tableRefs || [])) {
                    this.edges.push({ from: colId, to: `table:${tr}`, type: 'references_table' });
                }
            }
        }

        // M-step join/merge edges: derived_from_table between model tables
        for (const [tableName, steps] of (this.mSteps || new Map())) {
            const tableId = `table:${tableName}`;
            if (!this.nodes.has(tableId)) continue;
            for (const step of steps) {
                for (const join of (step.joins || [])) {
                    // Map M step names to model table names via partition source cross-reference
                    for (const otherTable of this.parsedModel.tables) {
                        if (otherTable.name === tableName) continue;
                        // If another table's name appears as a step reference, link them
                        const otherStepNames = [join.leftStep, join.rightStep, ...(join.steps || [])];
                        if (otherStepNames.some(s => s && (s === otherTable.name || s.replace(/^#"(.+)"$/, '$1') === otherTable.name))) {
                            const otherId = `table:${otherTable.name}`;
                            if (this.nodes.has(otherId)) {
                                this.edges.push({ from: tableId, to: otherId, type: 'derived_from_table' });
                            }
                        }
                    }
                }
            }
        }

        // Calculated-table partition DAX edges: derived_from_table (L6)
        for (const table of this.parsedModel.tables) {
            const tableId = `table:${table.name}`;
            for (const partition of (table.partitions || [])) {
                if (partition.sourceType !== 'calculated') continue;
                if (!partition.source) continue;
                const refs = DAXReferenceExtractor.extract(partition.source);
                const refTables = new Set([
                    ...(refs.tableRefs || []),
                    ...(refs.columnRefs || []).map(cr => cr.table)
                ]);
                for (const tRef of refTables) {
                    const refId = `table:${tRef}`;
                    if (this.nodes.has(refId) && tRef !== table.name) {
                        this.edges.push({ from: tableId, to: refId, type: 'derived_from_table' });
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
                        table: table.name,
                        expression: item.expression || null
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
                    const isMeasureTarget = !!mTable;
                    if (mTable) {
                        // Use transitive resolution for deep measure chains
                        const chain = this.resolveMeasureChain(item.column);
                        const allMeasures = [{ name: item.column, table: mTable }, ...chain];
                        for (const m of allMeasures) {
                            const refs = this.measureRefs[m.name];
                            if (refs) {
                                for (const cr of refs.columnRefs) {
                                    if (!resolvedTables.includes(cr.table)) resolvedTables.push(cr.table);
                                }
                                for (const tr of refs.tableRefs) {
                                    if (!resolvedTables.includes(tr)) resolvedTables.push(tr);
                                }
                            }
                        }
                    }

                    this.nodes.set(id, {
                        id,
                        type: 'fpItem',
                        name: `${item.table}'[${item.column}]`,
                        table: item.table,
                        sourceTable: table.name,
                        targetType: isMeasureTarget ? 'measure' : 'column',
                        resolvedTables: resolvedTables.length > 0 ? resolvedTables : null
                    });

                    if (resolvedTables.length > 0) {
                        for (const rt of resolvedTables) {
                            this.edges.push({ from: id, to: `table:${rt}`, type: 'belongs_to_table' });
                        }
                    } else {
                        this.edges.push({ from: id, to: `table:${item.table}`, type: 'belongs_to_table' });
                    }

                    // Add resolves_to_measure edge if NAMEOF target is a measure
                    if (isMeasureTarget) {
                        const measureId = `measure:${mTable}.${item.column}`;
                        if (this.nodes.has(measureId)) {
                            this.edges.push({ from: id, to: measureId, type: 'resolves_to_measure' });
                        }
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

        // 6. Add modifies_measure edges: calc group items → measures on the same visual
        if (this.visualData && this._calcGroupTables.size > 0) {
            const addedModEdges = new Set(); // Global dedup across all visuals
            for (const visual of this.visualData.visuals) {
                const calcItemIds = [];
                const measureIds = [];
                for (const field of (visual.fields || [])) {
                    const tableName = field.table || field.entity || '';
                    const fieldName = field.name || field.column || '';
                    if (!tableName || !fieldName) continue;
                    if (field.type === 'measure') {
                        measureIds.push(`measure:${tableName}.${fieldName}`);
                    } else if (field.type === 'column' && this._calcGroupTables.has(tableName)) {
                        const cgItems = this._getCalculationGroupItems(tableName);
                        if (cgItems) {
                            for (const item of cgItems) {
                                calcItemIds.push(`calcItem:${tableName}.${item.name}`);
                            }
                        }
                    } else if (field.type === 'column') {
                        // Check if this column belongs to a field parameter table — resolve its measures
                        const fpItems = this._getFieldParameterItems ? this._getFieldParameterItems(tableName) : null;
                        if (fpItems && fpItems.length > 0) {
                            for (const item of fpItems) {
                                const mTable = this.measureLookup ? this.measureLookup.get(item.column) : null;
                                if (mTable) {
                                    measureIds.push(`measure:${mTable}.${item.column}`);
                                }
                            }
                        }
                    }
                }
                if (calcItemIds.length > 0 && measureIds.length > 0) {
                    for (const ciId of calcItemIds) {
                        for (const mId of measureIds) {
                            const key = `${ciId}\u2192${mId}`;
                            if (!addedModEdges.has(key)) {
                                addedModEdges.add(key);
                                this.edges.push({ from: ciId, to: mId, type: 'modifies_measure' });
                            }
                        }
                    }
                }
            }
        }

        // 7. Add has_relationship edges between tables
        for (const rel of (this.parsedModel.relationships || [])) {
            const fromId = `table:${rel.fromTable}`;
            const toId = `table:${rel.toTable}`;
            if (this.nodes.has(fromId) && this.nodes.has(toId)) {
                this.edges.push({
                    from: fromId, to: toId, type: 'has_relationship',
                    fromColumn: rel.fromColumn, toColumn: rel.toColumn,
                    fromCardinality: rel.fromCardinality, toCardinality: rel.toCardinality,
                    isActive: rel.isActive
                });
            }
        }

        // Detect broken/stale measure references
        this.brokenRefs = [];
        for (const edge of this.edges) {
            if (edge.type === 'uses_field' && !this.nodes.has(edge.to)) {
                this.brokenRefs.push({
                    visual: edge.from,
                    target: edge.to,
                    type: 'missing_node'
                });
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
                // Add calc group source table to the tables set
                tables.add(col.table);
                columnsToRemove.push(key);
                continue;
            }

            const fpItems = this._getFieldParameterItems(col.table);
            if (fpItems) {
                for (const item of fpItems) {
                    // Resolve: if NAMEOF references a measure, follow its DAX refs to data tables (transitive)
                    const resolvedTables = [];
                    const mTable = this.measureLookup.get(item.column);
                    if (mTable) {
                        const chain = this.resolveMeasureChain(item.column);
                        const allMeasures = [{ name: item.column, table: mTable }, ...chain];
                        for (const m of allMeasures) {
                            const refs = this.measureRefs[m.name];
                            if (refs) {
                                for (const cr of refs.columnRefs) {
                                    if (!resolvedTables.includes(cr.table)) resolvedTables.push(cr.table);
                                }
                                for (const tr of refs.tableRefs) {
                                    if (!resolvedTables.includes(tr)) resolvedTables.push(tr);
                                }
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

        // Remove FP *parameter* tables (sourceTable) from the diagram tables set —
        // they are already represented by fpItem nodes. Keep NAMEOF target tables
        // (fp.table, e.g. "Time Period") because they are the real data tables.
        if (expandedFPItems.length > 0) {
            const fpSourceTables = new Set(expandedFPItems.map(fp => fp.sourceTable));
            for (const ft of fpSourceTables) {
                const hasDirectColumn = Array.from(columns.values()).some(c => c.table === ft);
                if (!hasDirectColumn) {
                    tables.delete(ft);
                }
            }
        }

        // Build source-lookup set: union of diagram tables + FP NAMEOF targets + resolvedTables.
        // This is wider than `tables` so data sources are found even for tables removed from the
        // diagram for visual clarity.
        const sourceLookupTables = new Set(tables);
        for (const fp of expandedFPItems) {
            sourceLookupTables.add(fp.table);
            if (fp.resolvedTables) for (const rt of fp.resolvedTables) sourceLookupTables.add(rt);
        }

        // Resolve tables to sources (use engine's pre-built lineage to carry physical-table metadata)
        const tableSourceMap = {};
        const tableLineageMap = {};
        for (const tableName of sourceLookupTables) {
            tableSourceMap[tableName] = [];
            // Pull physical-table info from the pre-built tableLineage
            const tl = this.tableLineage?.get(tableName);
            if (tl) tableLineageMap[tableName] = tl;

            const table = this.parsedModel.tables.find(t => t.name === tableName);
            if (!table) continue;

            // Walk pre-built connects_to_source edges for this table
            const sid = `table:${tableName}`;
            for (const edge of this.edges) {
                if (edge.type !== 'connects_to_source' || edge.from !== sid) continue;
                const srcNode = this.nodes.get(edge.to);
                if (!srcNode) continue;
                const key = MExpressionParser._sourceKey(srcNode);
                if (!sources.has(key)) sources.set(key, srcNode);
                tableSourceMap[tableName].push(srcNode);
            }
        }

        // Collect physical columns reachable from columns in this trace
        const physicalColumns = new Map(); // physColId → node
        for (const [, col] of columns) {
            const colId = `column:${col.table}.${col.column}`;
            for (const edge of this.edges) {
                if (edge.type === 'maps_to_physical_column' && edge.from === colId) {
                    const physNode = this.nodes.get(edge.to);
                    if (physNode && !physicalColumns.has(edge.to)) {
                        physicalColumns.set(edge.to, physNode);
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
            physicalColumns: Array.from(physicalColumns.values()),
            tables: Array.from(tables).map(t => ({
                name: t,
                sources: tableSourceMap[t] || [],
                physicalSchema: tableLineageMap[t]?.physicalSchema || null,
                physicalTable: tableLineageMap[t]?.physicalTable || null,
                physicalDataset: tableLineageMap[t]?.physicalDataset || null,
                physicalProject: tableLineageMap[t]?.physicalProject || null,
                renames: tableLineageMap[t]?.renames || []
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
     * Reverse traversal - what measures/visuals depend on this column
     * @param {string} tableName
     * @param {string} columnName
     * @returns {Object} { column, directMeasures, directVisuals, transitiveVisuals }
     */
    getColumnImpact(tableName, columnName) {
        const columnId = `column:${tableName}.${columnName}`;

        // Find measures that directly reference this column
        const directMeasures = [];
        for (const edge of this.edges) {
            if (edge.type === 'references_column' && edge.to === columnId) {
                const mn = this.nodes.get(edge.from);
                if (mn) directMeasures.push({ name: mn.name, table: mn.table });
            }
        }

        // Find visuals that directly use this column
        const directVisuals = [];
        for (const edge of this.edges) {
            if (edge.type === 'uses_field' && edge.to === columnId) {
                const vn = this.nodes.get(edge.from);
                if (vn) directVisuals.push({ name: vn.name, page: vn.pageName, type: vn.visualType });
            }
        }

        // Find visuals that use this column transitively through measures
        const transitiveVisuals = [];
        const directVisualKeys = new Set(directVisuals.map(v => `${v.page}|${v.name}`));
        for (const dm of directMeasures) {
            const impact = this.getMeasureImpact(dm.name);
            for (const v of impact.visuals) {
                const key = `${v.page}|${v.name}`;
                if (!directVisualKeys.has(key) && !transitiveVisuals.some(tv => tv.page === v.page && tv.name === v.name)) {
                    transitiveVisuals.push({ name: v.name, page: v.page, type: v.type, indirect: true, via: dm.name });
                }
            }
        }

        // Upstream: find physical column(s) this model column maps to
        const physicalColumns = [];
        for (const edge of this.edges) {
            if (edge.type === 'maps_to_physical_column' && edge.from === columnId) {
                const physNode = this.nodes.get(edge.to);
                if (physNode) physicalColumns.push(physNode);
            }
        }

        return {
            column: { table: tableName, name: columnName },
            physicalColumns,
            directMeasures,
            directVisuals,
            transitiveVisuals
        };
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
     * Catalog: which model tables / measures / visuals / pages consume a given data source.
     * Pure listing — no impact framing.
     * @param {string} sourceId - e.g. "source:sql server|srv|db"
     * @returns {{ tables: Array, measures: Array, visuals: Array, pages: string[] }}
     */
    getDataSourceConsumers(sourceId) {
        const srcNode = this.nodes.get(sourceId);
        // 1. Model tables that connect to this source
        const tables = [];
        if (srcNode && srcNode.isNonLoadedQuery && srcNode.expressionName) {
            // Non-loaded source: consumers are loaded tables that transitively reference this expression name
            const tableNames = this._expressionConsumers?.get(srcNode.expressionName) || new Set();
            for (const name of tableNames) {
                const tblLineage = this.tableLineage?.get(name) || null;
                tables.push({
                    name,
                    physicalSchema: tblLineage?.physicalSchema || null,
                    physicalTable:  tblLineage?.physicalTable  || null,
                    renames: [],
                    selectedColumns: null,
                    addedColumns: []
                });
            }
        } else {
            for (const edge of this.edges) {
                if (edge.type === 'connects_to_source' && edge.to === sourceId) {
                    const node = this.nodes.get(edge.from);
                    if (node) tables.push({
                        name: node.name,
                        physicalSchema: edge.physicalSchema || null,
                        physicalTable:  edge.physicalTable  || null,
                        renames: edge.renames || [],
                        selectedColumns: edge.selectedColumns || null,
                        addedColumns: edge.addedColumns || []
                    });
                }
            }
        }

        // 2. Measures that reference those tables (directly or via column refs)
        const tableIds = new Set(tables.map(t => `table:${t.name}`));
        const measuresSet = new Set();
        for (const edge of this.edges) {
            if ((edge.type === 'defined_in_table' || edge.type === 'references_table') && tableIds.has(edge.to)) {
                const mn = this.nodes.get(edge.from);
                if (mn && mn.type === 'measure') measuresSet.add(`${mn.table}|${mn.name}`);
            }
        }
        // Also via references_column → column belongs_to_table
        for (const edge of this.edges) {
            if (edge.type === 'references_column') {
                const colNode = this.nodes.get(edge.to);
                if (colNode && tableIds.has(`table:${colNode.table}`)) {
                    const mn = this.nodes.get(edge.from);
                    if (mn && mn.type === 'measure') measuresSet.add(`${mn.table}|${mn.name}`);
                }
            }
        }
        const measures = [...measuresSet].map(k => {
            const [table, name] = k.split('|');
            return { name, table };
        });

        // 3. Visuals that use columns/measures from those tables
        const visualsSet = new Set();
        const pagesSet   = new Set();
        for (const edge of this.edges) {
            if (edge.type === 'uses_field') {
                const target = this.nodes.get(edge.to);
                if (!target) continue;
                const belongsToSource = tableIds.has(`table:${target.table}`)
                    || (target.type === 'column'  && tableIds.has(`table:${target.table}`))
                    || (target.type === 'measure' && measuresSet.has(`${target.table}|${target.name}`));
                if (belongsToSource) {
                    const vn = this.nodes.get(edge.from);
                    if (vn && vn.type === 'visual') {
                        visualsSet.add(`${vn.pageName}|${vn.name}`);
                        pagesSet.add(vn.pageName);
                    }
                }
            }
        }
        const visuals = [...visualsSet].map(k => {
            const sep = k.indexOf('|');
            return { page: k.slice(0, sep), name: k.slice(sep + 1) };
        });

        return { tables, measures, visuals, pages: [...pagesSet] };
    }

    /**
     * Catalog: which measures / visuals use a given model column.
     * Thin wrapper over getColumnImpact — re-labels for "Where Used" context.
     * @param {string} tableName
     * @param {string} columnName
     * @returns {{ measures: Array, directVisuals: Array, allVisuals: Array, pages: string[] }}
     */
    getColumnConsumers(tableName, columnName) {
        const impact = this.getColumnImpact(tableName, columnName);
        const allVisuals = [...impact.directVisuals, ...impact.transitiveVisuals];
        const pages = [...new Set(allVisuals.map(v => v.page))];
        return {
            measures:     impact.directMeasures,
            directVisuals: impact.directVisuals,
            allVisuals,
            pages
        };
    }

    /**
     * Catalog: which model tables consume a given physical source table.
     * @param {string} physicalTable - e.g. "FactSales"
     * @param {string} [physicalSchema] - optional schema filter e.g. "dbo"
     * @returns {{ modelTables: Array, measures: Array, visuals: Array, pages: string[] }}
     */
    getPhysicalTableConsumers(physicalTable, physicalSchema) {
        const matchingSourceIds = new Set();
        for (const edge of this.edges) {
            if (edge.type === 'connects_to_source') {
                const ptMatch = edge.physicalTable && edge.physicalTable.toLowerCase() === physicalTable.toLowerCase();
                const psMatch = !physicalSchema || !edge.physicalSchema ||
                    edge.physicalSchema.toLowerCase() === physicalSchema.toLowerCase();
                if (ptMatch && psMatch) matchingSourceIds.add(edge.to);
            }
        }

        const combined = { tables: [], measures: [], visuals: [], pages: [] };
        const measuresSet = new Set();
        const visualsSet  = new Set();
        const pagesSet    = new Set();

        for (const sourceId of matchingSourceIds) {
            const consumers = this.getDataSourceConsumers(sourceId);
            for (const t of consumers.tables) {
                if (!combined.tables.some(x => x.name === t.name)) combined.tables.push(t);
            }
            for (const m of consumers.measures) {
                const key = `${m.table}|${m.name}`;
                if (!measuresSet.has(key)) { measuresSet.add(key); combined.measures.push(m); }
            }
            for (const v of consumers.visuals) {
                const key = `${v.page}|${v.name}`;
                if (!visualsSet.has(key)) { visualsSet.add(key); combined.visuals.push(v); }
            }
            for (const p of consumers.pages) {
                if (!pagesSet.has(p)) { pagesSet.add(p); combined.pages.push(p); }
            }
        }
        return combined;
    }

    /**
     * Return the top N measures ranked by number of visuals that display them.
     * @param {number} n
     * @returns {Array<{name:string, table:string, visualCount:number, pageCount:number}>}
     */
    getTopMeasuresByVisualCount(n = 5) {
        if (!this.visualData) return [];
        const counts = new Map(); // "table|measure" → { name, table, visuals: Set, pages: Set }
        for (const visual of this.visualData.visuals) {
            for (const field of (visual.fields || [])) {
                if (field.type !== 'measure') continue;
                const key = `${field.table || field.entity}|${field.name}`;
                if (!counts.has(key)) counts.set(key, {
                    name:  field.name,
                    table: field.table || field.entity,
                    visuals: new Set(),
                    pages:   new Set()
                });
                counts.get(key).visuals.add(visual.visualName);
                counts.get(key).pages.add(visual.pageName);
            }
        }
        return [...counts.values()]
            .map(c => ({ name: c.name, table: c.table, visualCount: c.visuals.size, pageCount: c.pages.size }))
            .sort((a, b) => b.visualCount - a.visualCount || b.pageCount - a.pageCount)
            .slice(0, n);
    }

    /**
     * Return the top N source tables ranked by number of consuming visuals.
     * @param {number} n
     * @returns {Array<{physicalTable:string, physicalSchema:string|null, modelTable:string, visualCount:number, measureCount:number}>}
     */
    getTopSourceTablesByConsumption(n = 5) {
        const seen = new Map(); // "schema|table" → entry
        for (const edge of this.edges) {
            if (edge.type !== 'connects_to_source' || !edge.physicalTable) continue;
            const key = `${edge.physicalSchema || ''}|${edge.physicalTable}`;
            if (!seen.has(key)) {
                const consumers = this.getPhysicalTableConsumers(edge.physicalTable, edge.physicalSchema);
                seen.set(key, {
                    physicalTable:  edge.physicalTable,
                    physicalSchema: edge.physicalSchema || null,
                    modelTable:     (this.nodes.get(edge.from) || {}).name || '',
                    visualCount:    consumers.visuals.length,
                    measureCount:   consumers.measures.length
                });
            }
        }
        return [...seen.values()]
            .sort((a, b) => b.visualCount - a.visualCount || b.measureCount - a.measureCount)
            .slice(0, n);
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
     * Build a map of shared expression name → Set<loaded table name> that transitively
     * references the expression in its M body. Used to attribute consumers to non-loaded
     * data sources (Issue #20).
     */
    _buildNonLoadedExpressionConsumers() {
        const expressionBodies = {};
        const expressionNames = [];
        for (const expr of (this.parsedModel.expressions || [])) {
            if (expr.name && expr.expression) {
                expressionBodies[expr.name] = expr.expression;
                expressionNames.push(expr.name);
            }
        }

        const findRefs = (mText) => {
            const refs = new Set();
            if (!mText) return refs;
            for (const name of expressionNames) {
                const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pat = new RegExp(`#"${escaped}"|\\b${escaped}\\b`);
                if (pat.test(mText)) refs.add(name);
            }
            return refs;
        };

        const expressionConsumers = new Map(); // exprName → Set<tableName>

        for (const table of (this.parsedModel.tables || [])) {
            for (const partition of (table.partitions || [])) {
                if (!partition.source) continue;
                const allRefs = new Set();
                const queue = [...findRefs(partition.source)];
                while (queue.length) {
                    const cur = queue.shift();
                    if (allRefs.has(cur)) continue;
                    allRefs.add(cur);
                    const next = findRefs(expressionBodies[cur]);
                    for (const n of next) {
                        if (!allRefs.has(n)) queue.push(n);
                    }
                }
                for (const r of allRefs) {
                    if (!expressionConsumers.has(r)) expressionConsumers.set(r, new Set());
                    expressionConsumers.get(r).add(table.name);
                }
            }
        }
        this._expressionConsumers = expressionConsumers;
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
