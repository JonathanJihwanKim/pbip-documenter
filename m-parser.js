/**
 * M Expression Parser Module
 * Extracts data source connections from Power Query M expressions
 */

class MExpressionParser {
    /**
     * Extract data sources from an M expression
     * @param {string} mExpression - Power Query M expression text
     * @returns {Array<{type: string, server?: string, database?: string, url?: string, path?: string, parameterized: boolean, parameters?: string[]}>}
     */
    static extractDataSources(mExpression) {
        if (!mExpression) return [];

        const sources = [];
        const paramRefs = this._extractParameterRefs(mExpression);
        const isParameterized = paramRefs.length > 0;

        // SQL Server
        const sqlDbPattern = /Sql\.Databases?\s*\(\s*("([^"]*)"|\#"([^"]*)")\s*(?:,\s*("([^"]*)"|\#"([^"]*)"))?/g;
        let match;
        while ((match = sqlDbPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'SQL Server',
                server: match[2] || match[3] || null,
                database: match[5] || match[6] || null,
                parameterized: isParameterized || !!(match[3] || match[6]),
                parameters: match[3] ? [match[3]] : match[6] ? [match[6]] : undefined
            });
        }

        // Analysis Services
        const asPattern = /AnalysisServices\.Database\s*\(\s*("([^"]*)"|\#"([^"]*)")\s*(?:,\s*("([^"]*)"|\#"([^"]*)"))?/g;
        while ((match = asPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Analysis Services',
                server: match[2] || match[3] || null,
                database: match[5] || match[6] || null,
                parameterized: !!(match[3] || match[6])
            });
        }

        // OData
        const odataPattern = /OData\.Feed\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = odataPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'OData',
                url: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Web.Contents
        const webPattern = /Web\.Contents\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = webPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Web',
                url: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // SharePoint Tables
        const spTablesPattern = /SharePoint\.Tables\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = spTablesPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'SharePoint Tables',
                url: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // SharePoint Files
        const spFilesPattern = /SharePoint\.Files\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = spFilesPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'SharePoint Files',
                url: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Excel.Workbook(File.Contents(...))
        const excelPattern = /Excel\.Workbook\s*\(\s*File\.Contents\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = excelPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Excel',
                path: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Csv.Document(File.Contents(...))
        const csvPattern = /Csv\.Document\s*\(\s*File\.Contents\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = csvPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'CSV',
                path: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Azure Storage Blobs
        const azBlobPattern = /AzureStorage\.Blobs\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = azBlobPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Azure Blob Storage',
                url: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Dataverse
        const dataversePattern = /Dataverse\.Contents\s*\(\s*("([^"]*)"|\#"([^"]*)")?/g;
        while ((match = dataversePattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Dataverse',
                url: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Snowflake
        const snowflakePattern = /Snowflake\.Databases\s*\(\s*("([^"]*)"|\#"([^"]*)")\s*(?:,\s*("([^"]*)"|\#"([^"]*)"))?/g;
        while ((match = snowflakePattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Snowflake',
                server: match[2] || match[3] || null,
                database: match[5] || match[6] || null,
                parameterized: !!(match[3] || match[6])
            });
        }

        // Oracle
        const oraclePattern = /Oracle\.Database\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = oraclePattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Oracle',
                server: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Google BigQuery
        const bqPattern = /GoogleBigQuery\.Database\s*\(/g;
        while ((match = bqPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Google BigQuery',
                parameterized: false
            });
        }

        return sources;
    }

    /**
     * Extract parameter references from M expression (#"ParamName" patterns)
     * @param {string} mExpression
     * @returns {string[]} Array of parameter names
     */
    static _extractParameterRefs(mExpression) {
        const refs = [];
        const pattern = /#"([^"]+)"/g;
        let match;
        while ((match = pattern.exec(mExpression)) !== null) {
            refs.push(match[1]);
        }
        return refs;
    }

    /**
     * Resolve parameter references in sources using model expressions
     * @param {Array} sources - Array of source objects from extractDataSources
     * @param {Array} expressions - Array of {name, expression} from parsedModel.expressions
     * @returns {Array} Sources with resolved parameter values where possible
     */
    static resolveParameters(sources, expressions) {
        if (!expressions || expressions.length === 0) return sources;

        const paramMap = new Map();
        for (const expr of expressions) {
            if (expr.expression) {
                // Extract simple string value: "value" meta [...]
                const valueMatch = expr.expression.match(/^"([^"]*)"(?:\s*meta\s*\[|$)/);
                if (valueMatch) {
                    paramMap.set(expr.name, valueMatch[1]);
                }
            }
        }

        return sources.map(source => {
            const resolved = { ...source };
            // Try to resolve server/database/url/path if they're parameter names
            for (const field of ['server', 'database', 'url', 'path']) {
                if (resolved[field] && paramMap.has(resolved[field])) {
                    resolved[`${field}Resolved`] = paramMap.get(resolved[field]);
                }
            }
            // Also resolve from parameters array
            if (resolved.parameters) {
                for (const paramName of resolved.parameters) {
                    if (paramMap.has(paramName)) {
                        if (!resolved.server && !resolved.serverResolved) {
                            resolved.serverResolved = paramMap.get(paramName);
                        }
                    }
                }
            }
            return resolved;
        });
    }

    /**
     * Deduplicate sources across partitions
     * @param {Array} allSources - Array of source objects
     * @returns {Array} Deduplicated sources
     */
    static deduplicateSources(allSources) {
        const seen = new Map();

        for (const source of allSources) {
            const key = this._sourceKey(source);
            if (!seen.has(key)) {
                seen.set(key, source);
            }
        }

        return Array.from(seen.values());
    }

    /**
     * Generate a dedup key for a source
     */
    static _sourceKey(source) {
        const parts = [source.type];
        if (source.server) parts.push(source.server);
        if (source.database) parts.push(source.database);
        if (source.url) parts.push(source.url);
        if (source.path) parts.push(source.path);
        return parts.join('|').toLowerCase();
    }

    /**
     * Extract all data sources from a parsed model
     * @param {Object} parsedModel - From TMDLParser.parseAll()
     * @returns {Array} Deduplicated data sources
     */
    static extractAllFromModel(parsedModel) {
        const allSources = [];

        for (const table of (parsedModel.tables || [])) {
            for (const partition of (table.partitions || [])) {
                if (partition.source) {
                    const sources = this.extractDataSources(partition.source);
                    for (const src of sources) {
                        src.tableName = table.name;
                        src.partitionName = partition.name;
                    }
                    allSources.push(...sources);
                }
            }
        }

        // Resolve parameters
        const resolved = this.resolveParameters(allSources, parsedModel.expressions || []);

        return this.deduplicateSources(resolved);
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MExpressionParser;
}
