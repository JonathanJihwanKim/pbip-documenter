/**
 * PBIP Documenter — App Module
 * UI logic, File System Access API integration, event handlers
 */

class App {
    constructor() {
        this.folderHandle = null;
        this.semanticModelHandle = null;
        this.reportHandle = null;
        this.parsedModel = null;
        this.visualData = null;
        this.measureRefs = null;
        this.docGenerator = null;
        this.diagramRenderer = null;

        this.init();
    }

    init() {
        // Check browser support
        if (!('showDirectoryPicker' in window)) {
            document.getElementById('browserWarning').classList.remove('hidden');
            document.getElementById('openFolderBtn').disabled = true;
            return;
        }

        // Bind events
        document.getElementById('openFolderBtn').addEventListener('click', () => this.openFolder());
        document.getElementById('changeFolderBtn').addEventListener('click', () => this.openFolder());
        document.getElementById('downloadMD').addEventListener('click', () => this.downloadMarkdown());
        document.getElementById('downloadHTML').addEventListener('click', () => this.downloadHTML());
        document.getElementById('downloadJSON').addEventListener('click', () => this.downloadJSON());
        document.getElementById('downloadSVG').addEventListener('click', () => this.downloadSVG());

        // Sidebar navigation
        document.querySelectorAll('.sidebar-header').forEach(header => {
            header.addEventListener('click', () => {
                const section = header.dataset.section;
                this.showSection(section);
            });
        });

        // Sidebar chevron collapse/expand
        document.querySelectorAll('.sidebar-chevron').forEach(chevron => {
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                const section = chevron.closest('.sidebar-section');
                section.classList.toggle('collapsed');
                const isExpanded = !section.classList.contains('collapsed');
                chevron.setAttribute('aria-expanded', String(isExpanded));
                try { localStorage.setItem('pbip-doc-sidebar-tables-collapsed', !isExpanded); } catch {}
            });
        });
    }

    // ──────────────────────────────────────────────
    // FILE SYSTEM ACCESS
    // ──────────────────────────────────────────────

    async openFolder() {
        try {
            this.folderHandle = await window.showDirectoryPicker({
                mode: 'read',
                startIn: 'documents'
            });

            // Find SemanticModel and Report folders
            await this.findPBIPStructure();

            // Show folder info
            document.getElementById('landingSection').classList.add('hidden');
            document.getElementById('folderInfo').classList.remove('hidden');
            document.getElementById('folderName').textContent = this.folderHandle.name;

            // Parse the model
            await this.parseModel();

        } catch (error) {
            if (error.name === 'AbortError') return; // User cancelled
            this.showToast(error.message, 'error');
            console.error('Error opening folder:', error);
        }
    }

    async findPBIPStructure() {
        this.semanticModelHandle = null;
        this.reportHandle = null;

        // Check if selected folder IS a .SemanticModel folder
        if (this.folderHandle.name.endsWith('.SemanticModel')) {
            this.semanticModelHandle = this.folderHandle;
            return;
        }

        // Check if selected folder contains definition/ directly (is a SemanticModel)
        try {
            await this.folderHandle.getDirectoryHandle('definition');
            // Check for tables subfolder in definition
            const def = await this.folderHandle.getDirectoryHandle('definition');
            await def.getDirectoryHandle('tables');
            this.semanticModelHandle = this.folderHandle;
            return;
        } catch {
            // Not a direct semantic model folder, scan children
        }

        // Scan for .SemanticModel and .Report subfolders
        for await (const entry of this.folderHandle.values()) {
            if (entry.kind === 'directory') {
                if (entry.name.endsWith('.SemanticModel')) {
                    this.semanticModelHandle = entry;
                } else if (entry.name.endsWith('.Report')) {
                    this.reportHandle = entry;
                }
            }
        }

        if (!this.semanticModelHandle) {
            throw new Error(
                'No semantic model found.\n\n' +
                'Please select a PBIP project folder containing a .SemanticModel subfolder,\n' +
                'or select the .SemanticModel folder directly.'
            );
        }
    }

    // ──────────────────────────────────────────────
    // PARSING
    // ──────────────────────────────────────────────

    async parseModel() {
        this.showLoading(true);

        try {
            // Read all TMDL files
            const files = await this.readAllTMDLFiles();

            // Parse TMDL
            const parser = new TMDLParser();
            this.parsedModel = parser.parseAll(files);

            // Extract DAX references
            this.measureRefs = parser.extractAllReferences();

            // Parse visuals if report folder exists
            this.visualData = null;
            if (this.reportHandle) {
                try {
                    const reportPages = await this.readReportFiles();
                    const visualParser = new VisualParser();
                    this.visualData = visualParser.parseReport(reportPages);
                } catch (err) {
                    console.warn('Could not parse report visuals:', err);
                }
            }

            // Create doc generator
            this.docGenerator = new DocGenerator(
                this.parsedModel,
                this.visualData?.fieldUsageMap || {},
                this.measureRefs
            );

            // Update UI
            this.updateStats();
            this.buildSidebar();
            this.renderOverview();
            this.showSection('overview');

            document.getElementById('statsBar').classList.remove('hidden');
            document.getElementById('downloadBar').classList.remove('hidden');
            document.getElementById('appBody').classList.remove('hidden');

            // Pre-render relationship diagram
            this.renderRelationshipDiagram();

        } catch (error) {
            this.showToast('Error parsing model: ' + error.message, 'error');
            console.error('Parse error:', error);
        } finally {
            this.showLoading(false);
        }
    }

    async readAllTMDLFiles() {
        const files = {};
        const defHandle = await this.semanticModelHandle.getDirectoryHandle('definition');

        // Read top-level files
        for await (const entry of defHandle.values()) {
            if (entry.kind === 'file' && entry.name.endsWith('.tmdl')) {
                files[entry.name] = await this.readFile(entry);
            }
        }

        // Read tables/*.tmdl
        try {
            const tablesHandle = await defHandle.getDirectoryHandle('tables');
            for await (const entry of tablesHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.tmdl')) {
                    files[`tables/${entry.name}`] = await this.readFile(entry);
                }
            }
        } catch {
            console.warn('No tables folder found');
        }

        // Read roles/*.tmdl
        try {
            const rolesHandle = await defHandle.getDirectoryHandle('roles');
            for await (const entry of rolesHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.tmdl')) {
                    files[`roles/${entry.name}`] = await this.readFile(entry);
                }
            }
        } catch {
            // roles/ is optional
        }

        return files;
    }

    async readReportFiles() {
        const pages = [];
        let defHandle;

        try {
            defHandle = await this.reportHandle.getDirectoryHandle('definition');
        } catch {
            return pages;
        }

        let pagesHandle;
        try {
            pagesHandle = await defHandle.getDirectoryHandle('pages');
        } catch {
            return pages;
        }

        for await (const pageEntry of pagesHandle.values()) {
            if (pageEntry.kind !== 'directory') continue;

            let pageName = pageEntry.name;
            let displayName = pageEntry.name;

            // Try reading page.json for display name
            try {
                const pageJsonHandle = await pageEntry.getFileHandle('page.json');
                const pageContent = await this.readFile(pageJsonHandle);
                const pageData = JSON.parse(pageContent);
                displayName = pageData.displayName || pageData.name || pageEntry.name;
                pageName = pageData.name || pageEntry.name;
            } catch {
                // OK, use folder name
            }

            const visuals = [];

            // Read visuals
            try {
                const visualsHandle = await pageEntry.getDirectoryHandle('visuals');
                for await (const visualEntry of visualsHandle.values()) {
                    if (visualEntry.kind !== 'directory') continue;

                    try {
                        const visualJsonHandle = await visualEntry.getFileHandle('visual.json');
                        const visualContent = await this.readFile(visualJsonHandle);
                        const visualData = JSON.parse(visualContent);
                        visuals.push({
                            visualId: visualEntry.name,
                            visualData
                        });
                    } catch {
                        // Skip visuals without visual.json
                    }
                }
            } catch {
                // No visuals folder
            }

            pages.push({
                pageId: pageEntry.name,
                pageName,
                displayName,
                visuals
            });
        }

        return pages;
    }

    async readFile(fileHandle) {
        const file = await fileHandle.getFile();
        return await file.text();
    }

    // ──────────────────────────────────────────────
    // UI UPDATES
    // ──────────────────────────────────────────────

    updateStats() {
        const m = this.parsedModel;
        const totalColumns = m.tables.reduce((sum, t) => sum + t.columns.length, 0);
        const totalMeasures = m.tables.reduce((sum, t) => sum + t.measures.length, 0);
        const totalVisuals = this.visualData ? this.visualData.visuals.length : 0;

        document.getElementById('statTables').textContent = m.tables.length;
        document.getElementById('statColumns').textContent = totalColumns;
        document.getElementById('statMeasures').textContent = totalMeasures;
        document.getElementById('statRelationships').textContent = m.relationships.length;
        document.getElementById('statVisuals').textContent = totalVisuals;

        // Visuals hint and dimmed state
        const visualsCard = document.getElementById('statVisualsCard');
        const visualsHint = document.getElementById('statVisualsHint');
        if (!this.reportHandle) {
            visualsCard.classList.add('dimmed');
            visualsHint.textContent = 'No .Report folder found';
        } else if (totalVisuals === 0) {
            visualsCard.classList.remove('dimmed');
            visualsHint.textContent = 'No visuals detected';
        } else {
            visualsCard.classList.remove('dimmed');
            visualsHint.textContent = '';
        }
    }

    buildSidebar() {
        const m = this.parsedModel;
        const totalMeasures = m.tables.reduce((sum, t) => sum + t.measures.length, 0);

        document.getElementById('sidebarTableCount').textContent = m.tables.length;
        document.getElementById('sidebarMeasureCount').textContent = totalMeasures;
        document.getElementById('sidebarRelCount').textContent = m.relationships.length;
        document.getElementById('sidebarRoleCount').textContent = m.roles.length;

        // Report Pages list
        const pageSectionEl = document.getElementById('sidebarReportPagesSection');
        if (this.visualData && this.visualData.pages.length > 0) {
            pageSectionEl.classList.remove('hidden');
            document.getElementById('sidebarPageCount').textContent = this.visualData.pages.length;
            const pageList = document.getElementById('sidebarPageList');
            pageList.innerHTML = '';
            for (const page of this.visualData.pages) {
                const item = document.createElement('div');
                item.className = 'sidebar-item';
                item.textContent = page.displayName;
                item.dataset.pageId = page.id;
                item.addEventListener('click', () => this.showPageDetail(page.id));
                pageList.appendChild(item);
            }
        } else {
            pageSectionEl.classList.add('hidden');
        }

        // Table list
        const tableList = document.getElementById('sidebarTableList');
        tableList.innerHTML = '';

        for (const table of m.tables) {
            const item = document.createElement('div');
            item.className = 'sidebar-item';
            item.textContent = table.name;
            item.dataset.table = table.name;
            item.addEventListener('click', () => this.showTableDetail(table.name));
            tableList.appendChild(item);
        }

        // Collapse/expand table list based on saved state or table count
        const tablesSection = tableList.closest('.sidebar-section');
        const chevron = tablesSection.querySelector('.sidebar-chevron');
        let savedState = null;
        try { savedState = localStorage.getItem('pbip-doc-sidebar-tables-collapsed'); } catch {}
        let shouldCollapse;
        if (savedState !== null) {
            shouldCollapse = savedState === 'true';
        } else {
            shouldCollapse = m.tables.length > 10;
        }
        tablesSection.classList.toggle('collapsed', shouldCollapse);
        if (chevron) {
            chevron.setAttribute('aria-expanded', String(!shouldCollapse));
        }

        // Show/hide sections
        document.getElementById('sidebarRolesSection').classList.toggle('hidden', m.roles.length === 0);
        document.getElementById('sidebarExpressionsSection').classList.toggle('hidden', m.expressions.length === 0);
        document.getElementById('sidebarVisualUsageSection').classList.toggle('hidden', !this.visualData);
    }

    showSection(section) {
        // Hide all section views
        document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));

        // Show target section
        const viewId = `view-${section}`;
        const view = document.getElementById(viewId);
        if (view) {
            view.classList.add('active');
        }

        // Update sidebar active state
        document.querySelectorAll('.sidebar-header').forEach(h => h.classList.remove('active'));
        const header = document.querySelector(`.sidebar-header[data-section="${section}"]`);
        if (header) header.classList.add('active');

        document.querySelectorAll('.sidebar-item').forEach(item => item.classList.remove('active'));

        // Render content on demand
        if (section === 'report-pages') this.renderReportPagesOverview();
        if (section === 'tables') this.renderTables();
        if (section === 'measures') this.renderMeasureCatalog();
        if (section === 'roles') this.renderRoles();
        if (section === 'expressions') this.renderExpressions();
        if (section === 'visual-usage') this.renderVisualUsageView();
    }

    showTableDetail(tableName) {
        const table = this.parsedModel.tables.find(t => t.name === tableName);
        if (!table) return;

        // Update sidebar active
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.toggle('active', item.dataset.table === tableName);
        });

        // Show detail view
        document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
        document.getElementById('view-table-detail').classList.add('active');
        document.getElementById('tableDetailName').textContent = table.name;

        const content = document.getElementById('tableDetailContent');
        let html = '';

        if (table.description) {
            html += `<div class="description-quote">${this._esc(table.description)}</div>`;
        }

        if (table.isHidden) {
            html += `<p><span class="badge badge-hidden">Hidden Table</span></p>`;
        }

        // Columns
        if (table.columns.length > 0) {
            html += `<h3>Columns (${table.columns.length})</h3>`;
            html += `<table><tr><th>Column</th><th>Data Type</th><th>Description</th><th>Format</th><th>Status</th></tr>`;
            for (const col of table.columns) {
                html += `<tr>
                    <td>${this._esc(col.name)}</td>
                    <td>${col.dataType || ''}</td>
                    <td>${this._esc(col.description || '')}</td>
                    <td style="font-family:monospace;font-size:12px">${this._esc(col.formatString || '')}</td>
                    <td>${col.isHidden ? '<span class="badge badge-hidden">Hidden</span>' : ''}</td>
                </tr>`;
            }
            html += '</table>';
        }

        // Measures
        if (table.measures.length > 0) {
            html += `<h3>Measures (${table.measures.length})</h3>`;
            for (const measure of table.measures) {
                html += this._renderMeasureCard(measure, table.name);
            }
        }

        // Hierarchies
        if (table.hierarchies.length > 0) {
            html += `<h3>Hierarchies</h3>`;
            for (const h of table.hierarchies) {
                const levels = h.levels.map(l => l.name || l.column).join(' → ');
                html += `<p><strong>${this._esc(h.name)}</strong>: ${levels}</p>`;
            }
        }

        // Partitions
        if (table.partitions.length > 0) {
            html += `<h3>Partitions</h3>`;
            for (const p of table.partitions) {
                html += `<p><strong>${this._esc(p.name)}</strong> — mode: ${p.mode || 'default'}</p>`;
                if (p.source) {
                    html += `<div class="dax-block">${this._esc(p.source)}</div>`;
                }
            }
        }

        content.innerHTML = html;
    }

    renderOverview() {
        const m = this.parsedModel;
        const totalColumns = m.tables.reduce((sum, t) => sum + t.columns.length, 0);
        const totalMeasures = m.tables.reduce((sum, t) => sum + t.measures.length, 0);

        let html = '<table>';
        html += '<tr><th>Property</th><th>Value</th></tr>';

        if (m.database?.name) html += `<tr><td>Database</td><td>${this._esc(m.database.name)}</td></tr>`;
        if (m.database?.compatibilityLevel) html += `<tr><td>Compatibility Level</td><td>${m.database.compatibilityLevel}</td></tr>`;
        if (m.model?.culture) html += `<tr><td>Culture</td><td>${m.model.culture}</td></tr>`;

        html += `<tr><td>Tables</td><td>${m.tables.length}</td></tr>`;
        html += `<tr><td>Total Columns</td><td>${totalColumns}</td></tr>`;
        html += `<tr><td>Total Measures</td><td>${totalMeasures}</td></tr>`;
        html += `<tr><td>Relationships</td><td>${m.relationships.length}</td></tr>`;
        html += `<tr><td>Roles</td><td>${m.roles.length}</td></tr>`;
        html += `<tr><td>Expressions</td><td>${m.expressions.length}</td></tr>`;

        if (this.visualData) {
            html += `<tr><td>Report Pages</td><td>${this.visualData.pages.length}</td></tr>`;
            html += `<tr><td>Visuals</td><td>${this.visualData.visuals.length}</td></tr>`;
        }

        html += '</table>';

        // Table summary
        html += '<h3>Tables</h3>';
        html += '<table><tr><th>Table</th><th>Columns</th><th>Measures</th><th>Hidden</th></tr>';
        for (const t of m.tables) {
            html += `<tr>
                <td><a href="#" class="table-link" data-table="${this._esc(t.name)}" style="color:var(--primary);text-decoration:none;font-weight:500">${this._esc(t.name)}</a></td>
                <td>${t.columns.length}</td>
                <td>${t.measures.length}</td>
                <td>${t.isHidden ? '<span class="badge badge-hidden">Yes</span>' : ''}</td>
            </tr>`;
        }
        html += '</table>';

        document.getElementById('overviewContent').innerHTML = html;

        // Bind table links
        document.querySelectorAll('.table-link').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                this.showTableDetail(link.dataset.table);
            });
        });
    }

    renderTables() {
        const m = this.parsedModel;
        let html = '<table><tr><th>Table</th><th>Columns</th><th>Measures</th><th>Hierarchies</th><th>Hidden</th></tr>';

        for (const t of m.tables) {
            html += `<tr>
                <td><a href="#" class="table-link-2" data-table="${this._esc(t.name)}" style="color:var(--primary);font-weight:500;text-decoration:none">${this._esc(t.name)}</a></td>
                <td>${t.columns.length}</td>
                <td>${t.measures.length}</td>
                <td>${t.hierarchies.length}</td>
                <td>${t.isHidden ? '<span class="badge badge-hidden">Yes</span>' : ''}</td>
            </tr>`;
        }
        html += '</table>';

        document.getElementById('tablesContent').innerHTML = html;

        document.querySelectorAll('.table-link-2').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                this.showTableDetail(link.dataset.table);
            });
        });
    }

    renderMeasureCatalog() {
        const m = this.parsedModel;
        let html = '';

        // Group by display folder
        const byFolder = {};
        for (const table of m.tables) {
            for (const measure of table.measures) {
                const folder = measure.displayFolder || '(No Folder)';
                if (!byFolder[folder]) byFolder[folder] = [];
                byFolder[folder].push({ ...measure, tableName: table.name });
            }
        }

        const folders = Object.keys(byFolder).sort();

        for (const folder of folders) {
            html += `<h3>${this._esc(folder)}</h3>`;
            for (const measure of byFolder[folder]) {
                html += this._renderMeasureCard(measure, measure.tableName);
            }
        }

        document.getElementById('measuresContent').innerHTML = html;
    }

    renderRoles() {
        const m = this.parsedModel;
        let html = '';

        if (m.roles.length === 0) {
            html = '<p class="placeholder">No roles defined in this model.</p>';
        } else {
            for (const role of m.roles) {
                html += `<h3>${this._esc(role.name)}</h3>`;
                if (role.modelPermission) {
                    html += `<p><strong>Permission:</strong> ${role.modelPermission}</p>`;
                }
                if (role.tablePermissions.length > 0) {
                    html += '<table><tr><th>Table</th><th>Filter Expression</th></tr>';
                    for (const tp of role.tablePermissions) {
                        html += `<tr><td>${this._esc(tp.table)}</td><td><code>${this._esc(tp.filterExpression || '')}</code></td></tr>`;
                    }
                    html += '</table>';
                }
            }
        }

        document.getElementById('rolesContent').innerHTML = html;
    }

    renderExpressions() {
        const m = this.parsedModel;
        let html = '';

        if (m.expressions.length === 0) {
            html = '<p class="placeholder">No shared expressions defined.</p>';
        } else {
            for (const expr of m.expressions) {
                html += `<h3>${this._esc(expr.name)}</h3>`;
                if (expr.kind) html += `<p><strong>Kind:</strong> ${expr.kind}</p>`;
                if (expr.expression) {
                    html += `<div class="dax-block">${this._esc(expr.expression)}</div>`;
                }
            }
        }

        document.getElementById('expressionsContent').innerHTML = html;
    }

    renderRelationshipDiagram() {
        const container = document.getElementById('relationshipsDiagram');
        this.diagramRenderer = new DiagramRenderer(container);
        this.diagramRenderer.renderRelationshipDiagram(this.parsedModel.tables, this.parsedModel.relationships);

        // Also render list view
        let html = '';
        if (this.parsedModel.relationships.length === 0) {
            html = '<p style="margin-top:16px;color:var(--text-secondary)">No relationships defined.</p>';
        } else {
            html = '<h3 style="margin-top:20px">Relationship Details</h3>';
            html += '<table><tr><th>From</th><th></th><th>To</th><th>Cardinality</th><th>Cross-Filter</th><th>Active</th></tr>';
            for (const r of this.parsedModel.relationships) {
                html += `<tr>
                    <td>${this._esc(r.fromTable)}[${this._esc(r.fromColumn)}]</td>
                    <td class="rel-arrow">→</td>
                    <td>${this._esc(r.toTable)}[${this._esc(r.toColumn)}]</td>
                    <td>${(r.fromCardinality || 'many')}:${(r.toCardinality || 'one')}</td>
                    <td>${r.crossFilteringBehavior || 'single'}</td>
                    <td>${r.isActive ? '<span class="badge badge-active">Active</span>' : '<span class="badge badge-inactive">Inactive</span>'}</td>
                </tr>`;
            }
            html += '</table>';
        }
        document.getElementById('relationshipsList').innerHTML = html;
    }

    // ──────────────────────────────────────────────
    // REPORT PAGES & VISUAL EXPLORER
    // ──────────────────────────────────────────────

    renderReportPagesOverview() {
        if (!this.visualData) return;
        let html = '<table><tr><th>Page</th><th>Visuals</th></tr>';
        for (const page of this.visualData.pages) {
            html += `<tr>
                <td><a href="#" class="page-nav-link" data-page-id="${this._esc(page.id)}"
                    style="color:var(--primary);font-weight:500;text-decoration:none">
                    ${this._esc(page.displayName)}</a></td>
                <td>${page.visuals.length}</td>
            </tr>`;
        }
        html += '</table>';
        document.getElementById('reportPagesContent').innerHTML = html;

        document.querySelectorAll('.page-nav-link').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                this.showPageDetail(link.dataset.pageId);
            });
        });
    }

    showPageDetail(pageId) {
        if (!this.visualData) return;
        const page = this.visualData.pages.find(p => p.id === pageId);
        if (!page) return;

        document.querySelectorAll('.section-view').forEach(el => el.classList.remove('active'));
        document.getElementById('view-report-page').classList.add('active');
        document.getElementById('reportPageName').textContent = page.displayName;

        // Mark sidebar active
        document.querySelectorAll('.sidebar-header').forEach(h => h.classList.remove('active'));
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.toggle('active', item.dataset.pageId === pageId);
        });

        let html = '';
        if (page.visuals.length === 0) {
            html = '<p class="placeholder"><span class="material-symbols-outlined">visibility_off</span>No visuals on this page.</p>';
        } else {
            for (const visual of page.visuals) {
                html += this._renderVisualCard(visual);
            }
        }
        document.getElementById('reportPageContent').innerHTML = html;
        this._bindFieldChips();
    }

    renderVisualUsageView() {
        if (!this.visualData) return;

        // Set up toggle
        const toggle = document.getElementById('visualUsageToggle');
        if (!toggle.dataset.bound) {
            toggle.dataset.bound = 'true';
            toggle.querySelectorAll('.view-toggle-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    toggle.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const view = btn.dataset.view;
                    document.getElementById('visualUsageByVisual').classList.toggle('hidden', view !== 'by-visual');
                    document.getElementById('visualUsageByField').classList.toggle('hidden', view !== 'by-field');
                    if (view === 'by-field') {
                        this._ensureFieldDiagramRendered();
                    }
                });
            });
        }

        // Render "By Visual" view
        this._renderByVisualView();
    }

    _ensureFieldDiagramRendered() {
        const container = document.getElementById('visualUsageByField');
        if (container.children.length > 0) return;
        const renderer = new DiagramRenderer(container);
        renderer.renderVisualUsageDiagram(
            this.visualData.fieldUsageMap,
            this.visualData.pages
        );
    }

    _renderByVisualView() {
        let html = '';
        for (const page of this.visualData.pages) {
            html += `<div class="page-group">
                <div class="page-group-header" data-page-group="${this._esc(page.id)}">
                    <span class="material-symbols-outlined">auto_stories</span>
                    ${this._esc(page.displayName)}
                    <span style="font-size:12px;font-weight:400;color:var(--text-secondary);margin-left:auto">
                        ${page.visuals.length} visual${page.visuals.length !== 1 ? 's' : ''}
                    </span>
                    <span class="material-symbols-outlined chevron-icon">expand_more</span>
                </div>
                <div class="page-group-content">`;

            if (page.visuals.length === 0) {
                html += '<p class="visual-card-empty">No visuals on this page.</p>';
            } else {
                for (const visual of page.visuals) {
                    html += this._renderVisualCard(visual);
                }
            }
            html += '</div></div>';
        }
        document.getElementById('visualUsageByVisual').innerHTML = html;

        // Bind page group collapse
        document.querySelectorAll('.page-group-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                header.nextElementSibling.classList.toggle('collapsed');
            });
        });

        this._bindFieldChips();
    }

    _renderVisualCard(visual) {
        const vType = visual.visualType || 'unknown';
        const vName = visual.visualName || vType;

        let html = `<div class="visual-card">
            <div class="visual-card-header">
                <h4>${this._esc(vName)}</h4>
                <span class="badge-visual-type">${this._esc(vType)}</span>
            </div>`;

        if (!visual.fields || visual.fields.length === 0) {
            html += '<p class="visual-card-empty">No data fields</p>';
        } else {
            const roleGroups = {};
            for (const field of visual.fields) {
                const role = this._normalizeRoleName(field.projectionName || 'Other');
                if (!roleGroups[role]) roleGroups[role] = [];
                roleGroups[role].push(field);
            }

            const roleOrder = ['Values', 'Category', 'Series', 'Filters', 'Tooltips', 'Other'];
            html += '<div class="visual-field-roles">';
            for (const role of roleOrder) {
                const fields = roleGroups[role];
                if (!fields || fields.length === 0) continue;

                html += `<div class="visual-role-row">
                    <span class="visual-role-label">${this._esc(role)}</span>
                    <div class="visual-role-fields">`;

                for (const field of fields) {
                    const tableName = field.table || field.entity || '';
                    const fieldName = field.name || field.column || field.hierarchy || '';
                    html += `<button type="button" class="field-chip" data-role="${this._esc(role)}"
                        data-table="${this._esc(tableName)}"
                        data-field="${this._esc(fieldName)}">${this._esc(tableName)}[${this._esc(fieldName)}]</button>`;
                }
                html += '</div></div>';
            }
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    _normalizeRoleName(projectionName) {
        if (!projectionName) return 'Other';
        const lower = projectionName.toLowerCase();
        if (lower === 'values' || lower === 'y') return 'Values';
        if (lower === 'category' || lower === 'x' || lower === 'axis' || lower === 'rows' || lower === 'columns') return 'Category';
        if (lower === 'series' || lower === 'legend') return 'Series';
        if (lower === 'filter' || lower === 'filters') return 'Filters';
        if (lower === 'tooltips' || lower === 'tooltip') return 'Tooltips';
        if (lower === 'sort' || lower === 'visualobjects') return 'Other';
        return projectionName.charAt(0).toUpperCase() + projectionName.slice(1);
    }

    _bindFieldChips() {
        document.querySelectorAll('.field-chip[data-table]').forEach(chip => {
            chip.addEventListener('click', () => {
                const tableName = chip.dataset.table;
                if (tableName && this.parsedModel.tables.find(t => t.name === tableName)) {
                    this.showTableDetail(tableName);
                }
            });
        });
    }

    // ──────────────────────────────────────────────
    // MEASURE CARD RENDERING
    // ──────────────────────────────────────────────

    _renderMeasureCard(measure, tableName) {
        let html = `<div class="measure-card">
            <h4>${this._esc(measure.name)} <span class="badge badge-table">${this._esc(tableName)}</span></h4>`;

        if (measure.description) {
            html += `<div class="description-quote">${this._esc(measure.description)}</div>`;
        }

        html += '<div class="measure-meta">';
        if (measure.displayFolder) html += `<span>📁 ${this._esc(measure.displayFolder)}</span>`;
        if (measure.formatString) html += `<span>📐 ${this._esc(measure.formatString)}</span>`;
        html += '</div>';

        if (measure.expression) {
            html += `<div class="dax-block">${this._esc(measure.expression)}</div>`;
        }

        // References
        const refs = this.measureRefs?.[measure.name];
        if (refs) {
            if (refs.columnRefs.length > 0) {
                html += '<div style="margin:4px 0;font-size:13px"><strong>Columns:</strong> ';
                html += refs.columnRefs.map(r => `<code style="background:#e3f2fd;padding:1px 4px;border-radius:2px">${this._esc(r.table)}[${this._esc(r.column)}]</code>`).join(' ');
                html += '</div>';
            }
            if (refs.measureRefs.length > 0) {
                html += '<div style="margin:4px 0;font-size:13px"><strong>Measures:</strong> ';
                html += refs.measureRefs.map(r => `<code style="background:#fff8e1;padding:1px 4px;border-radius:2px">[${this._esc(r)}]</code>`).join(' ');
                html += '</div>';
            }
        }

        // Visual usage
        if (this.visualData) {
            const usageKey = `measure|${tableName}|${measure.name}`;
            const usage = this.visualData.fieldUsageMap[usageKey];
            if (usage && usage.length > 0) {
                html += '<div style="margin-top:6px">';
                for (const u of usage) {
                    html += `<span class="visual-usage-tag">${this._esc(u.pageName)}: ${this._esc(u.visualName)}</span> `;
                }
                html += '</div>';
            }
        }

        html += '</div>';
        return html;
    }

    // ──────────────────────────────────────────────
    // DOWNLOADS
    // ──────────────────────────────────────────────

    downloadMarkdown() {
        if (!this.docGenerator) return;
        const md = this.docGenerator.generateMarkdown();
        const name = (this.parsedModel.database?.name || 'model') + '-documentation.md';
        this._downloadFile(md, name, 'text/markdown');
        this.showToast('Markdown downloaded');
    }

    downloadHTML() {
        if (!this.docGenerator) return;
        const html = this.docGenerator.generateHTML();
        const name = (this.parsedModel.database?.name || 'model') + '-documentation.html';
        this._downloadFile(html, name, 'text/html');
        this.showToast('HTML downloaded');
    }

    downloadJSON() {
        if (!this.docGenerator) return;
        const json = this.docGenerator.generateJSON();
        const name = (this.parsedModel.database?.name || 'model') + '-documentation.json';
        this._downloadFile(json, name, 'application/json');
        this.showToast('JSON downloaded');
    }

    downloadSVG() {
        if (!this.diagramRenderer) return;
        const svgStr = this.diagramRenderer.exportSVG();
        if (!svgStr) {
            this.showToast('No diagram to export', 'error');
            return;
        }
        const name = (this.parsedModel.database?.name || 'model') + '-relationships.svg';
        this._downloadFile(svgStr, name, 'image/svg+xml');
        this.showToast('SVG diagram downloaded');
    }

    _downloadFile(content, filename, mimeType) {
        const blob = new Blob([content], { type: mimeType + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // ──────────────────────────────────────────────
    // UTILITIES
    // ──────────────────────────────────────────────

    showToast(message, type = '') {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast' + (type === 'error' ? ' error' : '');
        setTimeout(() => toast.classList.add('hidden'), 4000);
    }

    showLoading(show) {
        document.getElementById('loadingIndicator').classList.toggle('hidden', !show);
    }

    _esc(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
