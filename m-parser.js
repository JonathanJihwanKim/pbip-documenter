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
        const paramRefs = this._extractParameterRefs(mExpression, MExpressionParser._declaredParams);
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

        // Google BigQuery (replace existing)
        const bqPattern = /GoogleBigQuery\.Database\s*\(\s*(?:"([^"]*)"|\#"([^"]*)")?/g;
        while ((match = bqPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Google BigQuery',
                server: match[1] || match[2] || null,
                parameterized: !!match[2]
            });
        }

        // PostgreSQL
        const pgPattern = /PostgreSQL\.Database\s*\(\s*("([^"]*)"|\#"([^"]*)")\s*,\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = pgPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'PostgreSQL',
                server: match[2] || match[3] || null,
                database: match[5] || match[6] || null,
                parameterized: !!(match[3] || match[6])
            });
        }

        // MySQL
        const mysqlPattern = /MySQL\.Database\s*\(\s*("([^"]*)"|\#"([^"]*)")\s*,\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = mysqlPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'MySQL',
                server: match[2] || match[3] || null,
                database: match[5] || match[6] || null,
                parameterized: !!(match[3] || match[6])
            });
        }

        // Teradata
        const teradataPattern = /Teradata\.Database\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = teradataPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Teradata',
                server: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // SAP HANA
        const sapHanaPattern = /SapHana\.Database\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = sapHanaPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'SAP HANA',
                server: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // ODBC
        const odbcPattern = /Odbc\.(?:DataSource|Query)\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = odbcPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'ODBC',
                server: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Power BI Dataflows (Gen1)
        const dataflowPattern = /PowerBI\.Dataflows\s*\(/g;
        while ((match = dataflowPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Power BI Dataflow',
                parameterized: false
            });
        }

        // Azure Data Explorer / Kusto
        const kustoPattern = /(?:AzureDataExplorer|Kusto)\.Contents\s*\(\s*("([^"]*)"|\#"([^"]*)")\s*(?:,\s*("([^"]*)"|\#"([^"]*)"))?/g;
        while ((match = kustoPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Azure Data Explorer',
                server: match[2] || match[3] || null,
                database: match[5] || match[6] || null,
                parameterized: !!(match[3] || match[6])
            });
        }

        // Microsoft Fabric Lakehouse
        const lakehousePattern = /Lakehouse\.Contents\s*\(/g;
        while ((match = lakehousePattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Fabric Lakehouse',
                parameterized: false
            });
        }

        // Microsoft Fabric Warehouse
        const fabricWhPattern = /Fabric\.Warehouse\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = fabricWhPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Fabric Warehouse',
                server: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Databricks
        const databricksPattern = /Databricks\.Catalogs\s*\(\s*("([^"]*)"|\#"([^"]*)")/g;
        while ((match = databricksPattern.exec(mExpression)) !== null) {
            sources.push({
                type: 'Databricks',
                server: match[2] || match[3] || null,
                parameterized: !!match[3]
            });
        }

        // Inline literal data — Binary.Decompress / Binary.FromText (base64 embedded data)
        const inlinePat = /Binary\.(?:Decompress|FromText)\s*\(/g;
        while ((match = inlinePat.exec(mExpression)) !== null) {
            sources.push({ type: 'Inline Literal', isInline: true });
            break; // one entry is enough per M expression
        }

        // Value.NativeQuery — wraps any connector with a passthrough SQL string
        // e.g. Value.NativeQuery(GoogleBigQuery.Database(...){...}[Data], "SELECT ...", null, [...])
        const nativeQueryPat = /Value\.NativeQuery\s*\(/g;
        while ((match = nativeQueryPat.exec(mExpression)) !== null) {
            const afterOpen = mExpression.slice(match.index + match[0].length);
            // Extract the SQL string (second argument after first comma at depth 0)
            let depth = 0;
            let firstComma = -1;
            for (let i = 0; i < afterOpen.length; i++) {
                const ch = afterOpen[i];
                if (ch === '(' || ch === '[' || ch === '{') depth++;
                else if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
                else if (ch === ',' && depth === 0) { firstComma = i; break; }
            }
            let sqlText = null;
            if (firstComma !== -1) {
                const sqlArg = afterOpen.slice(firstComma + 1).trimStart();
                const sqlMatch = sqlArg.match(/^"((?:[^"\\]|\\.)*)"/);
                if (sqlMatch) sqlText = sqlMatch[1];
            }
            // Detect the backing connector from within the first argument
            const firstArg = firstComma !== -1 ? afterOpen.slice(0, firstComma) : afterOpen.slice(0, 500);
            const innerSources = this.extractDataSources(firstArg);
            if (innerSources.length > 0) {
                for (const inner of innerSources) {
                    sources.push({ ...inner, nativeQuery: sqlText, isNativeQuery: true });
                }
            } else {
                sources.push({ type: 'Native Query', nativeQuery: sqlText, isNativeQuery: true });
            }
        }

        return sources;
    }

    /**
     * Extract parameter references from M expression (#"ParamName" patterns)
     * @param {string} mExpression
     * @returns {string[]} Array of parameter names
     */
    static _extractParameterRefs(mExpression, declaredParams) {
        const refs = [];
        const pattern = /#"([^"]+)"/g;
        let match;
        while ((match = pattern.exec(mExpression)) !== null) {
            // Only flag as parameter ref if name is a declared expression
            if (!declaredParams || declaredParams.has(match[1])) {
                refs.push(match[1]);
            }
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
            if (expr.expression && /IsParameterQuery\s*=\s*true/i.test(expr.expression)) {
                const valueMatch = expr.expression.match(/"([^"]+)"\s*meta\s*\[/);
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
     * Extract physical table and column lineage from an M expression.
     * Parses Navigation steps, Table.RenameColumns, Table.SelectColumns, Table.AddColumn.
     * @param {string} mExpression - Power Query M expression text
     * @returns {{ physicalSchema: string|null, physicalTable: string|null, renames: Array<{sourceName:string, modelName:string}>, selectedColumns: string[]|null, addedColumns: string[] }|null}
     */
    static extractTableLineage(mExpression) {
        if (!mExpression) return null;

        const result = {
            physicalSchema: null,
            physicalTable: null,
            physicalDataset: null,  // BigQuery dataset or ADLS container
            physicalProject: null,  // BigQuery project or cloud account
            renames: [],         // [{sourceName, modelName}] source col name → model col name
            selectedColumns: null, // null = all columns, array = explicit projection
            addedColumns: []     // columns added via Table.AddColumn (computed in PQ)
        };

        // 1. Navigation step: identifier{[Schema="dbo", Item="FactSales"]}[Data]
        //    Also handles Item-first ordering.
        const navSchemaItem = /\{\s*\[\s*Schema\s*=\s*"([^"]+)"\s*,\s*Item\s*=\s*"([^"]+)"\s*\]\s*\}\s*\[Data\]/i.exec(mExpression);
        if (navSchemaItem) {
            result.physicalSchema = navSchemaItem[1];
            result.physicalTable  = navSchemaItem[2];
        } else {
            const navItemSchema = /\{\s*\[\s*Item\s*=\s*"([^"]+)"\s*,\s*Schema\s*=\s*"([^"]+)"\s*\]\s*\}\s*\[Data\]/i.exec(mExpression);
            if (navItemSchema) {
                result.physicalTable  = navItemSchema[1];
                result.physicalSchema = navItemSchema[2];
            }
        }

        // Fallback: chained Name-based navigation (Lakehouse, OData, BigQuery dataset→table chain)
        // Collect all {[Name="x"]}[Data] steps in order; last = table, second-to-last = dataset
        if (!result.physicalTable) {
            const nameMatches = [...mExpression.matchAll(/\{\s*\[\s*Name\s*=\s*"([^"]+)"\s*\]\s*\}(?:\[Data\]|\s*\[Data\])/gi)]
                .map(m => m[1]);
            if (nameMatches.length >= 1) result.physicalTable   = nameMatches[nameMatches.length - 1];
            if (nameMatches.length >= 2) result.physicalDataset = nameMatches[nameMatches.length - 2];
            if (nameMatches.length >= 3) result.physicalProject = nameMatches[nameMatches.length - 3];
        }

        // 2. Table.RenameColumns — find all calls and collect {"OldName","NewName"} pairs
        //    We locate each call site then scan forward for pairs.
        const renamePat = /Table\.RenameColumns\b/g;
        let rm;
        while ((rm = renamePat.exec(mExpression)) !== null) {
            // Find the opening brace of the list argument (after the first comma)
            const afterCall = mExpression.slice(rm.index);
            const commaIdx  = afterCall.indexOf(',');
            if (commaIdx === -1) continue;
            const listStart = afterCall.indexOf('{', commaIdx);
            if (listStart === -1) continue;
            // Grab a safe window (2000 chars) to find pairs
            const window = afterCall.slice(listStart, listStart + 2000);
            const pairPat = /\{\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\}/g;
            let pp;
            while ((pp = pairPat.exec(window)) !== null) {
                result.renames.push({ sourceName: pp[1], modelName: pp[2] });
            }
        }

        // 3. Table.SelectColumns — last call wins (represents the final projected set)
        const selectPat = /Table\.SelectColumns\b/g;
        let sm, lastSelectPos = -1, lastSelectStr = null;
        while ((sm = selectPat.exec(mExpression)) !== null) {
            lastSelectPos = sm.index;
        }
        if (lastSelectPos !== -1) {
            const afterSel  = mExpression.slice(lastSelectPos);
            const commaIdx  = afterSel.indexOf(',');
            if (commaIdx !== -1) {
                const braceIdx = afterSel.indexOf('{', commaIdx);
                if (braceIdx !== -1) {
                    const window = afterSel.slice(braceIdx, braceIdx + 4000);
                    const colPat = /"([^"]+)"/g;
                    const cols = [];
                    let cp;
                    while ((cp = colPat.exec(window)) !== null) {
                        // Stop if we hit another Table. call keyword (rough boundary)
                        if (cp.index > 10 && window.slice(0, cp.index).includes('Table.')) break;
                        cols.push(cp[1]);
                    }
                    if (cols.length > 0) result.selectedColumns = cols;
                }
            }
        }

        // 4. Table.AddColumn — collect computed column names
        const addPat = /Table\.AddColumn\s*\(\s*(?:[^,\n]+),\s*"([^"]+)"/g;
        let ac;
        while ((ac = addPat.exec(mExpression)) !== null) {
            result.addedColumns.push(ac[1]);
        }

        // 4b. Table.NestedJoin — record joined step names and key columns
        // Table.NestedJoin(left, {"leftKey"}, right, {"rightKey"}, "newCol", JoinKind.Inner)
        result.joins = [];
        const joinPat = /Table\.NestedJoin\s*\(\s*([^,\n]+),\s*\{([^}]*)\}\s*,\s*([^,\n]+),\s*\{([^}]*)\}/g;
        let jm;
        while ((jm = joinPat.exec(mExpression)) !== null) {
            const leftKeys  = (jm[2].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, ''));
            const rightKeys = (jm[4].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, ''));
            result.joins.push({
                type: 'NestedJoin',
                leftStep:  jm[1].trim(),
                rightStep: jm[3].trim(),
                leftKeys,
                rightKeys
            });
        }

        // 4c. Table.Combine — collect combined step names
        const combinePat = /Table\.Combine\s*\(\s*\{([^}]+)\}/g;
        let cm;
        while ((cm = combinePat.exec(mExpression)) !== null) {
            const stepNames = cm[1].split(',').map(s => s.trim()).filter(Boolean);
            result.joins.push({ type: 'Combine', steps: stepNames });
        }

        // 5. Table.RemoveColumns — if we have a selectedColumns list, prune it
        if (result.selectedColumns !== null) {
            const removePat = /Table\.RemoveColumns\b/g;
            let rmc;
            while ((rmc = removePat.exec(mExpression)) !== null) {
                const afterRem = mExpression.slice(rmc.index);
                const commaIdx = afterRem.indexOf(',');
                if (commaIdx === -1) continue;
                const braceIdx = afterRem.indexOf('{', commaIdx);
                if (braceIdx === -1) continue;
                const window = afterRem.slice(braceIdx, braceIdx + 2000);
                const rColPat = /"([^"]+)"/g;
                let rc;
                while ((rc = rColPat.exec(window)) !== null) {
                    const idx = result.selectedColumns.indexOf(rc[1]);
                    if (idx !== -1) result.selectedColumns.splice(idx, 1);
                }
            }
        }

        return result;
    }

    /**
     * Extract physical table lineage for every table in a parsed model.
     * Returns a Map<tableName, tableLineage> for use by the lineage engine.
     * @param {Object} parsedModel
     * @returns {Map<string, Object>}
     */
    /**
     * If an M expression's first step is a bare identifier reference to a shared expression
     * (not a function call), return that expression name. Otherwise null.
     * e.g.  "let\n  Source = bu_dim_src\nin\n  Source"  →  "bu_dim_src"
     * e.g.  "let\n  Source = #\"bu_dim_src\"\nin\n  ..."  →  "bu_dim_src"
     */
    /**
     * When the TMDL parser encounters `partition 'x' = m`, it treats `= m` as an
     * expression start and includes all partition properties (mode, queryGroup, source = …)
     * inside partition.source. This helper extracts just the M expression body that
     * follows the embedded `source =` marker, or returns the input unchanged if the
     * TMDL wrapper is not present.
     */
    static _extractMExprFromPartitionSource(src) {
        if (!src) return src;
        const m = src.match(/\bsource\s*=\s*([\s\S]+)/i);
        return m ? m[1].trim() : src;
    }

    static _extractSharedExpressionRef(mExpr) {
        if (!mExpr) return null;
        // Unwrap TMDL partition-body wrapper (partition.source may contain "m\nmode=…\nsource=\nlet…")
        const unwrapped = this._extractMExprFromPartitionSource(mExpr);
        // Strip triple-backtick fences before applying the ^ anchor
        const stripped = unwrapped.replace(/^\s*```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
        // Match: let <any_step_name> = <identifier_without_parens>
        const m = stripped.match(
            /^\s*let\s+(?:#"[^"]+"|[A-Za-z_][A-Za-z0-9_ ]*)\s*=\s*(?:#"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*(?![ \t]*\()/i
        );
        if (!m) return null;
        return m[1] || m[2] || null;
    }

    /**
     * Extract lineage for a single partition M, resolving shared expression references.
     * Returns merged lineage: physical source from the shared expression body,
     * column renames from the partition itself.
     */
    static _extractLineageResolvingRef(mExpr, expressionBodies, visited = new Set()) {
        const refName = this._extractSharedExpressionRef(mExpr);
        const refBody = refName && !visited.has(refName) && expressionBodies[refName];

        if (refBody) {
            visited.add(refName);
            // Recurse to get base lineage (handles chains of references)
            const baseLineage = this._extractLineageResolvingRef(refBody, expressionBodies, visited);
            // Get partition-level renames/projections on top of the reference
            const partitionLineage = this.extractTableLineage(mExpr);
            if (!baseLineage) return partitionLineage;
            return {
                physicalSchema: baseLineage.physicalSchema,
                physicalTable: baseLineage.physicalTable,
                renames: [
                    ...(partitionLineage?.renames || []),
                    ...(baseLineage.renames || [])
                ],
                selectedColumns: partitionLineage?.selectedColumns || baseLineage.selectedColumns,
                addedColumns: [
                    ...(partitionLineage?.addedColumns || []),
                    ...(baseLineage.addedColumns || [])
                ]
            };
        }

        return this.extractTableLineage(mExpr);
    }

    static extractTableLineageFromModel(parsedModel) {
        const map = new Map(); // tableName → first resolved lineage (best effort)

        const expressionBodies = {};
        for (const expr of (parsedModel.expressions || [])) {
            if (expr.name && expr.expression) expressionBodies[expr.name] = expr.expression;
        }

        const _tryLineage = (mExpr) => {
            if (!mExpr) return null;
            const lineage = this._extractLineageResolvingRef(mExpr, expressionBodies);
            return (lineage && (lineage.physicalTable || lineage.renames.length > 0)) ? lineage : null;
        };

        for (const table of (parsedModel.tables || [])) {
            // Try refreshPolicy.sourceExpression first (most specific for IR tables)
            const rpLineage = _tryLineage(table.refreshPolicy?.sourceExpression);
            if (rpLineage && !map.has(table.name)) map.set(table.name, rpLineage);

            // Try all partitions — take the first one that yields a physical table
            for (const partition of (table.partitions || [])) {
                if (map.has(table.name)) break; // already resolved
                const lineage = _tryLineage(partition.source);
                if (lineage) map.set(table.name, lineage);
            }
        }
        return map;
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
     * Extract physical table names referenced in a SQL string (L9).
     * Handles FROM/JOIN with optional schema qualification and backtick/bracket/double-quote quoting.
     * Returns array of unqualified table name strings (last segment of schema.table).
     */
    static _extractSQLTableRefs(sql) {
        if (!sql) return [];
        const results = new Set();
        // Match FROM or JOIN (any variant) followed by an optional schema-qualified table name
        const pat = /\b(?:FROM|JOIN)\s+([`"\[]?[\w$]+[`"\]]?\s*\.\s*)?([`"\[]?[\w$]+[`"\]]?)/gi;
        let m;
        while ((m = pat.exec(sql)) !== null) {
            // Strip backticks, brackets, double-quotes
            const raw = m[2].replace(/[`"[\]]/g, '').trim();
            if (raw && !/^(SELECT|WHERE|ON|AS|SET|VALUES|INTO|UPDATE|DELETE)$/i.test(raw)) {
                results.add(raw);
            }
        }
        return [...results];
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
     * Build a map of tableName → Set<resolvedSourceKey> using fully resolved sources.
     * Used by lineage-engine to create connects_to_source edges without key mismatches
     * caused by unresolved parameters or shared-expression delegations.
     */
    static buildTableSourceKeyMap(parsedModel) {
        const expressionBodies = {};
        for (const expr of (parsedModel.expressions || [])) {
            if (expr.name && expr.expression) expressionBodies[expr.name] = expr.expression;
        }
        const map = new Map();
        for (const table of (parsedModel.tables || [])) {
            for (const partition of (table.partitions || [])) {
                if (!partition.source) continue;
                let sources = this.extractDataSources(partition.source);
                if (sources.length === 0) {
                    const refName = this._extractSharedExpressionRef(partition.source);
                    const refBody = refName && expressionBodies[refName];
                    if (refBody) sources = this.extractDataSources(refBody);
                }
                sources = this.resolveParameters(sources, parsedModel.expressions || []);
                for (const src of sources) {
                    const key = this._sourceKey(src);
                    if (!map.has(table.name)) map.set(table.name, new Set());
                    map.get(table.name).add(key);
                }
            }
        }
        return map;
    }

    /**
     * Extract all data sources from a parsed model
     * @param {Object} parsedModel - From TMDLParser.parseAll()
     * @returns {Array} Deduplicated data sources
     */
    static extractAllFromModel(parsedModel) {
        const allSources = [];

        // Build set of declared parameter expression names for reliable detection
        const declaredParams = new Set(
            (parsedModel.expressions || [])
                .filter(e => e.expression && /IsParameterQuery\s*=\s*true/i.test(e.expression))
                .map(e => e.name)
        );
        MExpressionParser._declaredParams = declaredParams;

        // Build map of shared expression bodies for delegation resolution
        const expressionBodies = {};
        for (const expr of (parsedModel.expressions || [])) {
            if (expr.name && expr.expression) expressionBodies[expr.name] = expr.expression;
        }

        for (const table of (parsedModel.tables || [])) {
            for (const partition of (table.partitions || [])) {
                if (!partition.source) continue;
                let sources = this.extractDataSources(partition.source);

                // If partition M is a simple delegation, resolve through the shared expression
                if (sources.length === 0) {
                    const refName = this._extractSharedExpressionRef(partition.source);
                    const refBody = refName && expressionBodies[refName];
                    if (refBody) {
                        sources = this.extractDataSources(refBody);
                    }
                }

                for (const src of sources) {
                    src.tableName = table.name;
                    src.partitionName = partition.name;
                }
                allSources.push(...sources);
            }
        }

        // Issue #20: also scan all shared expressions for data source connectors.
        // These are queries with "Enable Load = false" (or helpers referenced via merge/append)
        // that the partition loop above misses because they're never the direct M of a loaded table.
        for (const expr of (parsedModel.expressions || [])) {
            if (!expr.expression || !expr.name) continue;
            if (declaredParams.has(expr.name)) continue;
            // Skip helpers, functions, lists, records — they're not data-bound queries
            const rt = (expr.resultType || '').toLowerCase();
            if (rt === 'function' || rt === 'list' || rt === 'record') continue;
            if (this._looksLikeMFunction(expr.expression)) continue;

            const sources = this.extractDataSources(expr.expression);
            for (const src of sources) {
                src.expressionName = expr.name;
                src.isNonLoadedQuery = true;
                // tableName intentionally left null — populated only when a partition consumes it
            }
            allSources.push(...sources);
        }

        // Resolve parameters
        const resolved = this.resolveParameters(allSources, parsedModel.expressions || []);

        for (const src of resolved) {
            const gw = this._requiresGateway(src);
            if (gw !== null) src.gatewayRequired = gw;
        }

        return this.deduplicateSources(resolved);
    }

    /**
     * Detect whether an M expression body declares a function rather than a query
     * (e.g. `let f = (x) => x + 1 in f` or `(a, b) => ...`). Returns true if the body
     * is a function declaration so it should be excluded from data-source scanning.
     */
    static _looksLikeMFunction(body) {
        if (!body) return false;
        const stripped = body.replace(/^\s*```[^\n]*\n?/, '').replace(/\n?```\s*$/, '').trim();
        // Top-level fat arrow with leading parameter list: "(a, b) => ..."
        if (/^\(\s*[^)]*\)\s*=>/.test(stripped)) return true;
        // let-in where the only step is a function: "let f = (...) => ... in f"
        if (/^let\s+\S+\s*=\s*\([^)]*\)\s*=>/i.test(stripped)) return true;
        return false;
    }

    /**
     * Determine if a data source requires an on-premises data gateway
     * @param {Object} source - Source object from extractDataSources
     * @returns {boolean|null} true if gateway required, false if cloud, null if unknown
     */
    static _requiresGateway(source) {
        const onPremConnectors = ['SQL Server', 'Oracle', 'Teradata', 'SAP HANA', 'ODBC', 'Analysis Services'];
        if (onPremConnectors.includes(source.type)) {
            const server = source.serverResolved || source.server || '';
            const isCloud = /\.database\.windows\.net|\.sql\.azuresynapse\.net|\.datawarehouse\.fabric\.microsoft\.com|\.pbidedicated\.windows\.net|\.asazure\.windows\.net/i.test(server);
            return !isCloud;
        }
        if (['Excel', 'CSV'].includes(source.type)) {
            const path = source.path || '';
            return !/sharepoint|onedrive/i.test(path);
        }
        const cloudConnectors = [
            'Azure Blob Storage', 'Dataverse', 'Snowflake', 'Google BigQuery',
            'Power BI Dataflow', 'OData', 'SharePoint Tables', 'SharePoint Files',
            'Fabric Lakehouse', 'Fabric Warehouse', 'Azure Data Explorer', 'Databricks',
            'Web', 'MySQL', 'PostgreSQL'
        ];
        if (cloudConnectors.includes(source.type)) return false;
        return null; // unknown
    }

    /**
     * Parse a Power Query M let...in expression into ordered named steps.
     * Resolves shared expression references before parsing when expressionBodies is provided.
     *
     * @param {string} mExpr - Raw M expression text
     * @param {Object} [expressionBodies] - Map of shared expression name → body text
     * @returns {Array<{name:string, kind:string, exprText:string, refs:string[]}>}
     *   kind values: Source | Navigation | Projection | Rename | Filter | Join |
     *                AddColumn | TypeChange | Expand | Custom
     */
    static parseMSteps(mExpr, expressionBodies = {}) {
        if (!mExpr) return [];

        // Resolve shared expression delegation
        let resolved = mExpr;
        const refName = this._extractSharedExpressionRef(mExpr);
        if (refName && expressionBodies[refName]) {
            resolved = expressionBodies[refName];
        }

        // Strip optional ``` fences
        resolved = resolved.replace(/^\s*```\s*\n?/, '').replace(/\n?\s*```\s*$/, '');

        // Find the let...in block
        const letMatch = /^\s*let\b/i.exec(resolved);
        if (!letMatch) return [];

        const afterLet = resolved.slice(letMatch.index + letMatch[0].length);

        // Split into step definitions respecting nested parens/brackets/braces and string literals
        const steps = [];
        let buf = '';
        let depth = 0;
        let inStr = false;
        let strChar = '';
        let i = 0;

        while (i < afterLet.length) {
            const ch = afterLet[i];

            // Handle string literals ("..." style)
            if (inStr) {
                buf += ch;
                if (ch === strChar && afterLet[i - 1] !== '\\') inStr = false;
                i++; continue;
            }
            if (ch === '"' || ch === "'") {
                inStr = true; strChar = ch; buf += ch; i++; continue;
            }

            // Track depth for parens/brackets/braces
            if (ch === '(' || ch === '[' || ch === '{') { depth++; buf += ch; i++; continue; }
            if (ch === ')' || ch === ']' || ch === '}') { depth--; buf += ch; i++; continue; }

            // Top-level comma = step boundary
            if (ch === ',' && depth === 0) {
                const step = this._parseOneStep(buf.trim());
                if (step) steps.push(step);
                buf = '';
                i++; continue;
            }

            // "in" keyword at depth 0 ends the let block
            if (depth === 0 && ch === 'i' && afterLet[i + 1] === 'n' && /\s/.test(afterLet[i + 2] || ' ')) {
                // Confirm we're not in the middle of an identifier
                const prev = afterLet[i - 1] || ' ';
                if (/[\s,]/.test(prev)) {
                    const step = this._parseOneStep(buf.trim());
                    if (step) steps.push(step);
                    buf = '';
                    break;
                }
            }

            buf += ch;
            i++;
        }

        // Trailing step if "in" not seen
        if (buf.trim()) {
            const step = this._parseOneStep(buf.trim());
            if (step) steps.push(step);
        }

        return steps;
    }

    /**
     * Parse a single "Name = expr" step text into a step descriptor.
     */
    static _parseOneStep(text) {
        if (!text) return null;

        // Extract name (quoted or unquoted) and expression
        const nameMatch = text.match(/^(?:#"([^"]+)"|([A-Za-z_\u00C0-\u024F][A-Za-z0-9_ \u00C0-\u024F]*))\s*=\s*([\s\S]*)/);
        if (!nameMatch) return null;

        const name = nameMatch[1] || nameMatch[2];
        const exprText = nameMatch[3].trim();
        const kind = this._classifyStepKind(exprText);
        const refs = this._extractStepRefs(exprText);

        return { name, kind, exprText, refs };
    }

    /**
     * Classify a step expression into a kind bucket.
     */
    static _classifyStepKind(expr) {
        if (/^(?:Sql\.|GoogleBigQuery\.|AzureDataExplorer\.|Kusto\.|Lakehouse\.|Fabric\.|Databricks\.|Snowflake\.|PostgreSQL\.|MySQL\.|Teradata\.|SapHana\.|Odbc\.|Oracle\.|Excel\.|Csv\.|OData\.|SharePoint\.|PowerBI\.|Web\.|Value\.NativeQuery)/i.test(expr)) return 'Source';
        if (/^\w+\s*\{\s*\[/.test(expr)) return 'Navigation'; // item{[Schema=...,Item=...]}[Data]
        if (/^\w+\s*\[/.test(expr) && !/^Table\./.test(expr)) return 'Navigation'; // step["column"]
        if (/^Table\.SelectColumns\b/.test(expr)) return 'Projection';
        if (/^Table\.RenameColumns\b/.test(expr)) return 'Rename';
        if (/^Table\.SelectRows\b/.test(expr)) return 'Filter';
        if (/^Table\.NestedJoin\b/.test(expr)) return 'Join';
        if (/^Table\.Combine\b/.test(expr)) return 'Join';
        if (/^Table\.AddColumn\b/.test(expr)) return 'AddColumn';
        if (/^Table\.TransformColumnTypes\b/.test(expr)) return 'TypeChange';
        if (/^Table\.ExpandTableColumn\b/.test(expr)) return 'Expand';
        if (/^Table\.RemoveColumns\b/.test(expr)) return 'Projection';
        if (/^Table\.ReorderColumns\b/.test(expr)) return 'Projection';
        return 'Custom';
    }

    /**
     * Extract step-name references from a step expression (identifiers before Table.* calls).
     */
    static _extractStepRefs(expr) {
        // Match unquoted identifiers and #"quoted" that likely refer to prior steps
        const refs = [];
        const pat = /(?:^|[,({\s])(?:#"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))\s*(?=[,\[{)]|$)/g;
        let m;
        while ((m = pat.exec(expr)) !== null) {
            const name = m[1] || m[2];
            // Skip M built-ins and common keywords
            if (/^(let|in|if|then|else|each|try|otherwise|true|false|null|and|or|not|meta|type|error|section|shared|Table|Text|Number|List|Record|Date|DateTime|Duration|Binary|Value|Function|Type|Logical|Web|Sql|Csv|Excel|Json|OData|SharePoint|Power|Fabric|Google|Azure|Snowflake|Databricks|Odbc|Oracle|Teradata|Kusto|SapHana|MySQL|PostgreSQL)$/i.test(name)) continue;
            refs.push(name);
        }
        return [...new Set(refs)];
    }

    /**
     * Parse M steps for every table in a model, resolving shared expression refs.
     * Returns Map<tableName, Array<step>>
     */
    static parseMStepsFromModel(parsedModel) {
        const expressionBodies = {};
        for (const expr of (parsedModel.expressions || [])) {
            if (expr.name && expr.expression) expressionBodies[expr.name] = expr.expression;
        }

        const map = new Map();
        for (const table of (parsedModel.tables || [])) {
            // Try refreshPolicy.sourceExpression first
            const rp = table.refreshPolicy?.sourceExpression;
            if (rp) {
                const steps = this.parseMSteps(rp, expressionBodies);
                if (steps.length > 0) { map.set(table.name, steps); continue; }
            }
            for (const partition of (table.partitions || [])) {
                if (!partition.source) continue;
                const steps = this.parseMSteps(partition.source, expressionBodies);
                if (steps.length > 0) { map.set(table.name, steps); break; }
            }
        }
        return map;
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = MExpressionParser;
}
