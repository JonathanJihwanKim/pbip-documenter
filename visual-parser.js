/**
 * Visual Parser Module
 * Parses PBIR visual.json files to extract field references
 * Maps semantic model objects to their consuming visuals
 */

class VisualParser {
    constructor() {
        this.pages = [];
        this.visuals = [];
        this.fieldUsageMap = new Map(); // "type|table|field" → [{ visualName, pageName, visualType }]
    }

    /**
     * Parse all report pages and visuals
     * @param {Array} pagesData - Array of { pageId, pageName, visuals: [{ visualId, visualData }] }
     */
    parseReport(pagesData) {
        this.pages = [];
        this.visuals = [];
        this.fieldUsageMap = new Map();

        for (const page of pagesData) {
            const pageInfo = {
                id: page.pageId,
                name: page.pageName || page.displayName || page.pageId,
                displayName: page.displayName || page.pageName || page.pageId,
                pageWidth: page.pageWidth || null,
                pageHeight: page.pageHeight || null,
                visuals: []
            };

            for (const visual of (page.visuals || [])) {
                const parsed = this.parseVisual(visual.visualData, pageInfo.displayName);
                parsed.visualId = visual.visualId;
                parsed.pageId = page.pageId;
                pageInfo.visuals.push(parsed);
                this.visuals.push(parsed);
            }

            this.pages.push(pageInfo);
        }

        return {
            pages: this.pages,
            visuals: this.visuals,
            fieldUsageMap: this.getFieldUsageMap()
        };
    }

    /**
     * Parse a single visual.json
     * @param {Object} visualData - Parsed visual.json content
     * @param {string} pageName - Name of the page containing this visual
     * @returns {Object} Parsed visual info
     */
    parseVisual(visualData, pageName) {
        const visualType = visualData.visual?.visualType || visualData.visualType || 'unknown';
        const visualName = this._extractVisualName(visualData) || visualType;
        const fields = this._extractFieldReferences(visualData);

        // Register each field in the usage map
        for (const field of fields) {
            const key = `${field.type}|${field.table || field.entity}|${field.name || field.column || field.hierarchy}`;

            if (!this.fieldUsageMap.has(key)) {
                this.fieldUsageMap.set(key, []);
            }

            this.fieldUsageMap.get(key).push({
                visualName,
                visualType,
                pageName,
                projectionName: field.projectionName
            });
        }

        return {
            visualType,
            visualName,
            pageName,
            fields,
            position: visualData.position || visualData.visual?.position || null
        };
    }

    /**
     * Get the field usage map as a plain object
     * @returns {Object} Map of "type|table|field" → usage array
     */
    getFieldUsageMap() {
        const result = {};
        for (const [key, usages] of this.fieldUsageMap) {
            result[key] = usages;
        }
        return result;
    }

    /**
     * Get visual usage for a specific field
     * @param {string} type - 'measure', 'column', or 'hierarchy'
     * @param {string} table - Table name
     * @param {string} field - Field name
     * @returns {Array} Array of visual usage objects
     */
    getUsageForField(type, table, field) {
        const key = `${type}|${table}|${field}`;
        return this.fieldUsageMap.get(key) || [];
    }

    /**
     * Get all visuals that use any field from a specific table
     * @param {string} tableName
     * @returns {Array} Array of visual usage objects
     */
    getUsageForTable(tableName) {
        const usages = [];
        const seen = new Set();

        for (const [key, visualUsages] of this.fieldUsageMap) {
            const parts = key.split('|');
            if (parts[1] === tableName) {
                for (const usage of visualUsages) {
                    const usageKey = `${usage.pageName}|${usage.visualName}`;
                    if (!seen.has(usageKey)) {
                        seen.add(usageKey);
                        usages.push(usage);
                    }
                }
            }
        }

        return usages;
    }

    /**
     * Extract visual name from visualContainerObjects
     */
    _extractVisualName(visualData) {
        try {
            const containerObjects = visualData.visual?.visualContainerObjects;
            if (!containerObjects) return null;

            // Check title
            if (containerObjects.title?.length > 0) {
                const titleObj = containerObjects.title[0];
                if (titleObj.properties?.text?.expr?.Literal?.Value) {
                    return titleObj.properties.text.expr.Literal.Value.replace(/^['"]|['"]$/g, '');
                }
            }

            // Check general
            if (containerObjects.general?.length > 0) {
                const generalObj = containerObjects.general[0];
                if (generalObj.properties?.title?.expr?.Literal?.Value) {
                    return generalObj.properties.title.expr.Literal.Value.replace(/^['"]|['"]$/g, '');
                }
            }

            return null;
        } catch {
            return null;
        }
    }

    /**
     * Extract all field references from visual data
     */
    _extractFieldReferences(visualData) {
        const fieldMap = new Map();

        try {
            // Query state projections
            this._extractFromQueryState(
                visualData.visual?.query?.queryState || visualData.query?.queryState,
                fieldMap
            );

            // Sort definitions
            this._extractFromSortDefinition(visualData.visual?.query?.sortDefinition, fieldMap);

            // Filter config
            this._extractFromFilterConfig(visualData.filterConfig, fieldMap);

            // Visual objects (conditional formatting, etc.)
            this._extractFromVisualObjects(visualData.visual?.objects, fieldMap);
        } catch (err) {
            console.error('Error extracting field references:', err);
        }

        return Array.from(fieldMap.values());
    }

    /**
     * Extract from query state projections
     */
    _extractFromQueryState(queryState, fieldMap) {
        if (!queryState) return;

        for (const [projectionName, projection] of Object.entries(queryState)) {
            if (projection.projections) {
                for (const proj of projection.projections) {
                    this._extractFieldFromProjection(proj, projectionName, fieldMap);
                }
            }
        }
    }

    /**
     * Extract from sort definitions
     */
    _extractFromSortDefinition(sortDefinition, fieldMap) {
        if (!sortDefinition?.sort) return;

        for (const sortItem of sortDefinition.sort) {
            if (sortItem.field) {
                this._extractFieldFromProjection({ field: sortItem.field }, 'sort', fieldMap);
            }
        }
    }

    /**
     * Extract from filter config
     */
    _extractFromFilterConfig(filterConfig, fieldMap) {
        if (!filterConfig?.filters) return;

        for (const filter of filterConfig.filters) {
            if (filter.field) {
                this._extractFieldFromProjection({ field: filter.field }, 'filter', fieldMap);
            }
        }
    }

    /**
     * Extract from visual objects (buttons, conditional formatting)
     */
    _extractFromVisualObjects(objects, fieldMap) {
        if (!objects) return;

        const search = (obj, depth = 0) => {
            if (!obj || typeof obj !== 'object' || depth > 10) return;

            if (obj.Column) {
                const entity = obj.Column.Expression?.SourceRef?.Entity;
                const property = obj.Column.Property;
                if (entity && property) {
                    const key = `column|${entity}|${property}`;
                    if (!fieldMap.has(key)) {
                        fieldMap.set(key, {
                            type: 'column',
                            table: entity,
                            column: property,
                            name: property,
                            projectionName: 'visualObjects'
                        });
                    }
                }
            } else if (obj.Measure) {
                const entity = obj.Measure.Expression?.SourceRef?.Entity;
                const property = obj.Measure.Property;
                if (entity && property) {
                    const key = `measure|${entity}|${property}`;
                    if (!fieldMap.has(key)) {
                        fieldMap.set(key, {
                            type: 'measure',
                            table: entity,
                            entity: entity,
                            name: property,
                            projectionName: 'visualObjects'
                        });
                    }
                }
            }

            for (const value of Object.values(obj)) {
                if (typeof value === 'object') {
                    search(value, depth + 1);
                }
            }
        };

        search(objects);
    }

    /**
     * Extract field from a projection object
     */
    _extractFieldFromProjection(proj, projectionName, fieldMap) {
        if (proj.field?.Column) {
            const entity = proj.field.Column.Expression?.SourceRef?.Entity;
            const property = proj.field.Column.Property;
            if (entity && property) {
                const key = `column|${entity}|${property}`;
                if (!fieldMap.has(key)) {
                    fieldMap.set(key, {
                        type: 'column',
                        table: entity,
                        column: property,
                        name: property,
                        projectionName
                    });
                }
            }
        } else if (proj.field?.Measure) {
            const entity = proj.field.Measure.Expression?.SourceRef?.Entity;
            const property = proj.field.Measure.Property;
            if (entity && property) {
                const key = `measure|${entity}|${property}`;
                if (!fieldMap.has(key)) {
                    fieldMap.set(key, {
                        type: 'measure',
                        table: entity,
                        entity: entity,
                        name: property,
                        projectionName
                    });
                }
            }
        } else if (proj.field?.Hierarchy) {
            const entity = proj.field.Hierarchy.Expression?.SourceRef?.Entity;
            const hierarchy = proj.field.Hierarchy.Hierarchy;
            if (entity && hierarchy) {
                const key = `hierarchy|${entity}|${hierarchy}`;
                if (!fieldMap.has(key)) {
                    fieldMap.set(key, {
                        type: 'hierarchy',
                        table: entity,
                        hierarchy: hierarchy,
                        name: hierarchy,
                        projectionName
                    });
                }
            }
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = VisualParser;
}
