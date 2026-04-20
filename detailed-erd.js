/**
 * Detailed ERD Module
 * Full-detail Entity Relationship Diagram with all columns, measures, and row-level relationship lines.
 * Designed for printing on large format paper.
 */

class DetailedERDRenderer {
    constructor(container) {
        this.container = container;
        this.SVG_NS = 'http://www.w3.org/2000/svg';
        this.colors = {
            primary: '#1a3a5c',
            accent: '#c89632',
            bg: '#ffffff',
            border: '#d0ccc4',
            text: '#2c2c2c',
            textLight: '#666666',
            headerBg: '#1a3a5c',
            pkRow: '#dce8f5',
            fkRow: '#e3edf7',
            calcRow: '#e8f5e9',
            measureHeader: '#f5ecd7',
            measureRow: '#fdf8ed',
            hiddenOpacity: '0.45',
            linePrimary: '#1a3a5c',
            lineInactive: '#c62828',
            hierarchyHeader: '#ede7f6',
            hierarchyRow: '#f3f0fa'
        };

        // Dimensions
        this.BOX_WIDTH = 280;
        this.HEADER_H = 34;
        this.SUBTITLE_H = 20;
        this.ROW_H = 20;
        this.SECTION_H = 18;
        this.PAD_BOTTOM = 6;
        this.COL_GAP = 60;
        this.ROW_GAP = 40;

        // Large model adaptive sizing
        this.SMALL_ROW_H = 16;
        this.SMALL_FONT = '9px';
        this.LARGE_THRESHOLD = 30; // tables
    }

    // ──────────────────────────────────────────────
    // PUBLIC API
    // ──────────────────────────────────────────────

    /**
     * Render detailed ERD
     * @param {Array} tables - Parsed tables from TMDL parser
     * @param {Array} relationships - Parsed relationships
     */
    render(tables, relationships) {
        // Remove existing SVG but keep controls
        const existingSvg = this.container.querySelector('svg');
        if (existingSvg) existingSvg.remove();
        const existingP = this.container.querySelector('p');
        if (existingP) existingP.remove();

        // Filter out auto-date tables
        const visibleTables = tables.filter(t => !t._isAutoDate);

        if (visibleTables.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'text-align:center;color:#666;padding:40px;';
            p.textContent = 'No tables found in this model.';
            this.container.appendChild(p);
            return;
        }

        // Adaptive sizing for large models
        const isLarge = visibleTables.length > this.LARGE_THRESHOLD;
        if (isLarge) {
            this.ROW_H = this.SMALL_ROW_H;
        } else {
            this.ROW_H = 20;
        }

        // Build PK/FK lookup from relationships
        const pkColumns = new Map(); // tableName → Set<colName>
        const fkColumns = new Map(); // tableName → Set<colName>
        for (const rel of relationships) {
            // The "to" side with cardinality "one" is typically the PK side
            if (rel.toTable && rel.toColumn) {
                if (!pkColumns.has(rel.toTable)) pkColumns.set(rel.toTable, new Set());
                pkColumns.get(rel.toTable).add(rel.toColumn);
            }
            if (rel.fromTable && rel.fromColumn) {
                if (!fkColumns.has(rel.fromTable)) fkColumns.set(rel.fromTable, new Set());
                fkColumns.get(rel.fromTable).add(rel.fromColumn);
            }
        }

        // Build node data
        const nodes = this._buildNodes(visibleTables, pkColumns, fkColumns);
        const nodeMap = new Map(nodes.map(n => [n.name, n]));

        // Layout
        this._gridLayout(nodes, relationships);

        // Calculate SVG bounds
        let maxX = 0, maxY = 0;
        for (const n of nodes) {
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
        }
        const svgWidth = maxX + 80;
        const svgHeight = maxY + 120;

        const svg = this._createSVG(svgWidth, svgHeight);

        // Defs (markers, filters)
        svg.appendChild(this._createDefs());

        // Title
        svg.appendChild(this._createText('Detailed Entity Relationship Diagram', svgWidth / 2, 30, {
            fontSize: '18px', fontWeight: '700', fill: this.colors.primary, textAnchor: 'middle'
        }));

        // Draw relationship lines first (behind nodes)
        for (const rel of relationships) {
            const fromNode = nodeMap.get(rel.fromTable);
            const toNode = nodeMap.get(rel.toTable);
            if (!fromNode || !toNode) continue;
            this._drawRelationshipLine(svg, fromNode, toNode, rel);
        }

        // Draw table nodes on top
        for (const node of nodes) {
            this._drawTableNode(svg, node);
        }

        // Legend
        this._drawLegend(svg, svgWidth, svgHeight);

        this.container.appendChild(svg);

        // Initialize interactivity (zoom, pan, hover)
        this._initInteractivity(svg, svgWidth, svgHeight);
    }

    // ──────────────────────────────────────────────
    // NODE BUILDING
    // ──────────────────────────────────────────────

    _buildNodes(tables, pkColumns, fkColumns) {
        const nodes = [];
        for (const table of tables) {
            const pk = pkColumns.get(table.name) || new Set();
            const fk = fkColumns.get(table.name) || new Set();

            // Sort columns: PK first, then FK, then regular, then hidden
            const columns = [...table.columns].sort((a, b) => {
                const aScore = pk.has(a.name) ? 0 : fk.has(a.name) ? 1 : a.isHidden ? 3 : 2;
                const bScore = pk.has(b.name) ? 0 : fk.has(b.name) ? 1 : b.isHidden ? 3 : 2;
                return aScore - bScore || a.name.localeCompare(b.name);
            });

            const measures = [...table.measures].sort((a, b) => a.name.localeCompare(b.name));

            // Calculate height
            let height = this.HEADER_H + this.SUBTITLE_H;
            // Columns section
            if (columns.length > 0) {
                height += this.SECTION_H; // section header
                height += columns.length * this.ROW_H;
            }
            // Measures section
            if (measures.length > 0) {
                height += this.SECTION_H; // section header
                height += measures.length * this.ROW_H;
            }
            // Calculation items section
            const hasCalcGroup = !!(table.calculationGroup && table.calculationGroup.items);
            const calcItems = hasCalcGroup ? table.calculationGroup.items : [];
            if (calcItems.length > 0) {
                height += this.SECTION_H;
                height += calcItems.length * this.ROW_H;
            }
            // Hierarchies section
            const hierarchies = table.hierarchies || [];
            if (hierarchies.length > 0) {
                height += this.SECTION_H;
                for (const h of hierarchies) {
                    height += this.ROW_H; // hierarchy name
                    height += (h.levels || []).length * this.ROW_H; // levels
                }
            }
            height += this.PAD_BOTTOM;

            // Build column row Y offsets for relationship line targeting
            const columnYOffsets = new Map();
            let yOffset = this.HEADER_H + this.SUBTITLE_H + this.SECTION_H;
            for (const col of columns) {
                columnYOffsets.set(col.name, yOffset + this.ROW_H / 2);
                yOffset += this.ROW_H;
            }

            // Storage mode from partitions
            let storageMode = '';
            if (table.partitions && table.partitions.length > 0) {
                storageMode = table.partitions[0].mode || '';
            }

            const isCalc = !!(table.calculationGroup && table.calculationGroup.items);

            nodes.push({
                name: table.name,
                columns,
                measures,
                hierarchies,
                pk,
                fk,
                width: this.BOX_WIDTH,
                height,
                columnYOffsets,
                storageMode,
                isCalcGroup: isCalc,
                isFieldParameter: !!table._isFieldParameter,
                calcItems: isCalc ? table.calculationGroup.items : [],
                x: 0,
                y: 0
            });
        }
        return nodes;
    }

    // ──────────────────────────────────────────────
    // LAYOUT: BFS COLUMN GRID
    // ──────────────────────────────────────────────

    _gridLayout(nodes, relationships) {
        const nodeMap = new Map(nodes.map(n => [n.name, n]));

        // 1. Detect fact table: most many-side relationships
        const manySideCounts = {};
        for (const node of nodes) manySideCounts[node.name] = 0;

        for (const rel of relationships) {
            const fromCard = rel.fromCardinality || 'many';
            const toCard = rel.toCardinality || 'one';
            if (fromCard === 'many' && manySideCounts[rel.fromTable] !== undefined) {
                manySideCounts[rel.fromTable]++;
            }
            if (toCard === 'many' && manySideCounts[rel.toTable] !== undefined) {
                manySideCounts[rel.toTable]++;
            }
        }

        let factTable = nodes[0]?.name;
        let maxCount = -1;
        for (const [name, count] of Object.entries(manySideCounts)) {
            if (count > maxCount || (count === maxCount && name < factTable)) {
                factTable = name;
                maxCount = count;
            }
        }

        // 2. Build adjacency list
        const adj = {};
        for (const node of nodes) adj[node.name] = new Set();
        for (const rel of relationships) {
            if (adj[rel.fromTable]) adj[rel.fromTable].add(rel.toTable);
            if (adj[rel.toTable]) adj[rel.toTable].add(rel.fromTable);
        }

        // 3. BFS from fact table
        const visited = new Set([factTable]);
        const depthMap = new Map([[factTable, 0]]);
        const columns = [[factTable]]; // columns[depth] = [tableNames]
        let frontier = [factTable];

        while (frontier.length > 0) {
            const nextFrontier = [];
            for (const current of frontier) {
                for (const neighbor of (adj[current] || [])) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        nextFrontier.push(neighbor);
                        const depth = depthMap.get(current) + 1;
                        depthMap.set(neighbor, depth);
                        while (columns.length <= depth) columns.push([]);
                        columns[depth].push(neighbor);
                    }
                }
            }
            frontier = nextFrontier;
        }

        // Disconnected tables
        const disconnected = nodes.filter(n => !visited.has(n.name));

        // 4. Position columns left-to-right
        const startX = 60;
        const startY = 60;
        let currentX = startX;

        for (const col of columns) {
            // Sort tables in each column by height descending for better packing
            const colNodes = col.map(name => nodeMap.get(name)).filter(Boolean);
            colNodes.sort((a, b) => b.height - a.height);

            let currentY = startY;
            for (const node of colNodes) {
                node.x = currentX;
                node.y = currentY;
                currentY += node.height + this.ROW_GAP;
            }

            // Advance X by box width + gap
            if (colNodes.length > 0) {
                currentX += this.BOX_WIDTH + this.COL_GAP;
            }
        }

        // 5. Position disconnected tables in rows below
        if (disconnected.length > 0) {
            let maxY = 0;
            for (const n of nodes) {
                if (n.y !== undefined && visited.has(n.name)) {
                    maxY = Math.max(maxY, n.y + n.height);
                }
            }

            const disconnectedStartY = maxY + 80;
            let dx = startX;
            let dy = disconnectedStartY;
            const maxRowWidth = Math.max(currentX, 1200);
            let rowMaxHeight = 0;

            for (const node of disconnected) {
                if (dx + node.width > maxRowWidth && dx > startX) {
                    dx = startX;
                    dy += rowMaxHeight + this.ROW_GAP;
                    rowMaxHeight = 0;
                }
                node.x = dx;
                node.y = dy;
                rowMaxHeight = Math.max(rowMaxHeight, node.height);
                dx += node.width + this.COL_GAP;
            }
        }

        // 6. Collision resolution (3 passes)
        for (let pass = 0; pass < 3; pass++) {
            for (let i = 0; i < nodes.length; i++) {
                for (let j = i + 1; j < nodes.length; j++) {
                    const a = nodes[i], b = nodes[j];
                    const overlapX = (a.width / 2 + b.width / 2 + 20) -
                        Math.abs((a.x + a.width / 2) - (b.x + b.width / 2));
                    const overlapY = (a.height / 2 + b.height / 2 + 20) -
                        Math.abs((a.y + a.height / 2) - (b.y + b.height / 2));
                    if (overlapX > 0 && overlapY > 0) {
                        const pushAxis = overlapX < overlapY ? 'x' : 'y';
                        const push = (pushAxis === 'x' ? overlapX : overlapY) / 2 + 5;
                        const sign = (pushAxis === 'x')
                            ? (a.x < b.x ? -1 : 1)
                            : (a.y < b.y ? -1 : 1);
                        a[pushAxis] += sign * push;
                        b[pushAxis] -= sign * push;
                    }
                }
            }
        }

        // 7. Normalize to positive coordinates
        let minX = Infinity, minY = Infinity;
        for (const n of nodes) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
        }
        const padding = 60;
        for (const n of nodes) {
            n.x -= minX - padding;
            n.y -= minY - padding - 40; // extra space for title
        }
    }

    // ──────────────────────────────────────────────
    // TABLE NODE DRAWING
    // ──────────────────────────────────────────────

    _drawTableNode(svg, node) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        g.setAttribute('class', 'table-node');
        g.setAttribute('data-table-name', node.name);

        // Shadow
        g.appendChild(this._createRect(node.x + 3, node.y + 3, node.width, node.height, {
            fill: 'rgba(0,0,0,0.08)', rx: '6'
        }));

        // Background
        g.appendChild(this._createRect(node.x, node.y, node.width, node.height, {
            fill: this.colors.bg, stroke: this.colors.border, strokeWidth: '2', rx: '6'
        }));

        // Header
        const headerColor = node.isFieldParameter ? '#6a1b9a'
            : node.isCalcGroup ? '#5c3d1a'
            : this.colors.headerBg;
        g.appendChild(this._createRect(node.x, node.y, node.width, this.HEADER_H, {
            fill: headerColor, rx: '6'
        }));
        // Square off header bottom corners
        g.appendChild(this._createRect(node.x, node.y + this.HEADER_H - 10, node.width, 10, {
            fill: headerColor
        }));

        // Table name (full, no truncation up to 40 chars)
        const displayName = this._truncate(node.name, 38);
        g.appendChild(this._createText(displayName, node.x + 10, node.y + 22, {
            fontSize: '13px', fontWeight: '700', fill: '#ffffff'
        }));

        // Storage mode badge in header
        if (node.storageMode) {
            const modeLabel = node.storageMode === 'import' || node.storageMode === 'Import'
                ? 'Import' : node.storageMode;
            const badgeX = node.x + node.width - 8;
            g.appendChild(this._createText(modeLabel, badgeX, node.y + 22, {
                fontSize: '10px', fill: 'rgba(255,255,255,0.7)', textAnchor: 'end'
            }));
        }

        // Subtitle bar
        const subtitleY = node.y + this.HEADER_H;
        g.appendChild(this._createRect(node.x, subtitleY, node.width, this.SUBTITLE_H, {
            fill: '#f0ede8'
        }));
        const parts = [];
        if (node.columns.length > 0) parts.push(`${node.columns.length} col${node.columns.length !== 1 ? 's' : ''}`);
        if (node.measures.length > 0) parts.push(`${node.measures.length} meas`);
        if (node.isFieldParameter) parts.push('Field Param');
        else if (node.isCalcGroup) parts.push('Calc Group');
        g.appendChild(this._createText(parts.join(' · '), node.x + 10, subtitleY + 14, {
            fontSize: '10px', fill: this.colors.textLight
        }));

        let currentY = subtitleY + this.SUBTITLE_H;

        // ── COLUMNS SECTION ──
        if (node.columns.length > 0) {
            // Section header
            g.appendChild(this._createRect(node.x, currentY, node.width, this.SECTION_H, {
                fill: '#e8edf2'
            }));
            g.appendChild(this._createText('COLUMNS', node.x + 10, currentY + 13, {
                fontSize: '9px', fontWeight: '700', fill: this.colors.primary
            }));
            currentY += this.SECTION_H;

            // Column rows
            for (const col of node.columns) {
                const isPK = node.pk.has(col.name);
                const isFK = node.fk.has(col.name);
                const isCalc = !col.sourceColumn && col.expression;
                const isHidden = col.isHidden;

                // Row background
                let rowBg = null;
                if (isPK) rowBg = this.colors.pkRow;
                else if (isFK) rowBg = this.colors.fkRow;
                else if (isCalc) rowBg = this.colors.calcRow;

                if (rowBg) {
                    g.appendChild(this._createRect(node.x + 1, currentY, node.width - 2, this.ROW_H, {
                        fill: rowBg
                    }));
                }

                const rowG = document.createElementNS(this.SVG_NS, 'g');
                if (isHidden) rowG.setAttribute('opacity', this.colors.hiddenOpacity);

                // Badge
                let badge = '';
                if (isPK) badge = 'PK';
                else if (isFK) badge = 'FK';
                else if (isCalc) badge = 'fx';

                // Column name
                const nameMaxLen = badge ? 22 : 26;
                rowG.appendChild(this._createText(
                    this._truncate(col.name, nameMaxLen),
                    node.x + 10, currentY + this.ROW_H - 5,
                    { fontSize: '11px', fill: this.colors.text }
                ));

                // Data type (right-aligned)
                if (col.dataType) {
                    const dtX = badge ? node.x + node.width - 42 : node.x + node.width - 10;
                    rowG.appendChild(this._createText(
                        col.dataType, dtX, currentY + this.ROW_H - 5,
                        { fontSize: '10px', fill: this.colors.textLight, textAnchor: 'end' }
                    ));
                }

                // PK/FK/calc badge
                if (badge) {
                    const badgeX = node.x + node.width - 10;
                    const badgeColor = isPK ? '#1565c0' : isFK ? '#e65100' : '#2e7d32';
                    rowG.appendChild(this._createText(badge, badgeX, currentY + this.ROW_H - 5, {
                        fontSize: '9px', fontWeight: '700', fill: badgeColor, textAnchor: 'end'
                    }));
                }

                // Hidden badge
                if (isHidden && !badge) {
                    rowG.appendChild(this._createText('H', node.x + node.width - 10, currentY + this.ROW_H - 5, {
                        fontSize: '9px', fontWeight: '600', fill: '#999', textAnchor: 'end'
                    }));
                }

                g.appendChild(rowG);
                currentY += this.ROW_H;
            }
        }

        // ── MEASURES SECTION ──
        if (node.measures.length > 0) {
            // Section header with amber accent
            g.appendChild(this._createRect(node.x, currentY, node.width, this.SECTION_H, {
                fill: this.colors.measureHeader
            }));
            g.appendChild(this._createText('MEASURES', node.x + 10, currentY + 13, {
                fontSize: '9px', fontWeight: '700', fill: '#8b6e00'
            }));
            currentY += this.SECTION_H;

            for (const m of node.measures) {
                // Subtle background
                g.appendChild(this._createRect(node.x + 1, currentY, node.width - 2, this.ROW_H, {
                    fill: this.colors.measureRow
                }));

                const mG = document.createElementNS(this.SVG_NS, 'g');
                if (m.isHidden) mG.setAttribute('opacity', this.colors.hiddenOpacity);

                mG.appendChild(this._createText(
                    this._truncate(m.name, 34),
                    node.x + 10, currentY + this.ROW_H - 5,
                    { fontSize: '11px', fill: '#5d4e00' }
                ));

                // Display folder hint
                if (m.displayFolder) {
                    mG.appendChild(this._createText(
                        this._truncate(m.displayFolder, 14),
                        node.x + node.width - 10, currentY + this.ROW_H - 5,
                        { fontSize: '9px', fill: '#aaa', textAnchor: 'end' }
                    ));
                }

                g.appendChild(mG);
                currentY += this.ROW_H;
            }
        }

        // ── CALCULATION ITEMS SECTION ──
        if (node.isCalcGroup && node.calcItems.length > 0) {
            g.appendChild(this._createRect(node.x, currentY, node.width, this.SECTION_H, {
                fill: '#e8d5b8'
            }));
            g.appendChild(this._createText('CALC ITEMS', node.x + 10, currentY + 13, {
                fontSize: '9px', fontWeight: '700', fill: '#5c3d1a'
            }));
            currentY += this.SECTION_H;

            for (const item of node.calcItems) {
                const ciG = document.createElementNS(this.SVG_NS, 'g');
                ciG.appendChild(this._createText(
                    this._truncate(item.name, 34),
                    node.x + 10, currentY + this.ROW_H - 5,
                    { fontSize: '11px', fill: '#5c3d1a' }
                ));
                g.appendChild(ciG);
                currentY += this.ROW_H;
            }
        }

        // ── HIERARCHIES SECTION ──
        if (node.hierarchies && node.hierarchies.length > 0) {
            g.appendChild(this._createRect(node.x, currentY, node.width, this.SECTION_H, {
                fill: this.colors.hierarchyHeader
            }));
            g.appendChild(this._createText('HIERARCHIES', node.x + 10, currentY + 13, {
                fontSize: '9px', fontWeight: '700', fill: '#5e35b1'
            }));
            currentY += this.SECTION_H;

            for (const h of node.hierarchies) {
                g.appendChild(this._createRect(node.x + 1, currentY, node.width - 2, this.ROW_H, {
                    fill: this.colors.hierarchyRow
                }));
                g.appendChild(this._createText(
                    this._truncate(h.name, 30),
                    node.x + 10, currentY + this.ROW_H - 5,
                    { fontSize: '11px', fontWeight: '600', fill: '#5e35b1' }
                ));
                currentY += this.ROW_H;

                for (const level of (h.levels || [])) {
                    g.appendChild(this._createText(
                        '  └ ' + this._truncate(level.name || level.column, 28),
                        node.x + 16, currentY + this.ROW_H - 5,
                        { fontSize: '10px', fill: this.colors.textLight }
                    ));
                    currentY += this.ROW_H;
                }
            }
        }

        svg.appendChild(g);
    }

    // ──────────────────────────────────────────────
    // RELATIONSHIP LINES
    // ──────────────────────────────────────────────

    _drawRelationshipLine(svg, fromNode, toNode, rel) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        g.setAttribute('class', 'rel-line');
        g.setAttribute('data-from', rel.fromTable);
        g.setAttribute('data-to', rel.toTable);

        // Get Y offsets for the specific columns in each table
        const fromColY = fromNode.columnYOffsets.get(rel.fromColumn);
        const toColY = toNode.columnYOffsets.get(rel.toColumn);

        // Connection points: use column-level Y when available, otherwise center
        const fromCenterY = fromColY !== undefined ? fromNode.y + fromColY : fromNode.y + fromNode.height / 2;
        const toCenterY = toColY !== undefined ? toNode.y + toColY : toNode.y + toNode.height / 2;

        // Determine left/right connection side
        const fromCenterX = fromNode.x + fromNode.width / 2;
        const toCenterX = toNode.x + toNode.width / 2;

        let fromX, toX;
        if (fromCenterX < toCenterX) {
            fromX = fromNode.x + fromNode.width;
            toX = toNode.x;
        } else {
            fromX = fromNode.x;
            toX = toNode.x + toNode.width;
        }

        // Bezier curve
        const dx = toX - fromX;
        const controlOffset = Math.min(Math.abs(dx) * 0.4, 100);

        const cp1x = fromX + (fromCenterX < toCenterX ? controlOffset : -controlOffset);
        const cp2x = toX + (fromCenterX < toCenterX ? -controlOffset : controlOffset);

        const path = document.createElementNS(this.SVG_NS, 'path');
        path.setAttribute('d', `M ${fromX} ${fromCenterY} C ${cp1x} ${fromCenterY}, ${cp2x} ${toCenterY}, ${toX} ${toCenterY}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', rel.isActive !== false ? this.colors.linePrimary : this.colors.lineInactive);
        path.setAttribute('stroke-width', rel.isActive !== false ? '1.5' : '1');

        if (rel.isActive === false) {
            path.setAttribute('stroke-dasharray', '6,4');
        }

        g.appendChild(path);

        // Cardinality labels near endpoints
        const fromCard = rel.fromCardinality || 'many';
        const toCard = rel.toCardinality || 'one';
        const fromLabel = fromCard === 'many' ? '*' : '1';
        const toLabel = toCard === 'many' ? '*' : '1';

        // Near the from endpoint
        const fLabelX = fromX + (fromCenterX < toCenterX ? 8 : -8);
        g.appendChild(this._createText(fromLabel, fLabelX, fromCenterY - 5, {
            fontSize: '12px', fontWeight: '700',
            fill: fromCard === 'many' ? '#e65100' : '#1565c0',
            textAnchor: 'middle'
        }));

        // Near the to endpoint
        const tLabelX = toX + (fromCenterX < toCenterX ? -8 : 8);
        g.appendChild(this._createText(toLabel, tLabelX, toCenterY - 5, {
            fontSize: '12px', fontWeight: '700',
            fill: toCard === 'many' ? '#e65100' : '#1565c0',
            textAnchor: 'middle'
        }));

        // Column names along the line (at midpoint)
        const midX = (fromX + toX) / 2;
        const midY = (fromCenterY + toCenterY) / 2;
        const colLabel = `${rel.fromColumn} → ${rel.toColumn}`;

        // Label background
        const labelWidth = Math.min(colLabel.length * 6 + 12, 180);
        g.appendChild(this._createRect(midX - labelWidth / 2, midY - 8, labelWidth, 14, {
            fill: 'rgba(255,255,255,0.9)', rx: '3', stroke: this.colors.border, strokeWidth: '0.5'
        }));
        g.appendChild(this._createText(this._truncate(colLabel, 28), midX, midY + 3, {
            fontSize: '9px', fill: this.colors.textLight, textAnchor: 'middle'
        }));

        svg.appendChild(g);
    }

    // ──────────────────────────────────────────────
    // LEGEND
    // ──────────────────────────────────────────────

    _drawLegend(svg, svgWidth, svgHeight) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        const lx = 20;
        const ly = svgHeight - 80;

        g.appendChild(this._createRect(lx, ly, 560, 65, {
            fill: '#f8f6f2', stroke: this.colors.border, rx: '6'
        }));

        let x = lx + 12;
        const y1 = ly + 20;
        const y2 = ly + 42;

        // Row 1: Column types
        g.appendChild(this._createRect(x, y1 - 10, 12, 12, { fill: this.colors.pkRow, rx: '2' }));
        g.appendChild(this._createText('PK', x + 16, y1, { fontSize: '10px', fontWeight: '700', fill: '#1565c0' }));
        x += 42;

        g.appendChild(this._createRect(x, y1 - 10, 12, 12, { fill: this.colors.fkRow, rx: '2' }));
        g.appendChild(this._createText('FK', x + 16, y1, { fontSize: '10px', fontWeight: '700', fill: '#e65100' }));
        x += 42;

        g.appendChild(this._createRect(x, y1 - 10, 12, 12, { fill: this.colors.calcRow, rx: '2' }));
        g.appendChild(this._createText('fx = Calculated', x + 16, y1, { fontSize: '10px', fill: '#2e7d32' }));
        x += 110;

        g.appendChild(this._createRect(x, y1 - 10, 12, 12, { fill: this.colors.measureRow, rx: '2' }));
        g.appendChild(this._createText('Measure', x + 16, y1, { fontSize: '10px', fill: '#8b6e00' }));
        x += 70;

        g.appendChild(this._createText('H = Hidden', x, y1, { fontSize: '10px', fill: '#999' }));

        // Row 2: Relationship lines
        x = lx + 12;
        const activeLine = document.createElementNS(this.SVG_NS, 'line');
        activeLine.setAttribute('x1', x); activeLine.setAttribute('y1', y2 - 3);
        activeLine.setAttribute('x2', x + 28); activeLine.setAttribute('y2', y2 - 3);
        activeLine.setAttribute('stroke', this.colors.linePrimary); activeLine.setAttribute('stroke-width', '1.5');
        g.appendChild(activeLine);
        g.appendChild(this._createText('Active', x + 34, y2, { fontSize: '10px', fill: this.colors.text }));
        x += 80;

        const inactiveLine = document.createElementNS(this.SVG_NS, 'line');
        inactiveLine.setAttribute('x1', x); inactiveLine.setAttribute('y1', y2 - 3);
        inactiveLine.setAttribute('x2', x + 28); inactiveLine.setAttribute('y2', y2 - 3);
        inactiveLine.setAttribute('stroke', this.colors.lineInactive); inactiveLine.setAttribute('stroke-width', '1');
        inactiveLine.setAttribute('stroke-dasharray', '6,4');
        g.appendChild(inactiveLine);
        g.appendChild(this._createText('Inactive', x + 34, y2, { fontSize: '10px', fill: this.colors.text }));
        x += 90;

        g.appendChild(this._createText('1 = One   * = Many', x, y2, { fontSize: '10px', fill: this.colors.textLight }));

        svg.appendChild(g);
    }

    // ──────────────────────────────────────────────
    // INTERACTIVITY (zoom, pan, hover)
    // ──────────────────────────────────────────────

    _initInteractivity(svg, origWidth, origHeight) {
        if (this._cleanupInteractivity) this._cleanupInteractivity();

        let vb = { x: 0, y: 0, w: origWidth, h: origHeight };
        const origVB = { ...vb };
        const MIN_SCALE = 0.1; // Allow deeper zoom for large diagrams
        const MAX_SCALE = 5;

        const updateViewBox = () => {
            svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        };

        // Zoom buttons (use IDs specific to detailed ERD)
        const zoomIn = document.getElementById('detailedERDZoomIn');
        const zoomOut = document.getElementById('detailedERDZoomOut');
        const zoomReset = document.getElementById('detailedERDZoomReset');

        const onZoomIn = () => {
            if (vb.w < origVB.w * MIN_SCALE) return;
            const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
            vb.w *= 0.8; vb.h *= 0.8;
            vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
            updateViewBox();
        };

        const onZoomOut = () => {
            if (vb.w > origVB.w * MAX_SCALE) return;
            const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
            vb.w *= 1.25; vb.h *= 1.25;
            vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
            updateViewBox();
        };

        const onZoomReset = () => {
            vb = { ...origVB };
            updateViewBox();
        };

        if (zoomIn) zoomIn.addEventListener('click', onZoomIn);
        if (zoomOut) zoomOut.addEventListener('click', onZoomOut);
        if (zoomReset) zoomReset.addEventListener('click', onZoomReset);

        // Mouse wheel zoom
        svg.addEventListener('wheel', (e) => {
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
        }, { passive: false });

        // Pan
        const container = this.container;
        let isPanning = false;
        let panStart = { x: 0, y: 0 };

        svg.addEventListener('mousedown', (e) => {
            if (e.target.closest('.table-node')) return;
            isPanning = true;
            panStart = { x: e.clientX, y: e.clientY };
            container.classList.add('panning');
        });

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

        this._cleanupInteractivity = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (zoomIn) zoomIn.removeEventListener('click', onZoomIn);
            if (zoomOut) zoomOut.removeEventListener('click', onZoomOut);
            if (zoomReset) zoomReset.removeEventListener('click', onZoomReset);
        };

        // Hover-to-highlight
        const allNodeEls = [...svg.querySelectorAll('.table-node')];
        const allRelEls = [...svg.querySelectorAll('.rel-line')];
        const nodeElMap = new Map();
        const relsByTable = new Map();

        allNodeEls.forEach(el => nodeElMap.set(el.dataset.tableName, el));
        allRelEls.forEach(lineEl => {
            const from = lineEl.dataset.from;
            const to = lineEl.dataset.to;
            if (!relsByTable.has(from)) relsByTable.set(from, []);
            if (!relsByTable.has(to)) relsByTable.set(to, []);
            relsByTable.get(from).push(lineEl);
            relsByTable.get(to).push(lineEl);
        });

        allNodeEls.forEach(nodeEl => {
            const name = nodeEl.dataset.tableName;
            const myRels = relsByTable.get(name) || [];
            const myRelSet = new Set(myRels);

            nodeEl.addEventListener('mouseenter', () => {
                const connectedTables = new Set([name]);
                for (const lineEl of allRelEls) {
                    if (myRelSet.has(lineEl)) {
                        lineEl.classList.add('highlighted');
                        connectedTables.add(lineEl.dataset.from);
                        connectedTables.add(lineEl.dataset.to);
                    } else {
                        lineEl.classList.add('dimmed');
                    }
                }
                for (const [nName, nEl] of nodeElMap) {
                    if (connectedTables.has(nName)) {
                        nEl.classList.add('highlighted');
                    } else {
                        nEl.classList.add('dimmed');
                    }
                }
            });

            nodeEl.addEventListener('mouseleave', () => {
                for (const el of allNodeEls) el.classList.remove('highlighted', 'dimmed');
                for (const el of allRelEls) el.classList.remove('highlighted', 'dimmed');
            });

            // Double-click to navigate to table detail
            nodeEl.addEventListener('dblclick', (e) => {
                e.preventDefault();
                if (window.app) window.app.showTableDetail(name);
            });
        });
    }

    // ──────────────────────────────────────────────
    // SVG HELPERS
    // ──────────────────────────────────────────────

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
        if (attrs.fontStyle) el.style.fontStyle = attrs.fontStyle;
        if (attrs.fill) el.setAttribute('fill', attrs.fill);
        if (attrs.textAnchor) el.setAttribute('text-anchor', attrs.textAnchor);
        el.style.fontFamily = "'Segoe UI', system-ui, sans-serif";
        return el;
    }

    _createDefs() {
        const defs = document.createElementNS(this.SVG_NS, 'defs');

        // Arrowhead marker
        const marker = document.createElementNS(this.SVG_NS, 'marker');
        marker.setAttribute('id', 'erd-arrowhead');
        marker.setAttribute('markerWidth', '10');
        marker.setAttribute('markerHeight', '7');
        marker.setAttribute('refX', '10');
        marker.setAttribute('refY', '3.5');
        marker.setAttribute('orient', 'auto');
        const polygon = document.createElementNS(this.SVG_NS, 'polygon');
        polygon.setAttribute('points', '0 0, 10 3.5, 0 7');
        polygon.setAttribute('fill', this.colors.linePrimary);
        marker.appendChild(polygon);
        defs.appendChild(marker);

        return defs;
    }

    _truncate(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen - 1) + '\u2026' : str;
    }
}
