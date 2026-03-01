/**
 * Lineage Diagram Renderer
 * SVG renderer for data lineage flow diagrams
 * Left-to-right layout: Data Sources → Tables → Measures/Columns → Visuals
 */

class LineageDiagramRenderer {
    constructor(container, lineageEngine) {
        this.container = container;
        this.lineageEngine = lineageEngine;
        this.SVG_NS = 'http://www.w3.org/2000/svg';
        this.colors = {
            source: '#4caf50',
            sourceBg: '#e8f5e9',
            table: '#1565c0',
            tableBg: '#e3f2fd',
            measure: '#f9a825',
            measureBg: '#fff8e1',
            column: '#42a5f5',
            columnBg: '#e3f2fd',
            visual: '#9c27b0',
            visualBg: '#f3e5f5',
            expression: '#78909c',
            expressionBg: '#eceff1',
            calcGroup: '#2e7d32',
            calcGroupBg: '#e8f5e9',
            fieldParam: '#6a1b9a',
            fieldParamBg: '#f3e5f5',
            edge: '#90a4ae',
            edgeHighlight: '#c89632',
            bg: '#ffffff',
            border: '#d0ccc4',
            text: '#2c2c2c',
            textLight: '#666666',
            textWhite: '#ffffff'
        };
        this._cleanupFn = null;
        this._expandedTables = new Set();
    }

    /**
     * Render full lineage overview of entire model
     */
    renderFullLineage(container) {
        const target = container || this.container;
        this._clearContainer(target);
        this._isFullLineageView = true;

        const engine = this.lineageEngine;
        if (!engine || !engine.nodes) return;

        // Group nodes by type into columns
        const columns = this._buildColumns();
        if (columns.every(col => col.items.length === 0)) {
            target.innerHTML = '<p style="text-align:center;color:#666;padding:40px">No lineage data available. Make sure your model has partition sources defined.</p>';
            return;
        }

        const layout = this._layoutColumns(columns);
        const svg = this._renderLayout(layout, columns, 'Data Lineage Overview');
        target.appendChild(svg);
        this._initInteractivity(svg, layout.width, layout.height, target);
    }

    /**
     * Render focused trace from a single visual to data sources
     */
    renderVisualTrace(container, pageName, visualName) {
        const target = container || this.container;
        this._clearContainer(target);
        this._isFullLineageView = false;

        const lineage = this.lineageEngine.getVisualLineage(pageName, visualName);
        if (!lineage) {
            target.innerHTML = '<p style="text-align:center;color:#666;padding:40px">No lineage data for this visual.</p>';
            return;
        }

        // Build focused columns from lineage result
        const columns = [
            {
                label: 'Data Sources',
                color: this.colors.source,
                colorBg: this.colors.sourceBg,
                items: lineage.dataSources.map(s => ({
                    id: `source:${MExpressionParser._sourceKey(s)}`,
                    name: this._formatSourceName(s),
                    type: 'dataSource',
                    detail: s.type
                }))
            },
            {
                label: 'Tables',
                color: this.colors.table,
                colorBg: this.colors.tableBg,
                items: lineage.tables.map(t => ({
                    id: `table:${t.name}`,
                    name: t.name,
                    type: 'table'
                }))
            },
            {
                label: 'Measures & Columns',
                color: this.colors.measure,
                colorBg: this.colors.measureBg,
                items: [
                    ...lineage.measures.map(m => ({
                        id: `measure:${m.table}.${m.name}`,
                        name: `[${m.name}]`,
                        type: 'measure',
                        detail: m.table
                    })),
                    ...lineage.columns.map(c => ({
                        id: `column:${c.table}.${c.column}`,
                        name: `${c.table}[${c.column}]`,
                        type: 'column',
                        detail: c.table
                    })),
                    ...(lineage.expandedCalcItems || []).map(ci => ({
                        id: `calcItem:${ci.sourceTable}.${ci.name}`,
                        name: ci.name,
                        type: 'calcItem',
                        detail: `Calc Group: ${ci.sourceTable}`
                    })),
                    ...(lineage.expandedFPItems || []).map(fp => ({
                        id: `fpItem:${fp.sourceTable}.${fp.table}.${fp.column}`,
                        name: `${fp.table}'[${fp.column}]`,
                        type: 'fpItem',
                        detail: `Field Param: ${fp.sourceTable}`
                    }))
                ]
            },
            {
                label: 'Visual',
                color: this.colors.visual,
                colorBg: this.colors.visualBg,
                items: [{
                    id: `visual:${pageName}|${visualName}`,
                    name: visualName,
                    type: 'visual',
                    detail: pageName
                }]
            }
        ];

        const layout = this._layoutColumns(columns);
        const svg = this._renderLayout(layout, columns, `Lineage: ${visualName}`);

        // Draw edges for this trace
        this._drawTraceEdges(svg, layout, lineage, columns);

        target.appendChild(svg);
        this._initInteractivity(svg, layout.width, layout.height, target);
    }

    /**
     * Render measure impact analysis (reverse direction)
     */
    renderMeasureImpact(container, measureName) {
        const target = container || this.container;
        this._clearContainer(target);
        this._isFullLineageView = false;

        const impact = this.lineageEngine.getMeasureImpact(measureName);
        const tableName = this.lineageEngine.measureLookup.get(measureName);
        if (!tableName) {
            target.innerHTML = '<p style="text-align:center;color:#666;padding:40px">Measure not found.</p>';
            return;
        }

        const columns = [
            {
                label: 'Source Measure',
                color: this.colors.measure,
                colorBg: this.colors.measureBg,
                items: [{
                    id: `measure:${tableName}.${measureName}`,
                    name: `[${measureName}]`,
                    type: 'measure',
                    detail: tableName
                }]
            },
            {
                label: 'Dependent Measures',
                color: this.colors.measure,
                colorBg: this.colors.measureBg,
                items: impact.dependentMeasures.map(m => ({
                    id: `measure:${m.table}.${m.name}`,
                    name: `[${m.name}]`,
                    type: 'measure',
                    detail: m.table
                }))
            },
            {
                label: 'Visuals',
                color: this.colors.visual,
                colorBg: this.colors.visualBg,
                items: impact.visuals.map(v => ({
                    id: `visual:${v.page}|${v.name}`,
                    name: v.name,
                    type: 'visual',
                    detail: v.page + (v.indirect ? ` (via ${v.via})` : '')
                }))
            }
        ];

        const layout = this._layoutColumns(columns);
        const svg = this._renderLayout(layout, columns, `Impact: [${measureName}]`);

        // Draw edges
        this._drawImpactEdges(svg, layout, measureName, impact, columns);

        target.appendChild(svg);
        this._initInteractivity(svg, layout.width, layout.height, target);
    }

    /**
     * Render column impact analysis
     */
    renderColumnImpact(container, tableName, columnName) {
        const target = container || this.container;
        this._clearContainer(target);
        this._isFullLineageView = false;

        const impact = this.lineageEngine.getColumnImpact(tableName, columnName);
        if (!impact) {
            target.innerHTML = '<p style="text-align:center;color:#666;padding:40px">Column not found.</p>';
            return;
        }

        const allVisuals = [...impact.directVisuals, ...impact.transitiveVisuals];

        const columns = [
            {
                label: 'Source Column',
                color: this.colors.column,
                colorBg: this.colors.columnBg,
                items: [{
                    id: `column:${tableName}.${columnName}`,
                    name: `${tableName}[${columnName}]`,
                    type: 'column',
                    detail: tableName
                }]
            },
            {
                label: 'Referencing Measures',
                color: this.colors.measure,
                colorBg: this.colors.measureBg,
                items: impact.directMeasures.map(m => ({
                    id: `measure:${m.table}.${m.name}`,
                    name: `[${m.name}]`,
                    type: 'measure',
                    detail: m.table
                }))
            },
            {
                label: 'Affected Visuals',
                color: this.colors.visual,
                colorBg: this.colors.visualBg,
                items: allVisuals.map(v => ({
                    id: `visual:${v.page}|${v.name}`,
                    name: v.name,
                    type: 'visual',
                    detail: v.page + (v.indirect ? ` (via ${v.via})` : '')
                }))
            }
        ];

        const layout = this._layoutColumns(columns);
        const svg = this._renderLayout(layout, columns, `Column Impact: ${tableName}[${columnName}]`);

        // Draw edges
        const posMap = new Map();
        for (const col of columns) {
            for (let i = 0; i < (col._visibleCount || col.items.length); i++) {
                posMap.set(col.items[i].id, col.items[i]);
            }
        }

        const sourceItem = posMap.get(`column:${tableName}.${columnName}`);
        if (sourceItem) {
            // Column → Measures
            for (const dm of impact.directMeasures) {
                const dmItem = posMap.get(`measure:${dm.table}.${dm.name}`);
                if (dmItem) this._drawEdge(svg, sourceItem, dmItem, 'references_column');
            }
            // Column → Direct Visuals
            for (const v of impact.directVisuals) {
                const vItem = posMap.get(`visual:${v.page}|${v.name}`);
                if (vItem) this._drawEdge(svg, sourceItem, vItem, 'uses_field');
            }
            // Measures → Transitive Visuals
            for (const v of impact.transitiveVisuals) {
                const vItem = posMap.get(`visual:${v.page}|${v.name}`);
                if (!vItem) continue;
                const viaTable = this.lineageEngine.measureLookup.get(v.via);
                if (viaTable) {
                    const mItem = posMap.get(`measure:${viaTable}.${v.via}`);
                    if (mItem) this._drawEdge(svg, mItem, vItem, 'uses_field');
                }
            }
        }

        target.appendChild(svg);
        this._initInteractivity(svg, layout.width, layout.height, target);
    }

    /**
     * Export SVG as string
     */
    exportSVG() {
        const svg = this.container.querySelector('svg');
        if (!svg) return null;
        return new XMLSerializer().serializeToString(svg);
    }

    /**
     * Get columns of a table that participate in edges (referenced by measures/visuals)
     */
    _getConnectedColumns(tableName) {
        const engine = this.lineageEngine;
        const prefix = `column:${tableName}.`;
        const connectedIds = new Set();

        for (const edge of engine.edges) {
            // Measures referencing columns, visuals using columns
            if ((edge.type === 'references_column' || edge.type === 'uses_field') && edge.to.startsWith(prefix)) {
                connectedIds.add(edge.to);
            }
            // Relationship columns
            if (edge.type === 'has_relationship' && (edge.from === `table:${tableName}` || edge.to === `table:${tableName}`)) {
                if (edge.from === `table:${tableName}` && edge.fromColumn) {
                    connectedIds.add(`column:${tableName}.${edge.fromColumn}`);
                }
                if (edge.to === `table:${tableName}` && edge.toColumn) {
                    connectedIds.add(`column:${tableName}.${edge.toColumn}`);
                }
            }
        }

        const result = [];
        for (const colId of connectedIds) {
            const node = engine.nodes.get(colId);
            if (node) result.push(node);
        }
        return result.sort((a, b) => a.name.localeCompare(b.name));
    }

    _tableHasVisibleEdges(tableId, edges) {
        for (const edge of edges) {
            if (edge.type === 'belongs_to_table' && edge.from.startsWith('column:')) continue;
            if (edge.from === tableId || edge.to === tableId) return true;
        }
        return false;
    }

    // ──────────────────────────────────────────────
    // LAYOUT
    // ──────────────────────────────────────────────

    _buildColumns() {
        const engine = this.lineageEngine;
        const sourceItems = [];
        const tableItems = [];
        const measureColumnItems = [];
        const visualItems = [];

        for (const [id, node] of engine.nodes) {
            switch (node.type) {
                case 'dataSource':
                    sourceItems.push({
                        id, name: node.name, type: 'dataSource', detail: node.sourceType
                    });
                    break;
                case 'table':
                    if (this._tableHasVisibleEdges(id, engine.edges)) {
                        const isExpanded = this._expandedTables.has(node.name);
                        const hasConnectedCols = this._getConnectedColumns(node.name).length > 0;
                        tableItems.push({
                            id, name: node.name, type: 'table',
                            detail: `${node.columnCount}c / ${node.measureCount}m`,
                            expandable: hasConnectedCols,
                            expanded: isExpanded
                        });
                        // Insert connected column sub-items if expanded
                        if (isExpanded) {
                            const connCols = this._getConnectedColumns(node.name);
                            for (const col of connCols) {
                                tableItems.push({
                                    id: col.id, name: col.name, type: 'column',
                                    detail: col.dataType || '',
                                    isSubItem: true,
                                    parentTable: node.name
                                });
                            }
                        }
                    }
                    break;
                case 'measure':
                    measureColumnItems.push({
                        id, name: `[${node.name}]`, type: 'measure', detail: node.table
                    });
                    break;
                case 'calcItem':
                    measureColumnItems.push({
                        id, name: node.name, type: 'calcItem', detail: `Calc: ${node.table}`
                    });
                    break;
                case 'fpItem':
                    measureColumnItems.push({
                        id, name: node.name, type: 'fpItem', detail: `FP: ${node.sourceTable}`
                    });
                    break;
                case 'visual':
                    visualItems.push({
                        id, name: node.name, type: 'visual',
                        detail: node.pageName
                    });
                    break;
            }
        }

        return [
            { label: 'Data Sources', color: this.colors.source, colorBg: this.colors.sourceBg, items: sourceItems },
            { label: 'Tables', color: this.colors.table, colorBg: this.colors.tableBg, items: tableItems },
            { label: 'Measures', color: this.colors.measure, colorBg: this.colors.measureBg, items: measureColumnItems },
            { label: 'Visuals', color: this.colors.visual, colorBg: this.colors.visualBg, items: visualItems }
        ];
    }

    _layoutColumns(columns) {
        const colWidth = 180;
        const nodeHeight = 36;
        const nodeGap = 8;
        const colGap = 100;
        const headerHeight = 50;
        const padding = 40;
        const titleHeight = 50;

        // Cap visible items per column for readability
        const MAX_VISIBLE = 25;

        let x = padding;
        const colPositions = [];

        for (const col of columns) {
            if (col.items.length === 0) {
                col._visibleCount = 0;
                col._overflow = 0;
                colPositions.push({ x: -1, items: [] });
                continue;
            }

            const visibleCount = Math.min(col.items.length, MAX_VISIBLE);
            col._visibleCount = visibleCount;
            col._overflow = col.items.length - visibleCount;

            colPositions.push({ x, items: [] });
            let y = padding + titleHeight + headerHeight;

            for (let i = 0; i < visibleCount; i++) {
                const item = col.items[i];
                const isSubItem = item.isSubItem;
                const itemH = isSubItem ? 28 : nodeHeight;
                item._x = isSubItem ? x + 10 : x;
                item._y = y;
                item._w = isSubItem ? colWidth - 10 : colWidth;
                item._h = itemH;
                colPositions[colPositions.length - 1].items.push(item);
                y += itemH + (isSubItem ? 4 : nodeGap);
            }

            // Overflow indicator
            if (col._overflow > 0) {
                col._overflowY = y;
            }

            x += colWidth + colGap;
        }

        const maxY = Math.max(
            ...columns.map((col, i) => {
                const count = col._visibleCount + (col._overflow > 0 ? 1 : 0);
                return padding + titleHeight + headerHeight + count * (nodeHeight + nodeGap);
            }),
            300
        );

        return {
            width: x - colGap + padding,
            height: maxY + padding,
            colWidth,
            nodeHeight,
            nodeGap,
            colGap,
            headerHeight,
            padding,
            titleHeight,
            colPositions
        };
    }

    _renderLayout(layout, columns, title) {
        const svg = this._createSVG(layout.width, layout.height);

        // Title
        svg.appendChild(this._createText(title, layout.width / 2, layout.padding + 20, {
            fontSize: '16px', fontWeight: '700', fill: this.colors.text, textAnchor: 'middle'
        }));

        let x = layout.padding;
        for (let ci = 0; ci < columns.length; ci++) {
            const col = columns[ci];
            if (col.items.length === 0) {
                continue;
            }

            // Column header
            const headerY = layout.padding + layout.titleHeight;
            const headerG = document.createElementNS(this.SVG_NS, 'g');

            headerG.appendChild(this._createRect(x, headerY, layout.colWidth, 32, {
                fill: col.color, rx: '4'
            }));
            headerG.appendChild(this._createText(
                `${col.label} (${col.items.length})`,
                x + layout.colWidth / 2, headerY + 21,
                { fontSize: '12px', fontWeight: '600', fill: this.colors.textWhite, textAnchor: 'middle' }
            ));
            svg.appendChild(headerG);

            // Nodes
            const visibleCount = col._visibleCount || col.items.length;
            for (let i = 0; i < visibleCount; i++) {
                const item = col.items[i];
                this._drawNode(svg, item, col.color, col.colorBg);
            }

            // Overflow
            if (col._overflow > 0) {
                svg.appendChild(this._createText(
                    `+ ${col._overflow} more...`,
                    x + layout.colWidth / 2, col._overflowY + 20,
                    { fontSize: '11px', fill: this.colors.textLight, textAnchor: 'middle' }
                ));
            }

            x += layout.colWidth + layout.colGap;
        }

        // Draw edges for full lineage
        if (columns.length === 4 && columns[0].label === 'Data Sources') {
            this._drawFullLineageEdges(svg, layout, columns);
        }

        return svg;
    }

    _drawNode(svg, item, color, bgColor) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        g.classList.add('lineage-node');
        g.dataset.nodeId = item.id;
        g.dataset.nodeType = item.type;

        // Override colors for calc group and field parameter items
        if (item.type === 'calcItem') {
            color = this.colors.calcGroup;
            bgColor = this.colors.calcGroupBg;
        } else if (item.type === 'fpItem') {
            color = this.colors.fieldParam;
            bgColor = this.colors.fieldParamBg;
        } else if (item.isSubItem && item.type === 'column') {
            color = this.colors.column;
            bgColor = this.colors.columnBg;
        }

        // Background rect
        g.appendChild(this._createRect(item._x, item._y, item._w, item._h, {
            fill: bgColor, stroke: color, strokeWidth: item.isSubItem ? '1' : '1.5', rx: '4'
        }));

        if (item.isSubItem) {
            // Compact sub-item: name only, smaller text
            const name = this._truncate(item.name, 20);
            g.appendChild(this._createText(name, item._x + 6, item._y + 16, {
                fontSize: '11px', fontWeight: '500', fill: this.colors.text
            }));
            // Data type on the right
            if (item.detail) {
                g.appendChild(this._createText(
                    this._truncate(item.detail, 10),
                    item._x + item._w - 8, item._y + 16,
                    { fontSize: '9px', fill: this.colors.textLight, textAnchor: 'end' }
                ));
            }
        } else {
            // Name (truncated)
            const maxNameLen = item.expandable ? 19 : 22;
            const name = this._truncate(item.name, maxNameLen);
            g.appendChild(this._createText(name, item._x + 8, item._y + 16, {
                fontSize: '12px', fontWeight: '600', fill: this.colors.text
            }));

            // Detail line
            if (item.detail) {
                g.appendChild(this._createText(
                    this._truncate(item.detail, 26),
                    item._x + 8, item._y + 28,
                    { fontSize: '10px', fill: this.colors.textLight }
                ));
            }

            // Expand indicator for expandable tables
            if (item.expandable) {
                const indicator = this._createText(
                    item.expanded ? '\u25BC' : '\u25B6',
                    item._x + item._w - 22, item._y + 16,
                    { fontSize: '10px', fill: this.colors.textLight }
                );
                indicator.classList.add('lineage-node-expand-indicator');
                g.appendChild(indicator);
            }

            // Type indicator dot
            const dotR = 4;
            const dot = document.createElementNS(this.SVG_NS, 'circle');
            dot.setAttribute('cx', item._x + item._w - 10);
            dot.setAttribute('cy', item._y + item._h / 2);
            dot.setAttribute('r', dotR);
            dot.setAttribute('fill', color);
            g.appendChild(dot);
        }

        svg.appendChild(g);
    }

    // ──────────────────────────────────────────────
    // EDGES
    // ──────────────────────────────────────────────

    _drawFullLineageEdges(svg, layout, columns) {
        const engine = this.lineageEngine;

        // Build position lookup
        const posMap = new Map();
        for (const col of columns) {
            for (let i = 0; i < (col._visibleCount || col.items.length); i++) {
                const item = col.items[i];
                posMap.set(item.id, item);
            }
        }

        // Draw edges from the engine
        for (const edge of engine.edges) {
            const fromItem = posMap.get(edge.from);
            const toItem = posMap.get(edge.to);
            if (!fromItem || !toItem) continue;

            // Skip intra-column edges (belongs_to_table, has_relationship within same column)
            if (edge.type === 'belongs_to_table') continue;
            if (edge.type === 'has_relationship') continue; // Phase 5 draws these separately
            if (edge.type === 'modifies_measure') continue; // Skip in full view (too many)
            if (Math.abs(fromItem._x - toItem._x) < 20) continue; // Same visual column

            this._drawEdge(svg, fromItem, toItem, edge.type);
        }

        // Draw relationship edges within the Tables column (Phase 5)
        this._drawRelationshipEdges(svg, posMap, engine);
    }

    _drawTraceEdges(svg, layout, lineage, columns) {
        const posMap = new Map();
        for (const col of columns) {
            for (let i = 0; i < (col._visibleCount || col.items.length); i++) {
                posMap.set(col.items[i].id, col.items[i]);
            }
        }

        // Visual → measures/columns
        const visualItem = columns[3].items[0];
        if (!visualItem) return;

        for (const m of lineage.measures) {
            const mid = `measure:${m.table}.${m.name}`;
            const mItem = posMap.get(mid);
            if (mItem && visualItem) this._drawEdge(svg, visualItem, mItem, 'uses_field');
        }
        for (const c of lineage.columns) {
            const cid = `column:${c.table}.${c.column}`;
            const cItem = posMap.get(cid);
            if (cItem && visualItem) this._drawEdge(svg, visualItem, cItem, 'uses_field');
        }

        // Measures/columns → tables
        const tablesInLineage = new Set(lineage.tables.map(t => t.name));
        for (const m of lineage.measures) {
            const mItem = posMap.get(`measure:${m.table}.${m.name}`);
            if (!mItem) continue;

            // If measure is defined in a field param table, link to its DAX-referenced tables instead
            const tItem = posMap.get(`table:${m.table}`);
            if (tItem) {
                this._drawEdge(svg, mItem, tItem, 'defined_in_table');
            } else {
                // Defining table not in diagram (field param table filtered out) — link to referenced data tables
                const refs = this.lineageEngine?.measureRefs?.[m.name];
                if (refs) {
                    const linked = new Set();
                    for (const cr of refs.columnRefs) linked.add(cr.table);
                    for (const tr of refs.tableRefs) linked.add(tr);
                    for (const rt of linked) {
                        const rtItem = posMap.get(`table:${rt}`);
                        if (rtItem) this._drawEdge(svg, mItem, rtItem, 'defined_in_table');
                    }
                }
            }
        }
        for (const c of lineage.columns) {
            const tid = `table:${c.table}`;
            const cItem = posMap.get(`column:${c.table}.${c.column}`);
            const tItem = posMap.get(tid);
            if (cItem && tItem) this._drawEdge(svg, cItem, tItem, 'belongs_to_table');
        }

        // Visual → expanded calc items, calc items → source table
        for (const ci of (lineage.expandedCalcItems || [])) {
            const ciId = `calcItem:${ci.sourceTable}.${ci.name}`;
            const ciItem = posMap.get(ciId);
            if (ciItem && visualItem) this._drawEdge(svg, visualItem, ciItem, 'uses_field');
            const tItem = posMap.get(`table:${ci.sourceTable}`);
            if (ciItem && tItem) this._drawEdge(svg, ciItem, tItem, 'belongs_to_table');
        }

        // Visual → expanded field param items, fp items → resolved data tables
        for (const fp of (lineage.expandedFPItems || [])) {
            const fpId = `fpItem:${fp.sourceTable}.${fp.table}.${fp.column}`;
            const fpItem = posMap.get(fpId);
            if (fpItem && visualItem) this._drawEdge(svg, visualItem, fpItem, 'uses_field');
            if (fpItem && fp.resolvedTables && fp.resolvedTables.length > 0) {
                for (const rt of fp.resolvedTables) {
                    const tItem = posMap.get(`table:${rt}`);
                    if (tItem) this._drawEdge(svg, fpItem, tItem, 'belongs_to_table');
                }
            } else {
                const tItem = posMap.get(`table:${fp.table}`);
                if (fpItem && tItem) this._drawEdge(svg, fpItem, tItem, 'belongs_to_table');
            }
        }

        // Tables → sources
        for (const t of lineage.tables) {
            for (const src of t.sources) {
                const sid = `source:${MExpressionParser._sourceKey(src)}`;
                const tItem = posMap.get(`table:${t.name}`);
                const sItem = posMap.get(sid);
                if (tItem && sItem) this._drawEdge(svg, tItem, sItem, 'connects_to_source');
            }
        }
    }

    _drawImpactEdges(svg, layout, measureName, impact, columns) {
        const posMap = new Map();
        for (const col of columns) {
            for (let i = 0; i < (col._visibleCount || col.items.length); i++) {
                posMap.set(col.items[i].id, col.items[i]);
            }
        }

        const tableName = this.lineageEngine.measureLookup.get(measureName);
        const sourceItem = posMap.get(`measure:${tableName}.${measureName}`);
        if (!sourceItem) return;

        for (const dm of impact.dependentMeasures) {
            const dmItem = posMap.get(`measure:${dm.table}.${dm.name}`);
            if (dmItem) this._drawEdge(svg, sourceItem, dmItem, 'depends_on_measure');
        }

        for (const v of impact.visuals) {
            const vItem = posMap.get(`visual:${v.page}|${v.name}`);
            if (!vItem) continue;
            if (v.indirect) {
                const dmItem = posMap.get(`measure:${this.lineageEngine.measureLookup.get(v.via)}.${v.via}`);
                if (dmItem) this._drawEdge(svg, dmItem, vItem, 'uses_field');
            } else {
                this._drawEdge(svg, sourceItem, vItem, 'uses_field');
            }
        }
    }

    _drawRelationshipEdges(svg, posMap, engine) {
        for (const edge of engine.edges) {
            if (edge.type !== 'has_relationship') continue;
            const fromItem = posMap.get(edge.from);
            const toItem = posMap.get(edge.to);
            if (!fromItem || !toItem) continue;

            // Draw a curved arc between tables in the same column
            const x1 = fromItem._x + fromItem._w; // right side
            const y1 = fromItem._y + fromItem._h / 2;
            const x2 = toItem._x + toItem._w;
            const y2 = toItem._y + toItem._h / 2;

            const arcOffset = 30 + Math.abs(y2 - y1) * 0.15;
            const midY = (y1 + y2) / 2;

            const path = document.createElementNS(this.SVG_NS, 'path');
            const d = `M${x1},${y1} C${x1 + arcOffset},${y1} ${x2 + arcOffset},${y2} ${x2},${y2}`;
            path.setAttribute('d', d);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', '#ef9a9a');
            path.setAttribute('stroke-width', '1.2');
            path.setAttribute('stroke-opacity', '0.6');
            path.setAttribute('stroke-dasharray', '6 3');
            path.classList.add('lineage-edge', 'relationship');
            path.dataset.from = edge.from;
            path.dataset.to = edge.to;
            path.dataset.edgeType = 'has_relationship';

            // Insert before nodes
            const firstNode = svg.querySelector('.lineage-node');
            if (firstNode) {
                svg.insertBefore(path, firstNode);
            } else {
                svg.appendChild(path);
            }

            // Label at midpoint
            const label = `${edge.fromColumn || ''} \u2194 ${edge.toColumn || ''}`;
            if (edge.fromColumn && edge.toColumn) {
                const labelEl = this._createText(
                    this._truncate(label, 30),
                    x1 + arcOffset * 0.6, midY,
                    { fontSize: '9px', fill: '#c62828', textAnchor: 'start' }
                );
                labelEl.setAttribute('opacity', '0.7');
                if (firstNode) {
                    svg.insertBefore(labelEl, firstNode);
                } else {
                    svg.appendChild(labelEl);
                }
            }
        }
    }

    _drawEdge(svg, fromItem, toItem, type) {
        // Determine direction: right item connects to left
        const fromRight = fromItem._x > toItem._x;
        let x1, y1, x2, y2;

        if (fromRight) {
            x1 = fromItem._x;
            y1 = fromItem._y + fromItem._h / 2;
            x2 = toItem._x + toItem._w;
            y2 = toItem._y + toItem._h / 2;
        } else {
            x1 = fromItem._x + fromItem._w;
            y1 = fromItem._y + fromItem._h / 2;
            x2 = toItem._x;
            y2 = toItem._y + toItem._h / 2;
        }

        const cpOffset = Math.abs(x2 - x1) * 0.4;
        const path = document.createElementNS(this.SVG_NS, 'path');
        const d = `M${x1},${y1} C${x1 + (fromRight ? -cpOffset : cpOffset)},${y1} ${x2 + (fromRight ? cpOffset : -cpOffset)},${y2} ${x2},${y2}`;
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', this.colors.edge);
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-opacity', '0.5');
        path.classList.add('lineage-edge');
        path.dataset.from = fromItem.id;
        path.dataset.to = toItem.id;
        path.dataset.edgeType = type;

        // Insert edges before nodes so they render behind
        const firstNode = svg.querySelector('.lineage-node');
        if (firstNode) {
            svg.insertBefore(path, firstNode);
        } else {
            svg.appendChild(path);
        }
    }

    // ──────────────────────────────────────────────
    // INTERACTIVITY
    // ──────────────────────────────────────────────

    _initInteractivity(svg, origWidth, origHeight, container) {
        if (this._cleanupFn) this._cleanupFn();

        let vb = { x: 0, y: 0, w: origWidth, h: origHeight };
        const origVB = { ...vb };
        const MIN_SCALE = 0.25;
        const MAX_SCALE = 4;

        const updateViewBox = () => {
            svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        };

        // Mouse wheel zoom
        const onWheel = (e) => {
            e.preventDefault();
            const rect = svg.getBoundingClientRect();
            const mx = (e.clientX - rect.left) / rect.width;
            const my = (e.clientY - rect.top) / rect.height;
            const factor = e.deltaY > 0 ? 1.1 : 0.9;
            const newW = vb.w * factor;
            const newH = vb.h * factor;
            if (newW < origVB.w * MIN_SCALE || newW > origVB.w * MAX_SCALE) return;
            vb.x += (vb.w - newW) * mx;
            vb.y += (vb.h - newH) * my;
            vb.w = newW;
            vb.h = newH;
            updateViewBox();
        };
        svg.addEventListener('wheel', onWheel, { passive: false });

        // Pan
        let isPanning = false;
        let panStart = { x: 0, y: 0 };

        const onMouseDown = (e) => {
            if (e.target.closest('.lineage-node')) return;
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            container.classList.add('panning');
        };
        svg.addEventListener('mousedown', onMouseDown);

        const onMouseMove = (e) => {
            if (!isPanning) return;
            const rect = svg.getBoundingClientRect();
            const scale = vb.w / rect.width;
            vb.x -= (e.clientX - panStart.x) * scale;
            vb.y -= (e.clientY - panStart.y) * scale;
            panStart = { x: e.clientX, y: e.clientY };
            updateViewBox();
        };

        const onMouseUp = () => {
            isPanning = false;
            container.classList.remove('panning');
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);

        // Hover highlighting
        const allNodes = [...svg.querySelectorAll('.lineage-node')];
        const allEdges = [...svg.querySelectorAll('.lineage-edge')];

        const edgesByNode = new Map();
        for (const edge of allEdges) {
            const from = edge.dataset.from;
            const to = edge.dataset.to;
            if (!edgesByNode.has(from)) edgesByNode.set(from, []);
            if (!edgesByNode.has(to)) edgesByNode.set(to, []);
            edgesByNode.get(from).push(edge);
            edgesByNode.get(to).push(edge);
        }

        for (const nodeEl of allNodes) {
            const nodeId = nodeEl.dataset.nodeId;
            nodeEl.addEventListener('mouseenter', () => {
                const connectedNodes = new Set([nodeId]);
                const myEdges = edgesByNode.get(nodeId) || [];

                for (const edge of allEdges) {
                    if (myEdges.includes(edge)) {
                        edge.setAttribute('stroke', this.colors.edgeHighlight);
                        edge.setAttribute('stroke-width', '2.5');
                        edge.setAttribute('stroke-opacity', '1');
                        connectedNodes.add(edge.dataset.from);
                        connectedNodes.add(edge.dataset.to);
                    } else {
                        edge.setAttribute('stroke-opacity', '0.15');
                    }
                }

                for (const n of allNodes) {
                    if (!connectedNodes.has(n.dataset.nodeId)) {
                        n.style.opacity = '0.2';
                    }
                }
            });

            nodeEl.addEventListener('mouseleave', () => {
                for (const edge of allEdges) {
                    const isRel = edge.dataset.edgeType === 'has_relationship';
                    edge.setAttribute('stroke', isRel ? '#ef9a9a' : this.colors.edge);
                    edge.setAttribute('stroke-width', isRel ? '1.2' : '1.5');
                    edge.setAttribute('stroke-opacity', isRel ? '0.6' : '0.5');
                }
                for (const n of allNodes) {
                    n.style.opacity = '1';
                }
            });

            // Click to navigate or expand
            nodeEl.addEventListener('click', () => {
                const type = nodeEl.dataset.nodeType;
                const id = nodeEl.dataset.nodeId;

                // Table nodes: toggle expand in full lineage view only
                if (type === 'table' && this._isFullLineageView) {
                    const tableName = id.replace('table:', '');
                    const connCols = this._getConnectedColumns(tableName);
                    if (connCols.length > 0) {
                        // Save viewBox state
                        const currentVB = svg.getAttribute('viewBox');
                        if (this._expandedTables.has(tableName)) {
                            this._expandedTables.delete(tableName);
                        } else {
                            this._expandedTables.add(tableName);
                        }
                        // Re-render full lineage, preserving viewBox
                        this.renderFullLineage(container);
                        if (currentVB) {
                            const newSvg = container.querySelector('svg');
                            if (newSvg) newSvg.setAttribute('viewBox', currentVB);
                        }
                        return;
                    }
                }

                svg.dispatchEvent(new CustomEvent('lineage-navigate', {
                    bubbles: true,
                    detail: { type, id }
                }));
            });

            nodeEl.style.cursor = 'pointer';
        }

        this._cleanupFn = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
    }

    // ──────────────────────────────────────────────
    // SVG HELPERS
    // ──────────────────────────────────────────────

    _clearContainer(container) {
        if (this._cleanupFn) {
            this._cleanupFn();
            this._cleanupFn = null;
        }
        const existingSvg = container.querySelector('svg');
        if (existingSvg) existingSvg.remove();
        const existingP = container.querySelector('p');
        if (existingP) existingP.remove();
    }

    _createSVG(width, height) {
        const svg = document.createElementNS(this.SVG_NS, 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
        svg.setAttribute('xmlns', this.SVG_NS);
        svg.style.background = this.colors.bg;
        svg.style.borderRadius = '8px';
        svg.style.border = `1px solid ${this.colors.border}`;
        return svg;
    }

    _createRect(x, y, width, height, attrs = {}) {
        const rect = document.createElementNS(this.SVG_NS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', width);
        rect.setAttribute('height', height);
        if (attrs.fill) rect.setAttribute('fill', attrs.fill);
        if (attrs.stroke) rect.setAttribute('stroke', attrs.stroke);
        if (attrs.strokeWidth) rect.setAttribute('stroke-width', attrs.strokeWidth);
        if (attrs.rx) rect.setAttribute('rx', attrs.rx);
        return rect;
    }

    _createText(text, x, y, attrs = {}) {
        const el = document.createElementNS(this.SVG_NS, 'text');
        el.setAttribute('x', x);
        el.setAttribute('y', y);
        el.textContent = text;
        if (attrs.fontSize) el.style.fontSize = attrs.fontSize;
        if (attrs.fontWeight) el.style.fontWeight = attrs.fontWeight;
        if (attrs.fill) el.setAttribute('fill', attrs.fill);
        if (attrs.textAnchor) el.setAttribute('text-anchor', attrs.textAnchor);
        el.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
        return el;
    }

    _truncate(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen - 1) + '\u2026' : str;
    }

    _formatSourceName(source) {
        const parts = [source.type];
        const server = source.serverResolved || source.server;
        if (server) parts.push(server);
        if (source.database) parts.push(source.database);
        if (source.url) parts.push(source.url);
        if (source.path) parts.push(source.path);
        return parts.join(': ');
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = LineageDiagramRenderer;
}
