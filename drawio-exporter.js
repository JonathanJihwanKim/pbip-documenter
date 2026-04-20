/**
 * DrawioExporter — Exports semantic model data as draw.io compatible XML (.drawio)
 * Part of PBIP Documenter by Jihwan Kim (Microsoft MVP)
 *
 * Generates two diagram types:
 *   1. ERD (Entity Relationship Diagram) — tables, columns, relationships
 *   2. Lineage — data sources → tables → measures → visuals (left-to-right)
 */
class DrawioExporter {
    constructor(parsedModel, lineageEngine) {
        this.parsedModel = parsedModel;
        this.lineageEngine = lineageEngine;
        this._idCounter = 2; // 0 and 1 are reserved for root cells
    }

    // ─── Public API ─────────────────────────────────────────────────────

    /**
     * Generate an ERD diagram as draw.io XML.
     * Includes tables participating in relationships or having measures,
     * with auto star-schema layout.
     * @returns {string} draw.io XML
     */
    generateERD() {
        const tables = this.parsedModel.tables || [];
        const relationships = this.parsedModel.relationships || [];

        // Build lookup: which columns are FK/PK per table
        const fkColumns = new Map(); // tableName -> Set of column names
        const pkColumns = new Map();
        for (const rel of relationships) {
            if (!fkColumns.has(rel.fromTable)) fkColumns.set(rel.fromTable, new Set());
            fkColumns.get(rel.fromTable).add(rel.fromColumn);
            if (!pkColumns.has(rel.toTable)) pkColumns.set(rel.toTable, new Set());
            pkColumns.get(rel.toTable).add(rel.toColumn);
        }

        // Determine which tables to include: those in relationships or with measures
        const relTableNames = new Set();
        for (const rel of relationships) {
            relTableNames.add(rel.fromTable);
            relTableNames.add(rel.toTable);
        }
        // Include all non-auto-date tables — same set as on-screen renderer (D6)
        const includedTables = tables.filter(t => !t._isAutoDate);

        // Layout: find fact table, arrange dimensions around it
        const layout = this._computeERDLayout(includedTables, relationships);

        // Build XML cells
        const cells = [];
        const tableIdMap = new Map(); // tableName -> cellId

        for (const entry of layout) {
            const table = entry.table;
            const tableId = this._nextId('table_' + this._sanitizeId(table.name));
            tableIdMap.set(table.name, tableId);

            const displayColumns = this._getDisplayColumns(table, fkColumns, pkColumns);
            const tableHeight = 30 + displayColumns.length * 26;
            const tableWidth = 220;

            // Table container
            const isHiddenStyle = table.isHidden ? 'opacity=60;' : '';
            cells.push(this._mxCell(tableId, this._escapeXml(table.name),
                `shape=table;startSize=30;container=1;collapsible=1;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;fillColor=#1a3a5c;fontColor=#ffffff;strokeColor=#1a3a5c;${isHiddenStyle}`,
                '1', null, null,
                { x: entry.x, y: entry.y, width: tableWidth, height: tableHeight }
            ));

            // Column rows
            let colY = 30;
            for (const col of displayColumns) {
                const colId = this._nextId('col_' + this._sanitizeId(table.name) + '_' + this._sanitizeId(col.label));
                const fillColor = col.isRelationship ? '#e8edf2' : 'none';
                cells.push(this._mxCell(colId, this._escapeXml(col.label),
                    `shape=partialRectangle;overflow=hidden;connectable=0;fillColor=${fillColor};top=0;left=0;bottom=0;right=0;fontStyle=0;align=left;spacingLeft=6;fontSize=11;`,
                    '1', tableId, null,
                    { y: colY, width: tableWidth, height: 26 }
                ));
                colY += 26;
            }
        }

        // Relationship edges
        for (let i = 0; i < relationships.length; i++) {
            const rel = relationships[i];
            const sourceId = tableIdMap.get(rel.fromTable);
            const targetId = tableIdMap.get(rel.toTable);
            if (!sourceId || !targetId) continue;

            const relId = this._nextId('rel_' + i);
            const arrows = this._getArrowStyle(rel.cardinality);
            const isActive = rel.isActive !== false;
            const strokeColor = isActive ? '#1a3a5c' : '#c62828';
            const dashed = isActive ? '0' : '1';
            const label = this._escapeXml(`${rel.fromColumn} → ${rel.toColumn}`);

            cells.push(this._mxEdge(relId, label,
                `${arrows}endFill=0;startFill=0;strokeWidth=1.5;strokeColor=${strokeColor};dashed=${dashed};fontSize=9;labelBackgroundColor=#ffffff;`,
                sourceId, targetId
            ));
        }

        return this._wrapDiagram('ERD', 'erd', cells);
    }

    /**
     * Generate a detailed ERD with ALL columns and measures per table.
     * Designed for large-format printing / comprehensive documentation.
     * @returns {string} draw.io XML
     */
    generateDetailedERD() {
        const tables = (this.parsedModel.tables || []).filter(t => !t._isAutoDate);
        const relationships = this.parsedModel.relationships || [];

        // Build FK/PK lookup
        const fkColumns = new Map();
        const pkColumns = new Map();
        for (const rel of relationships) {
            if (!fkColumns.has(rel.fromTable)) fkColumns.set(rel.fromTable, new Set());
            fkColumns.get(rel.fromTable).add(rel.fromColumn);
            if (!pkColumns.has(rel.toTable)) pkColumns.set(rel.toTable, new Set());
            pkColumns.get(rel.toTable).add(rel.toColumn);
        }

        // Layout using same BFS grid as detailed-erd.js
        const layout = this._computeDetailedERDLayout(tables, relationships);

        const cells = [];
        const tableIdMap = new Map();
        const rowHeight = 24;
        const tableWidth = 280;

        for (const entry of layout) {
            const table = entry.table;
            const tableId = this._nextId('dtable_' + this._sanitizeId(table.name));
            tableIdMap.set(table.name, tableId);

            const fkSet = fkColumns.get(table.name) || new Set();
            const pkSet = pkColumns.get(table.name) || new Set();
            const columns = table.columns || [];
            const measures = table.measures || [];

            // Calculate total rows: columns + measures + section headers
            let rowCount = columns.length;
            if (measures.length > 0) rowCount += measures.length + 1; // +1 for section header
            const tableHeight = 30 + rowCount * rowHeight;

            // Storage mode badge
            const mode = (table.partitions && table.partitions[0]?.mode) || '';
            const titleSuffix = mode ? ` [${mode}]` : '';

            cells.push(this._mxCell(tableId, this._escapeXml(table.name + titleSuffix),
                `shape=table;startSize=30;container=1;collapsible=1;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;align=center;resizeLast=1;fillColor=#1a3a5c;fontColor=#ffffff;strokeColor=#1a3a5c;`,
                '1', null, null,
                { x: entry.x, y: entry.y, width: tableWidth, height: tableHeight }
            ));

            let colY = 30;

            // All columns
            for (const col of columns) {
                const isFk = fkSet.has(col.name);
                const isPk = pkSet.has(col.name);
                const isCalc = !col.sourceColumn && col.expression;
                const dataType = col.dataType ? ` (${col.dataType})` : '';
                const badges = [];
                if (isPk) badges.push('PK');
                if (isFk) badges.push('FK');
                if (isCalc) badges.push('fx');
                if (col.isHidden) badges.push('H');
                const suffix = badges.length > 0 ? ' ' + badges.join(' ') : '';
                const label = `${col.name}${dataType}${suffix}`;

                const fillColor = isPk || isFk ? '#e8edf2' : isCalc ? '#e8f5e9' : 'none';
                const fontColor = col.isHidden ? '#999999' : '#333333';
                const colId = this._nextId('dcol_' + this._sanitizeId(table.name) + '_' + this._sanitizeId(col.name));
                cells.push(this._mxCell(colId, this._escapeXml(label),
                    `shape=partialRectangle;overflow=hidden;connectable=0;fillColor=${fillColor};fontColor=${fontColor};top=0;left=0;bottom=0;right=0;fontStyle=0;align=left;spacingLeft=6;fontSize=11;`,
                    '1', tableId, null,
                    { y: colY, width: tableWidth, height: rowHeight }
                ));
                colY += rowHeight;
            }

            // Measures section
            if (measures.length > 0) {
                const measHeaderId = this._nextId('dmh_' + this._sanitizeId(table.name));
                cells.push(this._mxCell(measHeaderId, 'MEASURES',
                    `shape=partialRectangle;overflow=hidden;connectable=0;fillColor=#f5ecd7;fontColor=#8b6e00;top=0;left=0;bottom=0;right=0;fontStyle=1;align=left;spacingLeft=6;fontSize=10;`,
                    '1', tableId, null,
                    { y: colY, width: tableWidth, height: rowHeight }
                ));
                colY += rowHeight;

                for (const m of measures) {
                    const mId = this._nextId('dmeas_' + this._sanitizeId(table.name) + '_' + this._sanitizeId(m.name));
                    const folderHint = m.displayFolder ? ` [${m.displayFolder}]` : '';
                    cells.push(this._mxCell(mId, this._escapeXml(m.name + folderHint),
                        `shape=partialRectangle;overflow=hidden;connectable=0;fillColor=#fdf8ed;fontColor=#5d4e00;top=0;left=0;bottom=0;right=0;fontStyle=0;align=left;spacingLeft=6;fontSize=11;`,
                        '1', tableId, null,
                        { y: colY, width: tableWidth, height: rowHeight }
                    ));
                    colY += rowHeight;
                }
            }
        }

        // Relationship edges
        for (let i = 0; i < relationships.length; i++) {
            const rel = relationships[i];
            const sourceId = tableIdMap.get(rel.fromTable);
            const targetId = tableIdMap.get(rel.toTable);
            if (!sourceId || !targetId) continue;

            const relId = this._nextId('drel_' + i);
            const cardinality = `${rel.fromCardinality || 'many'}:${rel.toCardinality || 'one'}`;
            const arrows = this._getArrowStyle(cardinality);
            const isActive = rel.isActive !== false;
            const strokeColor = isActive ? '#1a3a5c' : '#c62828';
            const dashed = isActive ? '0' : '1';
            const label = this._escapeXml(`${rel.fromColumn} \u2192 ${rel.toColumn}`);

            cells.push(this._mxEdge(relId, label,
                `${arrows}endFill=0;startFill=0;strokeWidth=1.5;strokeColor=${strokeColor};dashed=${dashed};fontSize=9;labelBackgroundColor=#ffffff;`,
                sourceId, targetId
            ));
        }

        // Compute page size from layout extents
        let maxX = 0, maxY = 0;
        for (const entry of layout) {
            maxX = Math.max(maxX, entry.x + 300);
            maxY = Math.max(maxY, entry.y + 600);
        }

        return this._wrapDiagram('Detailed ERD', 'detailed-erd', cells, Math.max(maxX + 100, 1169), Math.max(maxY + 100, 827));
    }

    /**
     * Generate a data lineage diagram as draw.io XML.
     * Left-to-right flow: Data Sources → Tables → Measures → Visuals.
     * Requires lineageEngine or falls back to parsedModel data.
     * @returns {string} draw.io XML
     */
    generateLineage() {
        const cells = [];
        const nodeIdMap = new Map(); // logical key -> cellId

        // Collect nodes by category
        const dataSources = [];
        const tableNodes = [];
        const measureNodes = [];
        const visualNodes = [];

        if (this.lineageEngine && this.lineageEngine.nodes) {
            // Use lineage engine data
            for (const [id, node] of this.lineageEngine.nodes) {
                switch (node.type) {
                    case 'dataSource': dataSources.push({ key: id, label: node.name || id }); break;
                    case 'table': tableNodes.push({ key: id, label: node.name || id }); break;
                    case 'measure': measureNodes.push({ key: id, label: node.name || id }); break;
                    case 'visual': visualNodes.push({ key: id, label: node.name || id }); break;
                }
            }
        } else {
            // Fallback: derive from parsedModel
            const tables = this.parsedModel.tables || [];
            const seenSources = new Set();
            for (const t of tables) {
                tableNodes.push({ key: 'table_' + t.name, label: t.name });
                if (t.partitions) {
                    for (const p of t.partitions) {
                        const src = p.dataSource || p.source;
                        if (src && !seenSources.has(src)) {
                            seenSources.add(src);
                            dataSources.push({ key: 'ds_' + src, label: src });
                        }
                    }
                }
                if (t.measures) {
                    for (const m of t.measures) {
                        measureNodes.push({ key: 'measure_' + t.name + '.' + m.name, label: m.name, table: t.name });
                    }
                }
            }
        }

        // Column x positions
        const colX = { dataSource: 50, table: 350, measure: 650, visual: 950 };
        const nodeWidth = 200;
        const nodeHeight = 40;
        const ySpacing = 60;
        const yStart = 80;

        // Column headers
        const headers = [
            { label: 'Data Sources', x: colX.dataSource },
            { label: 'Tables', x: colX.table },
            { label: 'Measures', x: colX.measure },
            { label: 'Visuals', x: colX.visual }
        ];
        for (const h of headers) {
            const hId = this._nextId('header');
            cells.push(this._mxCell(hId, `<b>${this._escapeXml(h.label)}</b>`,
                'text;html=1;align=center;verticalAlign=middle;resizable=0;points=[];autosize=1;fillColor=none;strokeColor=none;fontSize=14;fontColor=#1a3a5c;',
                '1', null, null,
                { x: h.x, y: 20, width: nodeWidth, height: 30 }
            ));
        }

        // Helper to place nodes in a column
        const placeColumn = (nodes, x, style) => {
            nodes.forEach((node, i) => {
                const id = this._nextId('ln');
                nodeIdMap.set(node.key, id);
                cells.push(this._mxCell(id, this._escapeXml(node.label),
                    style,
                    '1', null, null,
                    { x, y: yStart + i * ySpacing, width: nodeWidth, height: nodeHeight }
                ));
            });
        };

        const dsStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;fontSize=11;';
        const tableStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1a3a5c;fontSize=11;fontStyle=1;';
        const measureStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontColor=#333333;fontSize=11;';
        const visualStyle = 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#333333;fontSize=11;';

        placeColumn(dataSources, colX.dataSource, dsStyle);
        placeColumn(tableNodes, colX.table, tableStyle);
        placeColumn(measureNodes, colX.measure, measureStyle);
        placeColumn(visualNodes, colX.visual, visualStyle);

        // Edges
        if (this.lineageEngine && this.lineageEngine.edges) {
            for (const edge of this.lineageEngine.edges) {
                const srcId = nodeIdMap.get(edge.source);
                const tgtId = nodeIdMap.get(edge.target);
                if (!srcId || !tgtId) continue;
                const edgeId = this._nextId('le');
                const edgeColor = this._getLineageEdgeColor(edge.type);
                cells.push(this._mxEdge(edgeId, '',
                    `endArrow=classic;endFill=1;strokeWidth=1;strokeColor=${edgeColor};curved=1;`,
                    srcId, tgtId
                ));
            }
        } else {
            // Fallback edges: tables → measures (by table ownership)
            for (const m of measureNodes) {
                if (m.table) {
                    const tblKey = 'table_' + m.table;
                    const srcId = nodeIdMap.get(tblKey);
                    const tgtId = nodeIdMap.get(m.key);
                    if (srcId && tgtId) {
                        const edgeId = this._nextId('le');
                        cells.push(this._mxEdge(edgeId, '',
                            'endArrow=classic;endFill=1;strokeWidth=1;strokeColor=#d6b656;curved=1;',
                            srcId, tgtId
                        ));
                    }
                }
            }
        }

        // Compute page size from content
        const maxY = yStart + Math.max(dataSources.length, tableNodes.length, measureNodes.length, visualNodes.length) * ySpacing + 50;
        const pageWidth = 1250;
        const pageHeight = Math.max(827, maxY);

        return this._wrapDiagram('Lineage', 'lineage', cells, pageWidth, pageHeight);
    }

    // ─── Layout ─────────────────────────────────────────────────────────

    /**
     * Compute ERD positions using star-schema heuristic.
     * @returns {Array<{table, x, y}>}
     */
    _computeERDLayout(tables, relationships) {
        const tableMap = new Map();
        for (const t of tables) tableMap.set(t.name, t);

        // Count outgoing many:one relationships per table (fact table heuristic)
        const outgoingCount = new Map();
        const relTableNames = new Set();
        for (const rel of relationships) {
            relTableNames.add(rel.fromTable);
            relTableNames.add(rel.toTable);
            if (rel.cardinality === 'many:one' || rel.cardinality === 'manyToOne') {
                outgoingCount.set(rel.fromTable, (outgoingCount.get(rel.fromTable) || 0) + 1);
            }
        }

        // Find fact table (most outgoing many:one)
        let factTableName = null;
        let maxOut = 0;
        for (const [name, count] of outgoingCount) {
            if (count > maxOut) { maxOut = count; factTableName = name; }
        }

        // Separate tables into: fact, dimensions (connected), standalone
        const dimensionNames = new Set();
        for (const rel of relationships) {
            if (rel.fromTable === factTableName) dimensionNames.add(rel.toTable);
            if (rel.toTable === factTableName) dimensionNames.add(rel.fromTable);
        }
        // Remove fact from dimensions
        dimensionNames.delete(factTableName);

        // Connected but not direct dimension of fact
        const otherConnected = new Set();
        for (const name of relTableNames) {
            if (name !== factTableName && !dimensionNames.has(name)) {
                otherConnected.add(name);
            }
        }

        const standalone = tables.filter(t =>
            !relTableNames.has(t.name) && t.name !== factTableName
        );

        const results = [];
        const centerX = 400;
        const centerY = 300;
        const ringRadius = 300;

        // Place fact table at center
        if (factTableName && tableMap.has(factTableName)) {
            results.push({ table: tableMap.get(factTableName), x: centerX, y: centerY });
        }

        // Place dimensions in a ring
        const dims = [...dimensionNames].filter(n => tableMap.has(n));
        for (let i = 0; i < dims.length; i++) {
            const angle = (2 * Math.PI * i) / dims.length - Math.PI / 2;
            const x = centerX + ringRadius * Math.cos(angle);
            const y = centerY + ringRadius * Math.sin(angle);
            results.push({ table: tableMap.get(dims[i]), x: Math.round(x), y: Math.round(y) });
        }

        // Place other connected tables in a wider ring
        const others = [...otherConnected].filter(n => tableMap.has(n));
        const outerRadius = ringRadius + 250;
        for (let i = 0; i < others.length; i++) {
            const angle = (2 * Math.PI * i) / others.length;
            const x = centerX + outerRadius * Math.cos(angle);
            const y = centerY + outerRadius * Math.sin(angle);
            results.push({ table: tableMap.get(others[i]), x: Math.round(x), y: Math.round(y) });
        }

        // Place standalone tables in a row at the bottom
        const bottomY = centerY + ringRadius + 200;
        for (let i = 0; i < standalone.length; i++) {
            results.push({ table: standalone[i], x: 50 + i * 250, y: bottomY });
        }

        return results;
    }

    /**
     * BFS column-grid layout for detailed ERD (all columns visible, taller boxes).
     * @returns {Array<{table, x, y}>}
     */
    _computeDetailedERDLayout(tables, relationships) {
        const tableMap = new Map();
        for (const t of tables) tableMap.set(t.name, t);

        // Fact table heuristic
        const manySideCounts = {};
        for (const t of tables) manySideCounts[t.name] = 0;
        for (const rel of relationships) {
            const fromCard = rel.fromCardinality || 'many';
            const toCard = rel.toCardinality || 'one';
            if (fromCard === 'many' && manySideCounts[rel.fromTable] !== undefined) manySideCounts[rel.fromTable]++;
            if (toCard === 'many' && manySideCounts[rel.toTable] !== undefined) manySideCounts[rel.toTable]++;
        }
        let factTable = tables[0]?.name;
        let maxCount = -1;
        for (const [name, count] of Object.entries(manySideCounts)) {
            if (count > maxCount) { factTable = name; maxCount = count; }
        }

        // BFS from fact table
        const adj = {};
        for (const t of tables) adj[t.name] = new Set();
        for (const rel of relationships) {
            if (adj[rel.fromTable]) adj[rel.fromTable].add(rel.toTable);
            if (adj[rel.toTable]) adj[rel.toTable].add(rel.fromTable);
        }

        const visited = new Set([factTable]);
        const bfsCols = [[factTable]];
        let frontier = [factTable];
        while (frontier.length > 0) {
            const next = [];
            for (const c of frontier) {
                for (const n of (adj[c] || [])) {
                    if (!visited.has(n)) { visited.add(n); next.push(n); }
                }
            }
            if (next.length > 0) bfsCols.push(next);
            frontier = next;
        }

        const disconnected = tables.filter(t => !visited.has(t.name));
        const results = [];
        const tableWidth = 280;
        const colGap = 60;
        const rowGap = 40;
        let currentX = 60;

        // Estimate table height
        const estHeight = (t) => {
            let h = 30 + (t.columns || []).length * 24;
            if (t.measures && t.measures.length > 0) h += (t.measures.length + 1) * 24;
            return h;
        };

        for (const col of bfsCols) {
            const colNodes = col.map(n => tableMap.get(n)).filter(Boolean);
            colNodes.sort((a, b) => estHeight(b) - estHeight(a));
            let currentY = 60;
            for (const t of colNodes) {
                results.push({ table: t, x: currentX, y: currentY });
                currentY += estHeight(t) + rowGap;
            }
            if (colNodes.length > 0) currentX += tableWidth + colGap;
        }

        // Disconnected tables in rows below
        if (disconnected.length > 0) {
            let maxY = 0;
            for (const r of results) maxY = Math.max(maxY, r.y + estHeight(r.table));
            let dx = 60, dy = maxY + 80;
            for (const t of disconnected) {
                if (dx + tableWidth > Math.max(currentX, 1200) && dx > 60) {
                    dx = 60;
                    dy += 400;
                }
                results.push({ table: t, x: dx, y: dy });
                dx += tableWidth + colGap;
            }
        }

        return results;
    }

    // ─── Column Display ─────────────────────────────────────────────────

    /**
     * Build display columns for a table: relationship columns first, then up to 5 others.
     */
    _getDisplayColumns(table, fkColumns, pkColumns) {
        const columns = table.columns || [];
        const fkSet = fkColumns.get(table.name) || new Set();
        const pkSet = pkColumns.get(table.name) || new Set();

        const relCols = [];
        const otherCols = [];

        for (const col of columns) {
            const isFk = fkSet.has(col.name);
            const isPk = pkSet.has(col.name);
            const dataType = col.dataType ? ` (${col.dataType})` : '';
            const suffix = isPk && isFk ? ' PK FK' : isPk ? ' PK' : isFk ? ' FK' : '';
            const entry = {
                label: `${col.name}${dataType}${suffix}`,
                isRelationship: isFk || isPk
            };
            if (isFk || isPk) {
                relCols.push(entry);
            } else {
                otherCols.push(entry);
            }
        }

        // Also show measures count if any
        const measures = table.measures || [];

        const maxOther = 5;
        const displayOther = otherCols.slice(0, maxOther);
        const result = [...relCols, ...displayOther];

        const remaining = otherCols.length - maxOther;
        if (remaining > 0) {
            result.push({
                label: `... ${remaining} more column${remaining > 1 ? 's' : ''}`,
                isRelationship: false
            });
        }

        if (measures.length > 0) {
            result.push({
                label: `[${measures.length} measure${measures.length > 1 ? 's' : ''}]`,
                isRelationship: false
            });
        }

        return result;
    }

    // ─── Arrow Styles ───────────────────────────────────────────────────

    _getArrowStyle(cardinality) {
        switch (cardinality) {
            case 'one:one':
            case 'oneToOne':
                return 'startArrow=ERmandOne;endArrow=ERmandOne;';
            case 'many:many':
            case 'manyToMany':
                return 'startArrow=ERmany;endArrow=ERmany;';
            case 'many:one':
            case 'manyToOne':
            default:
                return 'startArrow=ERmany;endArrow=ERmandOne;';
        }
    }

    // ─── Lineage Edge Colors ────────────────────────────────────────────

    _getLineageEdgeColor(edgeType) {
        switch (edgeType) {
            case 'sources': return '#666666';
            case 'references_measure':
            case 'references_column': return '#6c8ebf';
            case 'modifies_measure': return '#d6a117';
            case 'resolves_to_measure': return '#9673a6';
            case 'uses_field': return '#82b366';
            default: return '#999999';
        }
    }

    // ─── XML Building ───────────────────────────────────────────────────

    _nextId(prefix) {
        return prefix || ('id_' + this._idCounter++);
    }

    _sanitizeId(name) {
        return name.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    _escapeXml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Build an mxCell element for a vertex (table, column, node).
     */
    _mxCell(id, value, style, vertex, parent, source, geometry) {
        const parentAttr = parent ? ` parent="${parent}"` : ' parent="1"';
        let geo = '';
        if (geometry) {
            const { x, y, width, height } = geometry;
            const xAttr = x !== undefined ? ` x="${x}"` : '';
            const yAttr = y !== undefined ? ` y="${y}"` : '';
            geo = `\n          <mxGeometry${xAttr}${yAttr} width="${width}" height="${height}" as="geometry"/>`;
        }
        return `        <mxCell id="${id}" value="${value}" style="${style}" vertex="${vertex}"${parentAttr}>${geo}\n        </mxCell>`;
    }

    /**
     * Build an mxCell element for an edge (relationship, lineage connection).
     */
    _mxEdge(id, value, style, sourceId, targetId) {
        return `        <mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1" source="${sourceId}" target="${targetId}"/>`;
    }

    /**
     * Wrap cell elements into a complete draw.io XML document.
     */
    _wrapDiagram(name, diagramId, cells, pageWidth, pageHeight) {
        const pw = pageWidth || 1169;
        const ph = pageHeight || 827;
        const modified = new Date().toISOString().split('T')[0];
        const cellBlock = cells.join('\n');

        return `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="pbip-documenter" modified="${modified}" type="device">
  <diagram name="${this._escapeXml(name)}" id="${diagramId}">
    <mxGraphModel dx="1422" dy="762" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${pw}" pageHeight="${ph}" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
${cellBlock}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;
    }

    // ─── Convenience: Download as file ──────────────────────────────────

    /**
     * Trigger a browser download of the given XML content.
     * @param {string} xml - draw.io XML content
     * @param {string} filename - e.g. "model-erd.drawio"
     */
    static download(xml, filename) {
        const blob = new Blob([xml], { type: 'application/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename || 'diagram.drawio';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
}

// Module export for testing; no-op in browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DrawioExporter;
}
