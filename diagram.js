/**
 * Diagram Module
 * SVG rendering for relationship diagrams and visual usage diagrams
 */

class DiagramRenderer {
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
            tableBg: '#f5f2ed',
            tableHeader: '#1a3a5c',
            measureBg: '#fff8e1',
            columnBg: '#e3f2fd',
            visualBg: '#f3e5f5',
            linePrimary: '#1a3a5c',
            lineSecondary: '#c89632',
            activeRel: '#2e7d32',
            inactiveRel: '#c62828',
            one: '#1565c0',
            many: '#e65100'
        };
    }

    // ──────────────────────────────────────────────
    // RELATIONSHIP DIAGRAM
    // ──────────────────────────────────────────────

    /**
     * Render relationship diagram
     * @param {Array} tables - Parsed tables
     * @param {Array} relationships - Parsed relationships
     */
    renderRelationshipDiagram(tables, relationships) {
        // Keep only the SVG area, preserve control buttons
        const existingSvg = this.container.querySelector('svg');
        if (existingSvg) existingSvg.remove();
        const existingPlaceholder = this.container.querySelector('p');
        if (existingPlaceholder) existingPlaceholder.remove();

        if (tables.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'text-align:center;color:#666;padding:40px;';
            p.textContent = 'No tables found in this model.';
            this.container.appendChild(p);
            return;
        }

        // Build map of columns that participate in relationships
        const relColumns = new Map(); // tableName → Set<columnName>
        for (const r of relationships) {
            if (r.fromTable) {
                if (!relColumns.has(r.fromTable)) relColumns.set(r.fromTable, new Set());
                relColumns.get(r.fromTable).add(r.fromColumn);
            }
            if (r.toTable) {
                if (!relColumns.has(r.toTable)) relColumns.set(r.toTable, new Set());
                relColumns.get(r.toTable).add(r.toColumn);
            }
        }

        // Build table nodes: connected vs disconnected
        const connectedNodes = [];
        const disconnectedNodes = [];
        const tableMap = new Map();

        for (const tableData of tables) {
            const tName = tableData.name;
            const measures = tableData.measures.length;

            if (relColumns.has(tName)) {
                // Connected: show only relationship columns
                const relColNames = relColumns.get(tName);
                const columns = tableData.columns
                    .filter(c => relColNames.has(c.name))
                    .map(c => c.name);
                connectedNodes.push({
                    name: tName,
                    columns,
                    totalColumns: tableData.columns.length,
                    measures,
                    isDisconnected: false
                });
            } else {
                // Disconnected: compact node
                disconnectedNodes.push({
                    name: tName,
                    columns: [],
                    totalColumns: tableData.columns.length,
                    measures,
                    isDisconnected: true
                });
            }
        }

        const nodeWidth = 200;
        const compactNodeWidth = 160;
        const nodeMinHeight = 50;
        const compactNodeHeight = 50;
        const rowHeight = 18;

        // Calculate node heights
        for (const node of connectedNodes) {
            node.width = nodeWidth;
            const colRows = node.columns.length;
            // Extra row for "(X of Y cols shown)" note
            const noteRow = node.totalColumns > node.columns.length ? 1 : 0;
            node.height = nodeMinHeight + (colRows + noteRow) * rowHeight;
        }
        for (const node of disconnectedNodes) {
            node.width = compactNodeWidth;
            node.height = compactNodeHeight;
        }

        // Layout connected tables
        if (connectedNodes.length > 0) {
            if (connectedNodes.length < 4) {
                this._horizontalLayout(connectedNodes);
            } else {
                this._starSchemaLayout(connectedNodes, relationships);
            }
        }

        // Layout disconnected tables in a row below connected ones
        if (disconnectedNodes.length > 0) {
            let maxConnectedY = 0;
            for (const n of connectedNodes) {
                maxConnectedY = Math.max(maxConnectedY, (n.y || 0) + n.height);
            }

            const disconnectedStartY = connectedNodes.length > 0 ? maxConnectedY + 80 : 60;
            const gap = 20;
            const maxRowWidth = Math.max(800, connectedNodes.length > 0 ?
                Math.max(...connectedNodes.map(n => n.x + n.width)) : 800);
            let x = 60;
            let y = disconnectedStartY + 24; // 24px for section label

            for (const node of disconnectedNodes) {
                if (x + node.width > maxRowWidth && x > 60) {
                    // Wrap to next row
                    x = 60;
                    y += compactNodeHeight + gap;
                }
                node.x = x;
                node.y = y;
                x += node.width + gap;
            }
        }

        // Combine all nodes
        const allNodes = [...connectedNodes, ...disconnectedNodes];

        // Calculate SVG bounds
        let maxX = 0, maxY = 0;
        for (const n of allNodes) {
            maxX = Math.max(maxX, n.x + n.width);
            maxY = Math.max(maxY, n.y + n.height);
            tableMap.set(n.name, n);
        }
        const svgWidth = maxX + 80;
        const svgHeight = maxY + 100;

        const svg = this._createSVG(svgWidth, svgHeight);

        // Defs for markers
        svg.appendChild(this._createDefs());

        // Title
        svg.appendChild(this._createText('Relationship Diagram', svgWidth / 2, 30, {
            fontSize: '18px', fontWeight: '700', fill: this.colors.primary, textAnchor: 'middle'
        }));

        // Draw relationship bezier lines first (behind nodes)
        for (const rel of relationships) {
            const fromNode = tableMap.get(rel.fromTable);
            const toNode = tableMap.get(rel.toTable);
            if (!fromNode || !toNode) continue;
            this._drawRelationshipBezier(svg, fromNode, toNode, rel);
        }

        // Draw "Standalone Tables" section label if needed
        if (disconnectedNodes.length > 0 && connectedNodes.length > 0) {
            let maxConnectedY = 0;
            for (const n of connectedNodes) {
                maxConnectedY = Math.max(maxConnectedY, n.y + n.height);
            }
            svg.appendChild(this._createText(
                `Standalone Tables (${disconnectedNodes.length})`,
                60, maxConnectedY + 70,
                { fontSize: '13px', fontWeight: '600', fill: this.colors.textLight }
            ));
        }

        // Draw table nodes on top
        for (const node of allNodes) {
            this._drawTableNode(svg, node);
        }

        // Legend
        this._drawRelLegend(svg, svgWidth, svgHeight);

        this.container.appendChild(svg);

        // Initialize zoom/pan/hover interactivity
        this._initInteractivity(svg, svgWidth, svgHeight);
    }

    _horizontalLayout(nodes) {
        const padding = 60;
        const gap = 80;
        let x = padding;
        for (const node of nodes) {
            node.x = x;
            node.y = padding + 40;
            x += node.width + gap;
        }
    }

    _starSchemaLayout(nodes, relationships) {
        // 1. Detect fact table: most many-side relationships
        const manySideCounts = {};
        for (const node of nodes) { manySideCounts[node.name] = 0; }

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

        let factTable = nodes[0].name;
        let maxCount = -1;
        for (const [name, count] of Object.entries(manySideCounts)) {
            if (count > maxCount || (count === maxCount && name < factTable)) {
                factTable = name;
                maxCount = count;
            }
        }

        // 2. Build adjacency list
        const adj = {};
        for (const node of nodes) { adj[node.name] = new Set(); }
        for (const rel of relationships) {
            if (adj[rel.fromTable]) adj[rel.fromTable].add(rel.toTable);
            if (adj[rel.toTable]) adj[rel.toTable].add(rel.fromTable);
        }

        // 3. BFS from fact table
        const visited = new Set([factTable]);
        const rings = [[factTable]];
        let frontier = [factTable];

        while (frontier.length > 0) {
            const nextFrontier = [];
            for (const current of frontier) {
                for (const neighbor of (adj[current] || [])) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        nextFrontier.push(neighbor);
                    }
                }
            }
            if (nextFrontier.length > 0) {
                rings.push(nextFrontier);
            }
            frontier = nextFrontier;
        }

        // Add disconnected tables to outermost ring
        for (const node of nodes) {
            if (!visited.has(node.name)) {
                if (rings.length <= 1) rings.push([]);
                rings[rings.length - 1].push(node.name);
            }
        }

        // 4. Position nodes in concentric rings
        const ringRadius = 250;
        const centerX = ringRadius * Math.max(rings.length - 1, 1) + 150;
        const centerY = centerX;
        const nodeMap = new Map(nodes.map(n => [n.name, n]));

        for (let ringIdx = 0; ringIdx < rings.length; ringIdx++) {
            const ring = rings[ringIdx];
            const radius = ringIdx * ringRadius;

            if (ringIdx === 0) {
                const node = nodeMap.get(ring[0]);
                node.x = centerX - node.width / 2;
                node.y = centerY - node.height / 2;
            } else {
                for (let i = 0; i < ring.length; i++) {
                    const angle = (2 * Math.PI * i / ring.length) - Math.PI / 2;
                    const node = nodeMap.get(ring[i]);
                    node.x = centerX + radius * Math.cos(angle) - node.width / 2;
                    node.y = centerY + radius * Math.sin(angle) - node.height / 2;
                }
            }
        }

        // 5. Normalize to positive coordinates
        let minX = Infinity, minY = Infinity;
        for (const n of nodes) {
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
        }
        const padding = 60;
        for (const n of nodes) {
            n.x -= minX - padding;
            n.y -= minY - padding;
        }
    }

    _createDefs() {
        const defs = document.createElementNS(this.SVG_NS, 'defs');

        const marker = document.createElementNS(this.SVG_NS, 'marker');
        marker.setAttribute('id', 'arrowhead');
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

        const marker2 = marker.cloneNode(true);
        marker2.setAttribute('id', 'arrowhead-start');
        marker2.setAttribute('orient', 'auto-start-reverse');
        defs.appendChild(marker2);

        return defs;
    }

    /**
     * Draw a table node
     */
    _drawTableNode(svg, node) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        g.setAttribute('class', 'table-node');
        g.setAttribute('data-table-name', node.name);

        // Shadow
        const shadow = this._createRect(node.x + 3, node.y + 3, node.width, node.height, {
            fill: 'rgba(0,0,0,0.1)', rx: '6'
        });
        g.appendChild(shadow);

        // Background
        const bgColor = node.isDisconnected ? '#f9f7f4' : this.colors.bg;
        const borderColor = node.isDisconnected ? '#ccc' : this.colors.border;
        const bg = this._createRect(node.x, node.y, node.width, node.height, {
            fill: bgColor, stroke: borderColor, strokeWidth: node.isDisconnected ? '1.5' : '2', rx: '6'
        });
        g.appendChild(bg);

        // Header
        const headerColor = node.isDisconnected ? '#78909c' : this.colors.tableHeader;
        const header = this._createRect(node.x, node.y, node.width, 32, {
            fill: headerColor, rx: '6'
        });
        g.appendChild(header);

        // Header bottom fill (to square off bottom corners of header)
        const headerBottom = this._createRect(node.x, node.y + 20, node.width, 12, {
            fill: headerColor
        });
        g.appendChild(headerBottom);

        // Table name
        const maxNameLen = node.isDisconnected ? 18 : 22;
        const nameText = this._createText(
            this._truncate(node.name, maxNameLen),
            node.x + node.width / 2,
            node.y + 21,
            { fontSize: '13px', fontWeight: '600', fill: '#ffffff', textAnchor: 'middle' }
        );
        g.appendChild(nameText);

        if (node.isDisconnected) {
            // Compact: show summary line "X cols, Y measures"
            const parts = [];
            if (node.totalColumns > 0) parts.push(`${node.totalColumns} col${node.totalColumns !== 1 ? 's' : ''}`);
            if (node.measures > 0) parts.push(`${node.measures} measure${node.measures !== 1 ? 's' : ''}`);
            const summaryText = parts.join(', ') || 'empty';
            g.appendChild(this._createText(
                summaryText,
                node.x + node.width / 2,
                node.y + 44,
                { fontSize: '11px', fill: this.colors.textLight, textAnchor: 'middle' }
            ));
        } else {
            // Connected table: show relationship columns
            const startY = node.y + 44;
            for (let i = 0; i < node.columns.length; i++) {
                const colText = this._createText(
                    this._truncate(node.columns[i], 24),
                    node.x + 12,
                    startY + i * 18,
                    { fontSize: '11px', fill: this.colors.text }
                );
                g.appendChild(colText);
            }

            // Show "(X of Y cols shown)" note if not all columns displayed
            if (node.totalColumns > node.columns.length) {
                g.appendChild(this._createText(
                    `(${node.columns.length} of ${node.totalColumns} cols shown)`,
                    node.x + 12,
                    startY + node.columns.length * 18,
                    { fontSize: '10px', fill: this.colors.textLight, fontStyle: 'italic' }
                ));
            }

            // Measure count badge
            if (node.measures > 0) {
                const badgeX = node.x + node.width - 40;
                const badgeY = node.y + node.height - 16;
                const badge = this._createRect(badgeX, badgeY - 10, 36, 16, {
                    fill: this.colors.measureBg, stroke: this.colors.accent, strokeWidth: '1', rx: '8'
                });
                g.appendChild(badge);
                const badgeText = this._createText(
                    `${node.measures}m`,
                    badgeX + 18,
                    badgeY + 1,
                    { fontSize: '10px', fill: this.colors.accent, fontWeight: '600', textAnchor: 'middle' }
                );
                g.appendChild(badgeText);
            }
        }

        svg.appendChild(g);
    }

    /**
     * Draw a bezier curve relationship between two table nodes
     */
    _drawRelationshipBezier(svg, fromNode, toNode, rel) {
        const from = this._getConnectionPoint(fromNode, toNode);
        const to = this._getConnectionPoint(toNode, fromNode);

        const g = document.createElementNS(this.SVG_NS, 'g');
        g.setAttribute('class', 'rel-line');
        g.setAttribute('data-from', rel.fromTable);
        g.setAttribute('data-to', rel.toTable);

        // Calculate bezier control points with gentle curve
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const curvature = Math.min(dist * 0.2, 60);
        const nx = -dy / dist * curvature;
        const ny = dx / dist * curvature;

        const cp1x = from.x + dx * 0.33 + nx;
        const cp1y = from.y + dy * 0.33 + ny;
        const cp2x = from.x + dx * 0.66 + nx;
        const cp2y = from.y + dy * 0.66 + ny;

        const path = document.createElementNS(this.SVG_NS, 'path');
        path.setAttribute('d', `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', rel.isActive !== false ? this.colors.linePrimary : this.colors.inactiveRel);
        path.setAttribute('stroke-width', rel.isActive !== false ? '2' : '1.5');

        if (rel.isActive === false) {
            path.setAttribute('stroke-dasharray', '6,4');
        }

        if (rel.crossFilteringBehavior === 'bothDirections') {
            path.setAttribute('marker-end', 'url(#arrowhead)');
            path.setAttribute('marker-start', 'url(#arrowhead-start)');
        } else {
            path.setAttribute('marker-end', 'url(#arrowhead)');
        }

        g.appendChild(path);

        // Cardinality label at bezier midpoint
        const midX = (from.x + 3 * cp1x + 3 * cp2x + to.x) / 8;
        const midY = (from.y + 3 * cp1y + 3 * cp2y + to.y) / 8;

        const fromCard = rel.fromCardinality || 'many';
        const toCard = rel.toCardinality || 'one';

        const labelBg = this._createRect(midX - 22, midY - 18, 44, 18, {
            fill: this.colors.bg, rx: '3', stroke: this.colors.border, strokeWidth: '0.5'
        });
        g.appendChild(labelBg);

        const cardText = this._createText(
            `${fromCard === 'many' ? '*' : '1'} : ${toCard === 'many' ? '*' : '1'}`,
            midX, midY - 5,
            {
                fontSize: '11px', fontWeight: '600',
                fill: rel.isActive !== false ? this.colors.primary : this.colors.inactiveRel,
                textAnchor: 'middle'
            }
        );
        g.appendChild(cardText);

        svg.appendChild(g);
    }

    /**
     * Initialize zoom, pan, and hover-to-highlight interactivity
     */
    _initInteractivity(svg, origWidth, origHeight) {
        // Clean up previous window listeners if re-rendering
        if (this._cleanupInteractivity) this._cleanupInteractivity();

        let vb = { x: 0, y: 0, w: origWidth, h: origHeight };
        const origVB = { ...vb };
        const MIN_SCALE = 0.25;
        const MAX_SCALE = 4;

        const updateViewBox = () => {
            svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
        };

        // Zoom buttons
        const zoomIn = document.getElementById('diagramZoomIn');
        const zoomOut = document.getElementById('diagramZoomOut');
        const zoomReset = document.getElementById('diagramZoomReset');

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

        // Mouse wheel zoom (centered on cursor)
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

        // Pan (drag on empty space)
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

        // Store cleanup function for re-renders
        this._cleanupInteractivity = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
            if (zoomIn) zoomIn.removeEventListener('click', onZoomIn);
            if (zoomOut) zoomOut.removeEventListener('click', onZoomOut);
            if (zoomReset) zoomReset.removeEventListener('click', onZoomReset);
        };

        // Build lookup maps once for efficient hover highlighting
        const nodeElMap = new Map();
        const relsByTable = new Map();
        const allNodeEls = [...svg.querySelectorAll('.table-node')];
        const allRelEls = [...svg.querySelectorAll('.rel-line')];

        allNodeEls.forEach(el => nodeElMap.set(el.dataset.tableName, el));
        allRelEls.forEach(lineEl => {
            const from = lineEl.dataset.from;
            const to = lineEl.dataset.to;
            if (!relsByTable.has(from)) relsByTable.set(from, []);
            if (!relsByTable.has(to)) relsByTable.set(to, []);
            relsByTable.get(from).push(lineEl);
            relsByTable.get(to).push(lineEl);
        });

        // Hover-to-highlight
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

    /**
     * Get connection point on the edge of a node closest to target
     */
    _getConnectionPoint(node, target) {
        const cx = node.x + node.width / 2;
        const cy = node.y + node.height / 2;
        const tcx = target.x + target.width / 2;
        const tcy = target.y + target.height / 2;

        const dx = tcx - cx;
        const dy = tcy - cy;

        // Determine which side to connect from
        if (Math.abs(dx) * node.height > Math.abs(dy) * node.width) {
            // Left or right
            if (dx > 0) return { x: node.x + node.width, y: cy };
            return { x: node.x, y: cy };
        } else {
            // Top or bottom
            if (dy > 0) return { x: cx, y: node.y + node.height };
            return { x: cx, y: node.y };
        }
    }

    /**
     * Draw relationship diagram legend
     */
    _drawRelLegend(svg, svgWidth, svgHeight) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        const lx = 20;
        const ly = svgHeight - 60;

        // Background
        g.appendChild(this._createRect(lx, ly, 300, 50, {
            fill: '#f8f6f2', stroke: this.colors.border, rx: '6'
        }));

        // Active line
        const activeLine = document.createElementNS(this.SVG_NS, 'line');
        activeLine.setAttribute('x1', lx + 12); activeLine.setAttribute('y1', ly + 18);
        activeLine.setAttribute('x2', lx + 40); activeLine.setAttribute('y2', ly + 18);
        activeLine.setAttribute('stroke', this.colors.linePrimary); activeLine.setAttribute('stroke-width', '2');
        g.appendChild(activeLine);
        g.appendChild(this._createText('Active', lx + 46, ly + 22, { fontSize: '11px', fill: this.colors.text }));

        // Inactive line
        const inactiveLine = document.createElementNS(this.SVG_NS, 'line');
        inactiveLine.setAttribute('x1', lx + 100); inactiveLine.setAttribute('y1', ly + 18);
        inactiveLine.setAttribute('x2', lx + 128); inactiveLine.setAttribute('y2', ly + 18);
        inactiveLine.setAttribute('stroke', this.colors.inactiveRel); inactiveLine.setAttribute('stroke-width', '1.5');
        inactiveLine.setAttribute('stroke-dasharray', '6,4');
        g.appendChild(inactiveLine);
        g.appendChild(this._createText('Inactive', lx + 134, ly + 22, { fontSize: '11px', fill: this.colors.text }));

        // Cardinality
        g.appendChild(this._createText('1 = one  |  * = many', lx + 12, ly + 40, { fontSize: '11px', fill: this.colors.textLight }));

        svg.appendChild(g);
    }

    // ──────────────────────────────────────────────
    // VISUAL USAGE DIAGRAM
    // ──────────────────────────────────────────────

    /**
     * Render visual usage diagram
     * Shows semantic model objects → consuming visuals grouped by page
     * @param {Object} fieldUsageMap - From VisualParser
     * @param {Array} pages - Page info from VisualParser
     */
    renderVisualUsageDiagram(fieldUsageMap, pages) {
        this.container.innerHTML = '';

        const entries = Object.entries(fieldUsageMap);
        if (entries.length === 0) {
            this.container.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">No visual usage data available. Make sure your PBIP folder contains a Report subfolder.</p>';
            return;
        }

        // Group fields by type
        const measures = entries.filter(([k]) => k.startsWith('measure|'));
        const columns = entries.filter(([k]) => k.startsWith('column|'));
        const hierarchies = entries.filter(([k]) => k.startsWith('hierarchy|'));

        // Layout constants
        const leftX = 40;
        const rightX = 500;
        const nodeWidth = 200;
        const nodeHeight = 28;
        const gap = 6;
        const sectionGap = 30;

        let currentY = 60;
        const connections = [];
        const fieldNodes = [];
        const visualNodes = new Map(); // key → node

        // Title
        const svgWidth = 780;

        // Process each group
        const groups = [
            { label: 'Measures', items: measures, color: this.colors.measureBg, borderColor: this.colors.accent },
            { label: 'Columns', items: columns, color: this.colors.columnBg, borderColor: '#1565c0' },
            { label: 'Hierarchies', items: hierarchies, color: '#e8f5e9', borderColor: '#2e7d32' }
        ];

        for (const group of groups) {
            if (group.items.length === 0) continue;

            // Section header
            fieldNodes.push({ type: 'header', label: group.label, y: currentY });
            currentY += 28;

            for (const [key, usages] of group.items) {
                const parts = key.split('|');
                const fieldName = parts[2];
                const tableName = parts[1];

                const fieldNode = {
                    type: 'field',
                    x: leftX,
                    y: currentY,
                    width: nodeWidth,
                    height: nodeHeight,
                    label: `${tableName}[${fieldName}]`,
                    color: group.color,
                    borderColor: group.borderColor
                };
                fieldNodes.push(fieldNode);

                // Create/find visual nodes
                for (const usage of usages) {
                    const vKey = `${usage.pageName}|${usage.visualName}`;
                    if (!visualNodes.has(vKey)) {
                        visualNodes.set(vKey, {
                            pageName: usage.pageName,
                            visualName: usage.visualName,
                            visualType: usage.visualType,
                            y: 0 // positioned later
                        });
                    }
                    connections.push({ fieldKey: key, fieldNode, visualKey: vKey });
                }

                currentY += nodeHeight + gap;
            }
            currentY += sectionGap;
        }

        // Position visual nodes
        // Group by page
        const pageGroups = new Map();
        for (const [key, vNode] of visualNodes) {
            if (!pageGroups.has(vNode.pageName)) {
                pageGroups.set(vNode.pageName, []);
            }
            pageGroups.get(vNode.pageName).push({ key, ...vNode });
        }

        let visualY = 60;
        const visualNodePositions = new Map();

        for (const [pageName, visuals] of pageGroups) {
            // Page header
            visualNodePositions.set(`page_${pageName}`, { type: 'pageHeader', y: visualY, label: pageName });
            visualY += 28;

            for (const v of visuals) {
                visualNodePositions.set(v.key, {
                    type: 'visual',
                    x: rightX,
                    y: visualY,
                    width: nodeWidth + 40,
                    height: nodeHeight,
                    label: v.visualName || v.visualType,
                    visualType: v.visualType
                });
                visualY += nodeHeight + gap;
            }
            visualY += sectionGap / 2;
        }

        const svgHeight = Math.max(currentY, visualY) + 40;
        const svg = this._createSVG(svgWidth, svgHeight);

        // Title
        svg.appendChild(this._createText('Visual Usage Map', svgWidth / 2, 30, {
            fontSize: '18px', fontWeight: '700', fill: this.colors.primary, textAnchor: 'middle'
        }));

        // Subtitle labels
        svg.appendChild(this._createText('Semantic Model Fields', leftX + nodeWidth / 2, 50, {
            fontSize: '13px', fill: this.colors.textLight, textAnchor: 'middle'
        }));
        svg.appendChild(this._createText('Report Visuals', rightX + (nodeWidth + 40) / 2, 50, {
            fontSize: '13px', fill: this.colors.textLight, textAnchor: 'middle'
        }));

        // Draw connections first (behind nodes)
        for (const conn of connections) {
            const vPos = visualNodePositions.get(conn.visualKey);
            if (!vPos || vPos.type !== 'visual') continue;

            const fromX = conn.fieldNode.x + conn.fieldNode.width;
            const fromY = conn.fieldNode.y + conn.fieldNode.height / 2;
            const toX = vPos.x;
            const toY = vPos.y + vPos.height / 2;

            const path = document.createElementNS(this.SVG_NS, 'path');
            const cpX1 = fromX + 60;
            const cpX2 = toX - 60;
            path.setAttribute('d', `M ${fromX} ${fromY} C ${cpX1} ${fromY}, ${cpX2} ${toY}, ${toX} ${toY}`);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', conn.fieldNode.borderColor || this.colors.border);
            path.setAttribute('stroke-width', '1.5');
            path.setAttribute('opacity', '0.4');
            svg.appendChild(path);
        }

        // Draw field nodes
        for (const node of fieldNodes) {
            if (node.type === 'header') {
                svg.appendChild(this._createText(node.label, leftX, node.y + 16, {
                    fontSize: '14px', fontWeight: '700', fill: this.colors.primary
                }));
                continue;
            }

            const g = document.createElementNS(this.SVG_NS, 'g');
            g.appendChild(this._createRect(node.x, node.y, node.width, node.height, {
                fill: node.color, stroke: node.borderColor, strokeWidth: '1.5', rx: '4'
            }));
            g.appendChild(this._createText(
                this._truncate(node.label, 28),
                node.x + 8,
                node.y + node.height / 2 + 4,
                { fontSize: '11px', fill: this.colors.text }
            ));
            svg.appendChild(g);
        }

        // Draw visual nodes
        for (const [key, node] of visualNodePositions) {
            if (node.type === 'pageHeader') {
                svg.appendChild(this._createText(`📄 ${node.label}`, rightX, node.y + 16, {
                    fontSize: '13px', fontWeight: '700', fill: this.colors.primary
                }));
                continue;
            }

            const g = document.createElementNS(this.SVG_NS, 'g');
            g.appendChild(this._createRect(node.x, node.y, node.width, node.height, {
                fill: this.colors.visualBg, stroke: '#9c27b0', strokeWidth: '1.5', rx: '4'
            }));
            g.appendChild(this._createText(
                this._truncate(node.label, 32),
                node.x + 8,
                node.y + node.height / 2 + 4,
                { fontSize: '11px', fill: this.colors.text }
            ));
            // Visual type badge
            g.appendChild(this._createText(
                node.visualType,
                node.x + node.width - 8,
                node.y + node.height / 2 + 4,
                { fontSize: '9px', fill: this.colors.textLight, textAnchor: 'end' }
            ));
            svg.appendChild(g);
        }

        this.container.appendChild(svg);
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

    _truncate(str, maxLen) {
        if (!str) return '';
        return str.length > maxLen ? str.substring(0, maxLen - 1) + '…' : str;
    }

    /**
     * Export diagram as SVG string for download
     */
    exportSVG() {
        const svg = this.container.querySelector('svg');
        if (!svg) return null;
        const serializer = new XMLSerializer();
        return serializer.serializeToString(svg);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DiagramRenderer;
}
