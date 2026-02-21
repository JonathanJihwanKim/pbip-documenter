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
        this.container.innerHTML = '';

        if (relationships.length === 0) {
            this.container.innerHTML = '<p style="text-align:center;color:#666;padding:40px;">No relationships defined in this model.</p>';
            return;
        }

        // Collect tables involved in relationships
        const relatedTableNames = new Set();
        for (const r of relationships) {
            if (r.fromTable) relatedTableNames.add(r.fromTable);
            if (r.toTable) relatedTableNames.add(r.toTable);
        }

        // Build table nodes with column info
        const tableNodes = [];
        const tableMap = new Map();

        for (const tName of relatedTableNames) {
            const tableData = tables.find(t => t.name === tName);
            const columns = tableData ? tableData.columns.map(c => c.name) : [];
            const measures = tableData ? tableData.measures.length : 0;

            tableNodes.push({
                name: tName,
                columns: columns.slice(0, 8), // Show max 8 columns
                totalColumns: columns.length,
                measures
            });
        }

        // Layout: grid arrangement
        const nodeWidth = 200;
        const nodeMinHeight = 60;
        const rowHeight = 18;
        const padding = 60;
        const cols = Math.ceil(Math.sqrt(tableNodes.length));
        const hGap = nodeWidth + 80;
        const vGap = 200;

        tableNodes.forEach((node, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            node.x = padding + col * hGap;
            node.y = padding + row * vGap;
            node.height = nodeMinHeight + node.columns.length * rowHeight;
            node.width = nodeWidth;
            tableMap.set(node.name, node);
        });

        const svgWidth = padding * 2 + cols * hGap;
        const rows = Math.ceil(tableNodes.length / cols);
        const svgHeight = padding * 2 + rows * vGap;

        const svg = this._createSVG(svgWidth, svgHeight);

        // Defs for markers
        const defs = document.createElementNS(this.SVG_NS, 'defs');

        // Arrow marker
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

        // Bi-directional arrow
        const marker2 = marker.cloneNode(true);
        marker2.setAttribute('id', 'arrowhead-start');
        marker2.setAttribute('orient', 'auto-start-reverse');
        defs.appendChild(marker2);

        svg.appendChild(defs);

        // Title
        const title = this._createText('Relationship Diagram', svgWidth / 2, 30, {
            fontSize: '18px', fontWeight: '700', fill: this.colors.primary, textAnchor: 'middle'
        });
        svg.appendChild(title);

        // Draw relationships (lines first, then tables on top)
        for (const rel of relationships) {
            const fromNode = tableMap.get(rel.fromTable);
            const toNode = tableMap.get(rel.toTable);
            if (!fromNode || !toNode) continue;

            this._drawRelationshipLine(svg, fromNode, toNode, rel);
        }

        // Draw table nodes
        for (const node of tableNodes) {
            this._drawTableNode(svg, node);
        }

        // Legend
        this._drawRelLegend(svg, svgWidth, svgHeight);

        this.container.appendChild(svg);
    }

    /**
     * Draw a table node
     */
    _drawTableNode(svg, node) {
        const g = document.createElementNS(this.SVG_NS, 'g');
        g.setAttribute('class', 'table-node');

        // Shadow
        const shadow = this._createRect(node.x + 3, node.y + 3, node.width, node.height, {
            fill: 'rgba(0,0,0,0.1)', rx: '6'
        });
        g.appendChild(shadow);

        // Background
        const bg = this._createRect(node.x, node.y, node.width, node.height, {
            fill: this.colors.bg, stroke: this.colors.border, strokeWidth: '2', rx: '6'
        });
        g.appendChild(bg);

        // Header
        const header = this._createRect(node.x, node.y, node.width, 32, {
            fill: this.colors.tableHeader, rx: '6'
        });
        g.appendChild(header);

        // Header bottom fill (to square off bottom corners of header)
        const headerBottom = this._createRect(node.x, node.y + 20, node.width, 12, {
            fill: this.colors.tableHeader
        });
        g.appendChild(headerBottom);

        // Table name
        const nameText = this._createText(
            this._truncate(node.name, 22),
            node.x + node.width / 2,
            node.y + 21,
            { fontSize: '13px', fontWeight: '600', fill: '#ffffff', textAnchor: 'middle' }
        );
        g.appendChild(nameText);

        // Columns
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

        if (node.totalColumns > node.columns.length) {
            const moreText = this._createText(
                `... +${node.totalColumns - node.columns.length} more`,
                node.x + 12,
                startY + node.columns.length * 18,
                { fontSize: '11px', fill: this.colors.textLight, fontStyle: 'italic' }
            );
            g.appendChild(moreText);
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

        svg.appendChild(g);
    }

    /**
     * Draw a relationship line between two table nodes
     */
    _drawRelationshipLine(svg, fromNode, toNode, rel) {
        // Find best connection points
        const from = this._getConnectionPoint(fromNode, toNode);
        const to = this._getConnectionPoint(toNode, fromNode);

        const g = document.createElementNS(this.SVG_NS, 'g');

        // Line
        const line = document.createElementNS(this.SVG_NS, 'line');
        line.setAttribute('x1', from.x);
        line.setAttribute('y1', from.y);
        line.setAttribute('x2', to.x);
        line.setAttribute('y2', to.y);
        line.setAttribute('stroke', rel.isActive ? this.colors.linePrimary : this.colors.inactiveRel);
        line.setAttribute('stroke-width', rel.isActive ? '2' : '1.5');

        if (!rel.isActive) {
            line.setAttribute('stroke-dasharray', '6,4');
        }

        if (rel.crossFilteringBehavior === 'bothDirections') {
            line.setAttribute('marker-end', 'url(#arrowhead)');
            line.setAttribute('marker-start', 'url(#arrowhead-start)');
        } else {
            line.setAttribute('marker-end', 'url(#arrowhead)');
        }

        g.appendChild(line);

        // Cardinality labels
        const fromCard = rel.fromCardinality || 'many';
        const toCard = rel.toCardinality || 'one';

        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2;

        const cardText = this._createText(
            `${fromCard === 'many' ? '*' : '1'} : ${toCard === 'many' ? '*' : '1'}`,
            midX,
            midY - 8,
            {
                fontSize: '11px',
                fontWeight: '600',
                fill: rel.isActive ? this.colors.primary : this.colors.inactiveRel,
                textAnchor: 'middle'
            }
        );

        // Background for label
        const labelBg = this._createRect(midX - 20, midY - 20, 40, 16, {
            fill: this.colors.bg, rx: '3'
        });
        g.appendChild(labelBg);
        g.appendChild(cardText);

        // Column labels near endpoints
        if (rel.fromColumn) {
            const fcText = this._createText(
                rel.fromColumn,
                from.x + (to.x - from.x) * 0.15,
                from.y + (to.y - from.y) * 0.15 + 14,
                { fontSize: '10px', fill: this.colors.textLight, textAnchor: 'middle' }
            );
            g.appendChild(fcText);
        }
        if (rel.toColumn) {
            const tcText = this._createText(
                rel.toColumn,
                from.x + (to.x - from.x) * 0.85,
                from.y + (to.y - from.y) * 0.85 + 14,
                { fontSize: '10px', fill: this.colors.textLight, textAnchor: 'middle' }
            );
            g.appendChild(tcText);
        }

        svg.appendChild(g);
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
