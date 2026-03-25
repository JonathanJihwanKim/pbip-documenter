/**
 * MermaidExporter — Exports semantic model data as Mermaid diagram syntax.
 * Part of PBIP Documenter (https://github.com/nicojimkbm/pbip-documenter)
 */
class MermaidExporter {
    constructor(parsedModel, lineageEngine, visualData) {
        this.parsedModel = parsedModel;
        this.lineageEngine = lineageEngine || null;
        this.visualData = visualData || null;

        // Build PK/FK lookup from relationships
        this._pkColumns = new Set(); // "Table.Column"
        this._fkColumns = new Set();
        if (this.parsedModel && this.parsedModel.relationships) {
            for (const rel of this.parsedModel.relationships) {
                this._pkColumns.add(`${rel.toTable}.${rel.toColumn}`);
                this._fkColumns.add(`${rel.fromTable}.${rel.fromColumn}`);
            }
        }

        // Tables that participate in relationships (used for hidden-table filtering)
        this._relTables = new Set();
        if (this.parsedModel && this.parsedModel.relationships) {
            for (const rel of this.parsedModel.relationships) {
                this._relTables.add(rel.fromTable);
                this._relTables.add(rel.toTable);
            }
        }
    }

    // ── Public API ──────────────────────────────────────────────────────

    /**
     * Generate Mermaid erDiagram syntax from parsedModel.
     */
    generateERDiagram() {
        const model = this.parsedModel;
        if (!model || !model.tables) return '';

        const lines = ['erDiagram'];
        const MAX_COLS = 15;

        const tables = model.tables.filter(t =>
            !t._isAutoDate && (!t.isHidden || this._relTables.has(t.name))
        );

        // Entity blocks
        for (const table of tables) {
            const safeName = this._sanitizeId(table.name);
            lines.push(`    ${safeName} {`);

            const cols = table.columns || [];
            const visible = cols.slice(0, MAX_COLS);
            for (const col of visible) {
                const dtype = this._sanitizeDtype(col.dataType || 'String');
                const annotation = this._getColumnAnnotation(table.name, col.name);
                const safCol = this._sanitizeId(col.name);
                lines.push(`        ${dtype} ${safCol}${annotation ? ' ' + annotation : ''}`);
            }
            if (cols.length > MAX_COLS) {
                lines.push(`        %% ... and ${cols.length - MAX_COLS} more`);
            }
            lines.push('    }');
        }

        // Relationships
        if (model.relationships) {
            for (const rel of model.relationships) {
                const fromT = this._sanitizeId(rel.fromTable);
                const toT = this._sanitizeId(rel.toTable);
                const op = this._mapCardinality(rel.cardinality);
                let label = `${rel.fromColumn}`;
                if (rel.fromColumn !== rel.toColumn) {
                    label += ` → ${rel.toColumn}`;
                }
                if (rel.isActive === false) {
                    label += ' (inactive)';
                }
                lines.push(`    ${fromT} ${op} ${toT} : "${this._sanitizeLabel(label)}"`);
            }
        }

        return lines.join('\n');
    }

    /**
     * Generate Mermaid flowchart LR syntax for lineage.
     */
    generateLineageFlowchart() {
        if (this.lineageEngine && this.lineageEngine.nodes && this.lineageEngine.nodes.size > 0) {
            return this._buildFlowchartFromEngine();
        }
        return this._buildFlowchartFromModel();
    }

    // ── Lineage: from lineageEngine ─────────────────────────────────────

    _buildFlowchartFromEngine() {
        const engine = this.lineageEngine;
        const lines = ['flowchart LR'];

        // Categorize nodes by type
        const groups = { Sources: [], Tables: [], Measures: [], Visuals: [], Other: [] };
        const nodeIds = new Map(); // original id → safe id

        for (const [id, node] of engine.nodes) {
            const safeId = this._sanitizeId(id);
            nodeIds.set(id, safeId);
            const type = (node.type || '').toLowerCase();
            if (type === 'datasource' || type === 'dataSource') {
                groups.Sources.push({ safeId, label: node.label || id });
            } else if (type === 'table') {
                groups.Tables.push({ safeId, label: node.label || id });
            } else if (type === 'measure') {
                groups.Measures.push({ safeId, label: node.label || id });
            } else if (type === 'visual') {
                groups.Visuals.push({ safeId, label: node.label || id });
            } else {
                groups.Other.push({ safeId, label: node.label || id });
            }
        }

        // Build connected set for large-model pruning (>100 nodes)
        let connectedIds = null;
        if (engine.nodes.size > 100) {
            connectedIds = new Set();
            for (const edge of engine.edges) {
                connectedIds.add(edge.from);
                connectedIds.add(edge.to);
            }
        }

        // Emit subgraphs
        for (const [groupName, nodes] of Object.entries(groups)) {
            const filtered = connectedIds
                ? nodes.filter(n => connectedIds.has(n.safeId) || [...nodeIds].some(([orig, safe]) => safe === n.safeId && connectedIds.has(orig)))
                : nodes;
            if (filtered.length === 0) continue;
            lines.push(`    subgraph ${groupName}`);
            for (const n of filtered) {
                lines.push(`        ${n.safeId}["${this._sanitizeLabel(n.label)}"]`);
            }
            lines.push('    end');
        }

        // Emit edges
        for (const edge of engine.edges) {
            const from = nodeIds.get(edge.from);
            const to = nodeIds.get(edge.to);
            if (from && to) {
                lines.push(`    ${from} --> ${to}`);
            }
        }

        return lines.join('\n');
    }

    // ── Lineage: fallback from parsedModel only ─────────────────────────

    _buildFlowchartFromModel() {
        const model = this.parsedModel;
        if (!model || !model.tables) return '';

        const lines = ['flowchart LR'];
        const tables = model.tables.filter(t => !t._isAutoDate);

        // Tables subgraph
        lines.push('    subgraph Tables');
        for (const t of tables) {
            const sid = this._sanitizeId(t.name);
            lines.push(`        ${sid}["${this._sanitizeLabel(t.name)}"]`);
        }
        lines.push('    end');

        // Measures subgraph
        const measures = [];
        for (const t of tables) {
            for (const m of (t.measures || [])) {
                measures.push({ table: t.name, name: m.name });
            }
        }
        if (measures.length > 0) {
            lines.push('    subgraph Measures');
            for (const m of measures) {
                const sid = this._sanitizeId(`${m.table}_${m.name}`);
                lines.push(`        ${sid}["${this._sanitizeLabel(m.name)}"]`);
            }
            lines.push('    end');
            // table → measure edges
            for (const m of measures) {
                lines.push(`    ${this._sanitizeId(m.table)} --> ${this._sanitizeId(`${m.table}_${m.name}`)}`);
            }
        }

        // Relationship edges between tables
        if (model.relationships) {
            for (const rel of model.relationships) {
                const style = rel.isActive === false ? '-.->' : '-->';
                lines.push(`    ${this._sanitizeId(rel.fromTable)} ${style} ${this._sanitizeId(rel.toTable)}`);
            }
        }

        return lines.join('\n');
    }

    // ── Helpers ──────────────────────────────────────────────────────────

    /**
     * Convert a name to a valid Mermaid ID (alphanumeric + underscore).
     */
    _sanitizeId(name) {
        return String(name)
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/^(\d)/, '_$1')
            .replace(/__+/g, '_')
            .replace(/_$/, '');
    }

    /**
     * Escape characters that break Mermaid quoted labels.
     */
    _sanitizeLabel(name) {
        return String(name).replace(/"/g, "'").replace(/[\r\n]/g, ' ');
    }

    /**
     * Sanitize data type name for Mermaid (no spaces).
     */
    _sanitizeDtype(dtype) {
        return String(dtype).replace(/\s+/g, '');
    }

    /**
     * Map relationship cardinality string to Mermaid operator.
     */
    _mapCardinality(cardinality) {
        switch (cardinality) {
            case 'one:one':    return '||--||';
            case 'many:many':  return '}|--|{';
            case 'many:one':
            default:           return '}|--||';
        }
    }

    /**
     * Return "PK", "FK", or "" for a given table.column.
     */
    _getColumnAnnotation(tableName, columnName) {
        const key = `${tableName}.${columnName}`;
        if (this._pkColumns.has(key)) return 'PK';
        if (this._fkColumns.has(key)) return 'FK';
        return '';
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = MermaidExporter;
}
