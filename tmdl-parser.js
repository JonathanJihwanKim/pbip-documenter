/**
 * TMDL Parser Module
 * Line-by-line state machine parser for TMDL files
 * Handles: database.tmdl, model.tmdl, tables/*.tmdl, relationships.tmdl, roles/*.tmdl, expressions.tmdl
 */

class TMDLParser {
    constructor() {
        this.model = {
            database: null,
            model: null,
            tables: [],
            relationships: [],
            roles: [],
            expressions: []
        };
    }

    /**
     * Parse all TMDL files from a semantic model definition folder
     * @param {Object} files - Map of filename to content
     * @returns {Object} Parsed model
     */
    parseAll(files) {
        // Parse database.tmdl
        if (files['database.tmdl']) {
            this.model.database = this.parseDatabase(files['database.tmdl']);
        }

        // Parse model.tmdl
        if (files['model.tmdl']) {
            this.model.model = this.parseModel(files['model.tmdl']);
        }

        // Parse relationships.tmdl
        if (files['relationships.tmdl']) {
            this.model.relationships = this.parseRelationships(files['relationships.tmdl']);
        }

        // Parse expressions.tmdl
        if (files['expressions.tmdl']) {
            this.model.expressions = this.parseExpressions(files['expressions.tmdl']);
        }

        // Parse table files
        const tableFiles = Object.keys(files).filter(f => f.startsWith('tables/'));
        for (const tableFile of tableFiles) {
            const table = this.parseTable(files[tableFile], tableFile);
            if (table) {
                this.model.tables.push(table);
            }
        }

        // Parse role files
        const roleFiles = Object.keys(files).filter(f => f.startsWith('roles/'));
        for (const roleFile of roleFiles) {
            const role = this.parseRole(files[roleFile], roleFile);
            if (role) {
                this.model.roles.push(role);
            }
        }

        // Sort tables alphabetically
        this.model.tables.sort((a, b) => a.name.localeCompare(b.name));

        return this.model;
    }

    /**
     * Parse database.tmdl
     */
    parseDatabase(content) {
        const result = { name: null, compatibilityLevel: null };
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('database')) {
                result.name = this._extractName(trimmed, 'database');
            } else if (trimmed.startsWith('compatibilityLevel:')) {
                result.compatibilityLevel = trimmed.split(':')[1]?.trim();
            }
        }

        return result;
    }

    /**
     * Parse model.tmdl
     */
    parseModel(content) {
        const result = { name: null, culture: null, defaultPowerBIDataSourceVersion: null };
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('model Model')) {
                result.name = 'Model';
            } else if (trimmed.startsWith('culture:')) {
                result.culture = trimmed.split(':')[1]?.trim();
            } else if (trimmed.startsWith('defaultPowerBIDataSourceVersion:')) {
                result.defaultPowerBIDataSourceVersion = trimmed.split(':')[1]?.trim();
            }
        }

        return result;
    }

    /**
     * Parse a table .tmdl file using state machine
     */
    parseTable(content, fileName) {
        const lines = content.split('\n');
        const table = {
            name: null,
            description: null,
            isHidden: false,
            columns: [],
            measures: [],
            hierarchies: [],
            partitions: [],
            calculationGroup: null
        };

        let state = 'IDLE';
        let currentObject = null;
        let currentExpression = [];
        let pendingDescription = null;
        let baseIndent = 0;
        let expressionIndent = 0;
        let inBacktickBlock = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            // Handle triple-backtick blocks
            if (trimmed === '```') {
                inBacktickBlock = !inBacktickBlock;
                if (state === 'EXPRESSION') {
                    currentExpression.push(trimmed);
                }
                continue;
            }

            if (inBacktickBlock && state === 'EXPRESSION') {
                currentExpression.push(line);
                continue;
            }

            // Description comments (/// lines)
            if (trimmed.startsWith('///')) {
                const descText = trimmed.substring(3).trim();
                if (pendingDescription) {
                    pendingDescription += '\n' + descText;
                } else {
                    pendingDescription = descText;
                }
                continue;
            }

            // Skip regular comments
            if (trimmed.startsWith('//') || trimmed === '') {
                continue;
            }

            // Top-level: table declaration
            if (indent === 0 && trimmed.startsWith('table')) {
                this._finishCurrentObject(state, currentObject, currentExpression, table);
                table.name = this._extractName(trimmed, 'table');
                if (pendingDescription) {
                    table.description = pendingDescription;
                    pendingDescription = null;
                }
                state = 'TABLE_BODY';
                baseIndent = 0;
                continue;
            }

            // Object headers at indent level 1 (typically a single tab or spaces)
            if (state !== 'IDLE' && indent > 0 && indent <= 4) {
                // Check for new object declarations
                const objectType = this._detectObjectType(trimmed);

                if (objectType) {
                    // Save previous object
                    this._finishCurrentObject(state, currentObject, currentExpression, table);
                    currentExpression = [];

                    const name = this._extractName(trimmed, objectType);

                    currentObject = {
                        type: objectType,
                        name: name,
                        description: pendingDescription || null,
                        properties: {}
                    };
                    pendingDescription = null;
                    baseIndent = indent;

                    // Check if line contains '=' (expression follows on same line or next)
                    if (trimmed.includes('=')) {
                        const eqIndex = trimmed.indexOf('=');
                        const afterEq = trimmed.substring(eqIndex + 1).trim();
                        if (afterEq) {
                            currentExpression.push(afterEq);
                        }
                        state = 'EXPRESSION';
                        expressionIndent = indent + 1;
                    } else {
                        state = 'PROPERTIES';
                    }
                    continue;
                }
            }

            // Inside expression (multi-line DAX, M, etc.)
            if (state === 'EXPRESSION') {
                // Expression continues while indent is deeper than object or we're collecting
                if (indent > baseIndent || trimmed === '') {
                    currentExpression.push(line);
                    continue;
                } else {
                    // Expression ended, process this line as a property or new object
                    state = 'PROPERTIES';
                    // Fall through to property handling
                }
            }

            // Properties
            if (state === 'PROPERTIES' || state === 'TABLE_BODY') {
                if (indent > baseIndent && trimmed.includes(':')) {
                    // Check for 'expression =' or 'source =' which starts a new expression block
                    if (/^(?:expression|source)\s*=/.test(trimmed)) {
                        const afterEq = trimmed.split('=').slice(1).join('=').trim();
                        if (afterEq) {
                            currentExpression.push(afterEq);
                        }
                        state = 'EXPRESSION';
                        expressionIndent = indent + 1;
                        continue;
                    }

                    const colonIndex = trimmed.indexOf(':');
                    const key = trimmed.substring(0, colonIndex).trim();
                    const value = trimmed.substring(colonIndex + 1).trim();

                    if (state === 'TABLE_BODY' && !currentObject) {
                        // Table-level properties
                        if (key === 'isHidden') {
                            table.isHidden = value === 'true';
                        }
                    } else if (currentObject) {
                        currentObject.properties[key] = value;
                    }
                    continue;
                }

                // Check for annotation or extendedProperty blocks
                if (indent > baseIndent && (trimmed.startsWith('annotation') || trimmed.startsWith('extendedProperty'))) {
                    // Skip annotation/extendedProperty blocks
                    continue;
                }
            }

            // Handle expression start on property lines
            if ((state === 'PROPERTIES' || state === 'TABLE_BODY') && currentObject) {
                if (indent > baseIndent && trimmed.startsWith('=')) {
                    const afterEq = trimmed.substring(1).trim();
                    if (afterEq) {
                        currentExpression.push(afterEq);
                    }
                    state = 'EXPRESSION';
                    expressionIndent = indent + 1;
                    continue;
                }
            }
        }

        // Finish last object
        this._finishCurrentObject(state, currentObject, currentExpression, table);

        return table;
    }

    /**
     * Detect object type from a line
     */
    _detectObjectType(line) {
        const types = ['column', 'measure', 'hierarchy', 'partition', 'calculationGroup', 'calculationItem', 'level', 'role'];
        for (const type of types) {
            if (line.startsWith(type + ' ') || line.startsWith(type + '\t')) {
                return type;
            }
        }
        return null;
    }

    /**
     * Finish current object and add to table
     */
    _finishCurrentObject(state, currentObject, currentExpression, table) {
        if (!currentObject) return;

        const expressionText = currentExpression.length > 0
            ? this._cleanExpression(currentExpression)
            : null;

        switch (currentObject.type) {
            case 'column':
                table.columns.push({
                    name: currentObject.name,
                    description: currentObject.description,
                    dataType: currentObject.properties.dataType || null,
                    formatString: currentObject.properties.formatString || null,
                    isHidden: currentObject.properties.isHidden === 'true',
                    sourceColumn: currentObject.properties.sourceColumn || null,
                    summarizeBy: currentObject.properties.summarizeBy || null,
                    expression: expressionText
                });
                break;

            case 'measure':
                table.measures.push({
                    name: currentObject.name,
                    description: currentObject.description,
                    expression: expressionText,
                    displayFolder: currentObject.properties.displayFolder || null,
                    formatString: currentObject.properties.formatString || null,
                    dataCategory: currentObject.properties.dataCategory || null
                });
                break;

            case 'hierarchy':
                table.hierarchies.push({
                    name: currentObject.name,
                    description: currentObject.description,
                    levels: [] // Levels are parsed as sub-objects
                });
                break;

            case 'level':
                // Add to last hierarchy
                if (table.hierarchies.length > 0) {
                    table.hierarchies[table.hierarchies.length - 1].levels.push({
                        name: currentObject.name,
                        column: currentObject.properties.column || null,
                        ordinal: currentObject.properties.ordinal || null
                    });
                }
                break;

            case 'partition':
                table.partitions.push({
                    name: currentObject.name,
                    mode: currentObject.properties.mode || null,
                    source: expressionText,
                    sourceType: currentObject.properties.type || null
                });
                break;

            case 'calculationGroup':
                table.calculationGroup = { items: [] };
                break;

            case 'calculationItem':
                if (table.calculationGroup) {
                    table.calculationGroup.items.push({
                        name: currentObject.name,
                        expression: expressionText
                    });
                }
                break;
        }
    }

    /**
     * Clean a multi-line expression
     */
    _cleanExpression(lines) {
        if (lines.length === 0) return null;

        // Find minimum indentation (excluding empty lines)
        const nonEmptyLines = lines.filter(l => l.trim() !== '');
        if (nonEmptyLines.length === 0) return null;

        const minIndent = Math.min(...nonEmptyLines.map(l => {
            const match = l.match(/^(\s*)/);
            return match ? match[1].length : 0;
        }));

        // Remove common indentation
        const cleaned = lines.map(l => {
            if (l.trim() === '') return '';
            return l.substring(Math.min(minIndent, l.search(/\S/) >= 0 ? l.search(/\S/) : 0));
        });

        // Remove leading/trailing empty lines
        while (cleaned.length > 0 && cleaned[0].trim() === '') cleaned.shift();
        while (cleaned.length > 0 && cleaned[cleaned.length - 1].trim() === '') cleaned.pop();

        return cleaned.join('\n');
    }

    /**
     * Parse relationships.tmdl
     */
    parseRelationships(content) {
        const relationships = [];
        const lines = content.split('\n');
        let currentRel = null;

        for (const line of lines) {
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            if (indent === 0 && trimmed.startsWith('relationship')) {
                if (currentRel) relationships.push(currentRel);
                currentRel = {
                    id: this._extractName(trimmed, 'relationship'),
                    fromTable: null,
                    fromColumn: null,
                    toTable: null,
                    toColumn: null,
                    fromCardinality: null,
                    toCardinality: null,
                    crossFilteringBehavior: null,
                    isActive: true
                };
                continue;
            }

            if (currentRel && indent > 0 && trimmed.includes(':')) {
                const colonIndex = trimmed.indexOf(':');
                const key = trimmed.substring(0, colonIndex).trim();
                const value = trimmed.substring(colonIndex + 1).trim();

                switch (key) {
                    case 'fromColumn':
                        const fromParts = this._parseColumnRef(value);
                        currentRel.fromTable = fromParts.table;
                        currentRel.fromColumn = fromParts.column;
                        break;
                    case 'toColumn':
                        const toParts = this._parseColumnRef(value);
                        currentRel.toTable = toParts.table;
                        currentRel.toColumn = toParts.column;
                        break;
                    case 'fromCardinality':
                        currentRel.fromCardinality = value;
                        break;
                    case 'toCardinality':
                        currentRel.toCardinality = value;
                        break;
                    case 'crossFilteringBehavior':
                        currentRel.crossFilteringBehavior = value;
                        break;
                    case 'isActive':
                        currentRel.isActive = value !== 'false';
                        break;
                }
            }
        }

        if (currentRel) relationships.push(currentRel);
        return relationships;
    }

    /**
     * Parse a column reference like "'Table Name'.ColumnName" or "Table.Column"
     */
    _parseColumnRef(value) {
        // Pattern: 'Table Name'.Column or Table.Column
        const quotedMatch = value.match(/^'([^']+)'\.(.+)$/);
        if (quotedMatch) {
            return { table: quotedMatch[1], column: quotedMatch[2].trim() };
        }

        const dotIndex = value.indexOf('.');
        if (dotIndex > 0) {
            return {
                table: value.substring(0, dotIndex).trim(),
                column: value.substring(dotIndex + 1).trim()
            };
        }

        return { table: null, column: value.trim() };
    }

    /**
     * Parse roles/*.tmdl
     */
    parseRole(content, fileName) {
        const lines = content.split('\n');
        const role = {
            name: null,
            description: null,
            modelPermission: null,
            tablePermissions: []
        };

        let currentPermission = null;
        let inFilterExpression = false;
        let filterLines = [];

        for (const line of lines) {
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            if (indent === 0 && trimmed.startsWith('role')) {
                role.name = this._extractName(trimmed, 'role');
                continue;
            }

            if (trimmed.startsWith('modelPermission:')) {
                role.modelPermission = trimmed.split(':')[1]?.trim();
                continue;
            }

            if (trimmed.startsWith('tablePermission')) {
                if (currentPermission) {
                    if (filterLines.length > 0) {
                        currentPermission.filterExpression = filterLines.join('\n').trim();
                    }
                    role.tablePermissions.push(currentPermission);
                }
                currentPermission = {
                    table: this._extractName(trimmed, 'tablePermission'),
                    filterExpression: null
                };
                filterLines = [];
                inFilterExpression = false;
                continue;
            }

            if (currentPermission && trimmed.startsWith('filterExpression:')) {
                const afterColon = trimmed.split(':').slice(1).join(':').trim();
                if (afterColon) filterLines.push(afterColon);
                inFilterExpression = true;
                continue;
            }

            if (inFilterExpression && indent > 2) {
                filterLines.push(trimmed);
                continue;
            }

            if (trimmed.startsWith('///') && !role.description) {
                role.description = trimmed.substring(3).trim();
            }
        }

        if (currentPermission) {
            if (filterLines.length > 0) {
                currentPermission.filterExpression = filterLines.join('\n').trim();
            }
            role.tablePermissions.push(currentPermission);
        }

        return role;
    }

    /**
     * Parse expressions.tmdl
     */
    parseExpressions(content) {
        const expressions = [];
        const lines = content.split('\n');
        let currentExpr = null;
        let exprLines = [];
        let inExpression = false;

        for (const line of lines) {
            const trimmed = line.trim();
            const indent = line.search(/\S/);

            if (indent === 0 && trimmed.startsWith('expression')) {
                if (currentExpr) {
                    currentExpr.expression = exprLines.join('\n').trim();
                    expressions.push(currentExpr);
                }
                currentExpr = {
                    name: this._extractName(trimmed, 'expression'),
                    kind: null,
                    expression: null
                };
                exprLines = [];
                inExpression = false;

                // Check for '=' on the same line
                if (trimmed.includes('=')) {
                    const afterEq = trimmed.substring(trimmed.indexOf('=') + 1).trim();
                    if (afterEq) exprLines.push(afterEq);
                    inExpression = true;
                }
                continue;
            }

            if (currentExpr) {
                if (trimmed.startsWith('kind:')) {
                    currentExpr.kind = trimmed.split(':')[1]?.trim();
                    continue;
                }

                if (indent > 0 && (inExpression || trimmed.startsWith('='))) {
                    if (trimmed.startsWith('=')) {
                        const afterEq = trimmed.substring(1).trim();
                        if (afterEq) exprLines.push(afterEq);
                    } else {
                        exprLines.push(trimmed);
                    }
                    inExpression = true;
                }
            }
        }

        if (currentExpr) {
            currentExpr.expression = exprLines.join('\n').trim();
            expressions.push(currentExpr);
        }

        return expressions;
    }

    /**
     * Extract name from a declaration line
     * Handles: keyword 'Name With Spaces' and keyword SimpleName
     */
    _extractName(line, keyword) {
        const afterKeyword = line.substring(keyword.length).trim();

        // Remove trailing '=' or content after '='
        const eqIndex = afterKeyword.indexOf('=');
        const nameStr = eqIndex >= 0 ? afterKeyword.substring(0, eqIndex).trim() : afterKeyword;

        // Quoted name
        const quotedMatch = nameStr.match(/^'([^']+)'/);
        if (quotedMatch) return quotedMatch[1];

        // Unquoted name (first word or identifier)
        const unquoted = nameStr.split(/\s/)[0];
        return unquoted || nameStr;
    }

    /**
     * Extract DAX references from all measures
     * @returns {Object} Map of measure name → { measureRefs, columnRefs, tableRefs }
     */
    extractAllReferences() {
        const refs = {};

        for (const table of this.model.tables) {
            for (const measure of table.measures) {
                if (measure.expression) {
                    refs[measure.name] = DAXReferenceExtractor.extract(measure.expression);
                    refs[measure.name].table = table.name;
                }
            }
        }

        return refs;
    }
}

/**
 * DAX Reference Extractor
 * Regex-based extraction of table, column, and measure references from DAX
 */
class DAXReferenceExtractor {
    /**
     * Extract all references from a DAX expression
     */
    static extract(dax) {
        if (!dax) return { measureRefs: [], columnRefs: [], tableRefs: [] };

        const cleaned = this._cleanDAX(dax);

        return {
            measureRefs: this._extractMeasureRefs(cleaned),
            columnRefs: this._extractColumnRefs(cleaned),
            tableRefs: this._extractTableRefs(cleaned)
        };
    }

    /**
     * Clean DAX by removing comments and string literals
     */
    static _cleanDAX(dax) {
        let cleaned = dax.replace(/\/\*[\s\S]*?\*\//g, '');
        cleaned = cleaned.replace(/\/\/.*/g, '');
        cleaned = cleaned.replace(/"[^"]*"/g, '""');
        return cleaned;
    }

    /**
     * Extract measure references [MeasureName]
     */
    static _extractMeasureRefs(dax) {
        const refs = new Set();
        const pattern = /(?<!'[^']*)\[([^\]]+)\]/g;
        let match;

        while ((match = pattern.exec(dax)) !== null) {
            // Only standalone [Name] without table prefix
            const beforeBracket = dax.substring(Math.max(0, match.index - 1), match.index);
            if (beforeBracket !== '.' && !/\w/.test(beforeBracket) && beforeBracket !== "'") {
                refs.add(match[1].trim());
            }
        }

        return Array.from(refs);
    }

    /**
     * Extract column references Table[Column] or 'Table Name'[Column]
     */
    static _extractColumnRefs(dax) {
        const refs = [];
        const seen = new Set();
        const pattern = /(?:'([^']+)'|(\w+))\[([^\]]+)\]/g;
        let match;

        while ((match = pattern.exec(dax)) !== null) {
            const table = match[1] || match[2];
            const column = match[3].trim();
            const key = `${table}|${column}`;

            if (!seen.has(key)) {
                seen.add(key);
                refs.push({ table, column });
            }
        }

        return refs;
    }

    /**
     * Extract table references from functions like COUNTROWS(Table), ALL(Table)
     */
    static _extractTableRefs(dax) {
        const refs = new Set();
        const pattern = /(?:COUNTROWS|RELATEDTABLE|VALUES|ALL|DISTINCT|SUMMARIZE|ADDCOLUMNS|SELECTCOLUMNS|FILTER|CALCULATETABLE|TOPN|GENERATE|NATURALLEFTOUTERJOIN|NATURALINNERJOIN|CROSSJOIN|UNION|INTERSECT|EXCEPT|TREATAS)\s*\(\s*(?:'([^']+)'|(\w+))\s*(?:[,)])/gi;
        let match;

        while ((match = pattern.exec(dax)) !== null) {
            refs.add(match[1] || match[2]);
        }

        return Array.from(refs);
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { TMDLParser, DAXReferenceExtractor };
}
