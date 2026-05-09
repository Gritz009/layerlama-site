// Layer Lama -- Portfolio Admin frontend
(() => {
    'use strict';

    // ----- token bootstrap -----
    const ADMIN_TOKEN = (function () {
        const params = new URLSearchParams(location.search);
        const fromUrl = params.get('t');
        if (fromUrl) {
            sessionStorage.setItem('ll_admin_token', fromUrl);
            params.delete('t');
            const clean = location.pathname + (params.toString() ? ('?' + params.toString()) : '') + location.hash;
            history.replaceState({}, '', clean);
            return fromUrl;
        }
        return sessionStorage.getItem('ll_admin_token') || '';
    })();
    const rawFetch = window.fetch.bind(window);
    function apiFetch(url, opts) {
        opts = opts || {};
        const headers = new Headers(opts.headers || {});
        headers.set('X-Admin-Token', ADMIN_TOKEN);
        return rawFetch(url, Object.assign({}, opts, { headers }));
    }

    // ----- theme -----
    (function setupTheme() {
        const root = document.documentElement;
        const saved = localStorage.getItem('ll-theme');
        if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
        const btn = document.getElementById('themeToggle');
        if (!btn) return;
        btn.addEventListener('click', () => {
            const next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
            root.setAttribute('data-theme', next);
            localStorage.setItem('ll-theme', next);
        });
    })();

    const el = (id) => document.getElementById(id);
    const form        = el('form');
    const projectName = el('projectName');
    const folderName  = el('folderName');
    const projectKey  = el('projectKey');
    const material    = el('material');
    const printer     = el('printer');
    const cardMeta    = el('cardMeta');
    const thumbnail   = el('thumbnail');
    const gallery     = el('gallery');
    const thumbPrev   = el('thumbPreview');
    const galleryPrev = el('galleryPreview');
    const submitBtn   = el('submitBtn');
    const resetBtn    = el('resetBtn');
    const result      = el('result');
    const statusDot   = el('statusDot');
    const statusText  = el('statusText');
    const writeNotion = el('writeNotion');

    // ----- generic SSE consumer -----
    async function runStreamingJob(opts) {
        const { url, body, btn, btnSpinnerLabel, panel, titleEl, elapsedEl, logEl, stepEls, runningTitle, doneTitle, failTitle } = opts;
        function setStep(step, state, label) {
            const li = stepEls[step];
            if (!li) return;
            li.className = 'state-' + state;
            const icon = li.querySelector('.step-icon');
            const lbl = li.querySelector('.step-label');
            if (icon) icon.textContent = state === 'running' ? '~' : (state === 'done' ? 'OK' : (state === 'error' ? 'X' : 'o'));
            if (lbl && label) lbl.textContent = label;
        }
        function appendLog(line) { logEl.textContent += line + '\n'; }
        for (const k in stepEls) setStep(k, '', '');
        logEl.textContent = '';
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>' + btnSpinnerLabel; }
        if (panel) panel.style.display = '';
        if (titleEl) titleEl.textContent = runningTitle;
        const startedAt = Date.now();
        const ticker = setInterval(() => { if (elapsedEl) elapsedEl.textContent = Math.floor((Date.now() - startedAt) / 1000) + 's'; }, 250);

        let okEvt = null, errMsg = null;
        try {
            const r = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
            if (!r.ok) { let msg = 'HTTP ' + r.status; try { msg = (await r.json()).error || msg; } catch (e) {} throw new Error(msg); }
            if (!r.body || !r.body.getReader) throw new Error('Browser does not support streaming responses.');
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const events = buf.split('\n\n');
                buf = events.pop();
                for (const block of events) {
                    for (const line of block.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        let evt; try { evt = JSON.parse(line.slice(6)); } catch (e) { continue; }
                        if (evt.text)   appendLog('  ' + evt.text);
                        if (evt.output) appendLog(evt.output);
                        if (evt.step && evt.status === 'running') setStep(evt.step, 'running', evt.label);
                        if (evt.step && evt.status === 'done')    setStep(evt.step, 'done');
                        if (evt.step && evt.status === 'error') { setStep(evt.step, 'error'); errMsg = evt.output || evt.message || (evt.step + ' failed'); }
                        if (!evt.step && evt.status === 'complete') okEvt = evt;
                        if (!evt.step && evt.status === 'error')    errMsg = evt.message || 'failed';
                    }
                }
            }
        } catch (err) {
            errMsg = err.message || String(err);
        }
        clearInterval(ticker);
        if (titleEl) titleEl.textContent = okEvt ? doneTitle : failTitle;
        if (!okEvt && errMsg) appendLog('[error] ' + errMsg);
        return { ok: !!okEvt, event: okEvt, error: errMsg };
    }

    // ----- status -----
    async function checkHealth() {
        if (!ADMIN_TOKEN) {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'no access token';
            statusText.title = 'Open this page via the URL printed in your terminal (the one with ?t=...).';
            return;
        }
        try {
            const r = await apiFetch('/api/health');
            if (r.status === 401) { statusDot.className = 'status-dot offline'; statusText.textContent = 'token rejected -- restart the launcher'; return; }
            const data = await r.json();
            if (data.notionConfigured) {
                statusDot.className = 'status-dot online';
                statusText.textContent = 'connected, Notion ready';
            } else {
                statusDot.className = 'status-dot warning';
                statusText.textContent = 'connected, Notion not configured';
                writeNotion.checked = false;
                writeNotion.disabled = true;
                writeNotion.parentElement.title = 'Add NOTION_TOKEN to .env to enable Notion mirroring.';
                const sBtn = el('syncBtn');
                if (sBtn) { sBtn.disabled = true; sBtn.title = 'Notion not configured.'; }
            }
        } catch (e) { statusDot.className = 'status-dot offline'; statusText.textContent = 'server offline'; }
    }
    checkHealth();

    // ----- auto-fill folder + key -----
    function pascalSnake(s) { return String(s).trim().replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).join('_'); }
    function jsKey(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    let userTouchedFolder = false;
    let userTouchedKey = false;
    folderName.addEventListener('input', () => { userTouchedFolder = true; });
    projectKey.addEventListener('input', () => { userTouchedKey = true; });
    projectName.addEventListener('input', () => {
        const v = projectName.value;
        if (!userTouchedFolder) folderName.value = pascalSnake(v);
        if (!userTouchedKey)    projectKey.value  = jsKey(v);
    });

    // ----- card meta -----
    function rebuildMeta() {
        if (cardMeta.dataset.touched === 'true') return;
        const m = material.value.trim();
        const p = printer.value.trim();
        const bullet = String.fromCharCode(0x2022);
        cardMeta.value = (m && p) ? (m + ' ' + bullet + ' ' + p) : (m || p);
    }
    cardMeta.addEventListener('input', () => { cardMeta.dataset.touched = 'true'; });
    material.addEventListener('input', rebuildMeta);
    printer.addEventListener('input', rebuildMeta);

    // ----- thumbnail preview -----
    thumbnail.addEventListener('change', () => {
        thumbPrev.innerHTML = '';
        const f = thumbnail.files && thumbnail.files[0];
        if (!f) return;
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        img.alt = f.name;
        img.title = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB)';
        thumbPrev.appendChild(img);
    });

    // ----- gallery preview accumulates -----
    let galleryFiles = [];
    function syncGalleryInput() { const dt = new DataTransfer(); for (const f of galleryFiles) dt.items.add(f); gallery.files = dt.files; }
    function renderGalleryPreview() {
        galleryPrev.innerHTML = '';
        galleryFiles.forEach((f, idx) => {
            const wrap = document.createElement('div'); wrap.className = 'preview-item';
            const img = document.createElement('img');
            img.src = URL.createObjectURL(f);
            img.alt = f.name;
            img.title = f.name + ' (' + (f.size / 1024).toFixed(0) + ' KB)';
            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'preview-remove';
            del.setAttribute('aria-label', 'Remove ' + f.name);
            del.title = 'Remove ' + f.name;
            del.textContent = 'x';
            del.addEventListener('click', () => { galleryFiles.splice(idx, 1); syncGalleryInput(); renderGalleryPreview(); });
            wrap.appendChild(img); wrap.appendChild(del); galleryPrev.appendChild(wrap);
        });
    }
    gallery.addEventListener('change', () => {
        const incoming = Array.from(gallery.files || []);
        for (const f of incoming) {
            const dup = galleryFiles.some(g => g.name === f.name && g.size === f.size);
            if (!dup) galleryFiles.push(f);
        }
        syncGalleryInput();
        renderGalleryPreview();
    });

    // ----- reset / start over -----
    function fullReset() {
        form.reset();
        thumbPrev.innerHTML = '';
        galleryFiles = [];
        syncGalleryInput();
        renderGalleryPreview();
        result.classList.add('hidden');
        result.innerHTML = '';
        userTouchedFolder = false;
        userTouchedKey = false;
        cardMeta.dataset.touched = 'false';
        // Hide sync result if open
        const sr = el('syncResult'); if (sr) { sr.style.display = 'none'; sr.innerHTML = ''; }
        const ss = el('syncStatus'); if (ss) { ss.style.display = 'none'; }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    resetBtn.addEventListener('click', fullReset);

    function showResult(opts) {
        result.className = 'result ' + (opts.type || '');
        result.innerHTML = opts.html;
        result.classList.remove('hidden');
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ----- Netlify watch (polls after a successful push) -----
    // Returns when the deploy reaches ready / error / unconfigured / timeout.
    async function watchNetlify(containerEl, pushedAt) {
        // Render initial panel
        containerEl.innerHTML =
            '<div class="netlify-panel state-waiting" id="nfPanel">' +
                '<div class="netlify-status-row">' +
                    '<span class="netlify-dot" aria-hidden="true"></span>' +
                    '<strong class="netlify-label">Pushed - waiting for Netlify to pick it up...</strong>' +
                    '<span class="netlify-elapsed" id="nfElapsed">0s</span>' +
                '</div>' +
                '<div class="netlify-actions" id="nfActions"></div>' +
            '</div>';
        const panel = el('nfPanel');
        const elapsedEl = el('nfElapsed');
        const actions = el('nfActions');
        const t0 = Date.now();
        const ticker = setInterval(() => { elapsedEl.textContent = Math.floor((Date.now() - t0) / 1000) + 's'; }, 250);

        function setState(state, label, extraHtml) {
            panel.className = 'netlify-panel state-' + state;
            panel.querySelector('.netlify-label').textContent = label;
            if (extraHtml != null) actions.innerHTML = extraHtml;
        }

        const TIMEOUT_MS = 12 * 60 * 1000; // 12 minutes
        let lastState = 'waiting';

        try {
            while (Date.now() - t0 < TIMEOUT_MS) {
                let data = null;
                try {
                    const r = await apiFetch('/api/netlify-status?since=' + pushedAt);
                    data = await r.json();
                } catch (e) { /* network blip — retry */ }

                if (data) {
                    if (data.state === 'unconfigured') {
                        clearInterval(ticker);
                        setState('unconfigured', 'Build tracking not configured', '<p class="netlify-hint">Add <code>NETLIFY_TOKEN</code> + <code>NETLIFY_SITE_ID</code> to <code>.env</code> for live status. Site is most likely rebuilding regardless.</p>' + startOverHtml());
                        wireStartOver();
                        return data;
                    }
                    if (data.state === 'ready') {
                        clearInterval(ticker);
                        const total = Math.floor((Date.now() - t0) / 1000);
                        const siteUrl = data.siteUrl || 'https://layerlama.com';
                        setState('ready', 'Live on the site (' + total + 's total)',
                            '<p class="netlify-hint">Netlify build complete. Refresh <a href="' + escapeHtml(siteUrl) + '" target="_blank">' + escapeHtml(siteUrl) + '</a> to see the changes.</p>' +
                            '<div class="row">' +
                                '<a href="' + escapeHtml(siteUrl) + '" target="_blank" class="btn btn-primary">Open layerlama.com</a>' +
                                (data.adminUrl ? '<a href="' + escapeHtml(data.adminUrl) + '" target="_blank" class="btn btn-ghost">Open Netlify dashboard</a>' : '') +
                            '</div>' +
                            startOverHtml());
                        wireStartOver();
                        return data;
                    }
                    if (data.state === 'error') {
                        clearInterval(ticker);
                        const msg = data.errorMessage || data.error || 'Build failed';
                        setState('error', 'Netlify build failed',
                            '<p class="netlify-hint" style="color:var(--red)">' + escapeHtml(msg) + '</p>' +
                            (data.deployLogUrl ? '<div class="row"><a href="' + escapeHtml(data.deployLogUrl) + '" target="_blank" class="btn btn-ghost">View Netlify logs</a></div>' : '') +
                            startOverHtml());
                        wireStartOver();
                        return data;
                    }
                    if (data.state === 'building' && lastState !== 'building') {
                        lastState = 'building';
                        setState('building', 'Netlify build in progress...', '<p class="netlify-hint">Compiling the site and uploading assets. This usually takes 30-90 seconds.</p>');
                    } else if (data.state === 'waiting' && lastState !== 'waiting') {
                        lastState = 'waiting';
                        setState('waiting', 'Pushed - waiting for Netlify to pick it up...', '');
                    }
                }
                await sleep(5000);
            }
            // timeout
            clearInterval(ticker);
            setState('error', 'Timed out watching Netlify',
                '<p class="netlify-hint">Build is taking longer than expected. Check Netlify directly.</p>' +
                startOverHtml());
            wireStartOver();
            return { state: 'timeout' };
        } catch (err) {
            clearInterval(ticker);
            setState('error', 'Lost connection to admin server', '<p class="netlify-hint">' + escapeHtml(err.message || String(err)) + '</p>' + startOverHtml());
            wireStartOver();
        }
    }
    function startOverHtml() {
        return '<div class="row" style="margin-top:0.85rem"><button type="button" id="nfStartOver" class="btn btn-primary">Start over</button></div>';
    }
    function wireStartOver() {
        const b = el('nfStartOver');
        if (b) b.addEventListener('click', fullReset);
    }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ----- submit (add a project) -----
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const cats = Array.from(document.querySelectorAll('input[name="categories"]:checked')).map(c => c.value);
        if (!cats.length) { showResult({ type: 'error', html: '<h3>Pick at least one category.</h3>' }); return; }
        const fd = new FormData(form);
        if (!fd.has('featured'))    fd.set('featured', 'false');
        if (!fd.has('published'))   fd.set('published', 'false');
        if (!fd.has('writeNotion')) fd.set('writeNotion', 'false');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span>Adding...';

        try {
            const r = await apiFetch('/api/create-project', { method: 'POST', body: fd });
            let data;
            try { data = await r.json(); }
            catch (jsonErr) {
                const txt = await r.text().catch(() => '');
                throw new Error('Server returned a non-JSON response (HTTP ' + r.status + '). First chars: ' + txt.slice(0, 200));
            }
            if (!data.ok) { showResult({ type: 'error', html: '<h3>' + escapeHtml(data.error || 'Something went wrong.') + '</h3>' }); return; }

            const project = data.project;
            const filesChanged = data.filesChanged || [];
            const notionUrl = data.notionUrl;
            const notionWarning = data.notionWarning;

            const filesList = filesChanged.map(f => '<li>' + escapeHtml(f) + '</li>').join('');
            const notionLine = notionUrl
                ? '<p><a href="' + escapeHtml(notionUrl) + '" target="_blank">Open Notion entry</a></p>'
                : (notionWarning ? '<p class="muted" style="color:var(--orange)">' + escapeHtml(notionWarning) + '</p>' : '');
            const pushPaths = ['Images/Portfolio/' + project.folderName, 'gallery.html'].concat(project.featured ? ['index.html'] : []);

            showResult({
                type: '',
                html:
                    '<h3>Added <strong>' + escapeHtml(project.projectName) + '</strong></h3>' +
                    '<p>Files changed in your repo:</p>' +
                    '<ul>' + filesList + '</ul>' +
                    notionLine +
                    '<div class="row">' +
                        '<button type="button" id="commitBtn" class="btn btn-primary">Commit and Push</button>' +
                        '<button type="button" id="newBtn" class="btn btn-ghost">Add another</button>' +
                    '</div>' +
                    '<div class="publish-status" id="publishStatus" style="display:none">' +
                        '<div class="publish-header"><strong id="publishTitle">Publishing...</strong><span class="publish-elapsed" id="publishElapsed">0s</span></div>' +
                        '<ol class="publish-steps">' +
                            '<li id="step-add"><span class="step-icon">o</span><span class="step-label">Staging files</span></li>' +
                            '<li id="step-commit"><span class="step-icon">o</span><span class="step-label">Creating commit</span></li>' +
                            '<li id="step-push"><span class="step-icon">o</span><span class="step-label">Pushing to remote</span></li>' +
                        '</ol>' +
                        '<details class="publish-log"><summary>Show git output</summary><pre id="publishLog"></pre></details>' +
                    '</div>' +
                    '<div id="netlifyContainer"></div>'
            });

            const commitBtn = el('commitBtn');
            const newBtn    = el('newBtn');
            commitBtn.addEventListener('click', () => publish(project.projectName, pushPaths, commitBtn));
            newBtn.addEventListener('click', fullReset);
        } catch (err) {
            showResult({ type: 'error', html: '<h3>Network error</h3><pre>' + escapeHtml(err.message || String(err)) + '</pre>' });
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Project';
        }
    });

    // ----- publish -----
    async function publish(projectNameStr, paths, btn) {
        const result = await runStreamingJob({
            url: '/api/git-push',
            body: { message: 'Add portfolio: ' + projectNameStr, paths: paths },
            btn: btn,
            btnSpinnerLabel: 'Publishing...',
            panel: el('publishStatus'),
            titleEl: el('publishTitle'),
            elapsedEl: el('publishElapsed'),
            logEl: el('publishLog'),
            stepEls: { add: el('step-add'), commit: el('step-commit'), push: el('step-push') },
            runningTitle: 'Publishing to GitHub...',
            doneTitle: 'Pushed to GitHub',
            failTitle: 'Publish failed'
        });
        btn.classList.remove('btn-primary');
        btn.classList.add('btn-ghost');
        if (result.ok) {
            btn.innerHTML = 'Pushed to GitHub';
            const pushedAt = Date.now();
            const container = el('netlifyContainer');
            if (container) await watchNetlify(container, pushedAt);
        } else {
            btn.disabled = false;
            btn.innerHTML = 'Retry push';
        }
    }

    // ----- sync from Notion -----
    const syncBtn = el('syncBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (!confirm('This will rewrite the portfolio sections of gallery.html and index.html using your Notion database. Local hand-edits to those sections will be replaced.\n\nContinue?')) return;
            const panel    = el('syncStatus');
            const titleEl  = el('syncTitle');
            const elapsedEl= el('syncElapsed');
            const logEl    = el('syncLog');
            const resultEl = el('syncResult');
            resultEl.style.display = 'none';
            resultEl.innerHTML = '';
            const r = await runStreamingJob({
                url: '/api/sync-from-notion', body: {},
                btn: syncBtn, btnSpinnerLabel: 'Syncing...',
                panel: panel, titleEl: titleEl, elapsedEl: elapsedEl, logEl: logEl,
                stepEls: { read: el('sync-step-read'), gallery: el('sync-step-gallery'), index: el('sync-step-index') },
                runningTitle: 'Syncing from Notion...', doneTitle: 'Synced', failTitle: 'Sync failed'
            });
            syncBtn.disabled = false;
            syncBtn.innerHTML = 'Sync from Notion';
            if (r.ok) {
                const evt = r.event || {};
                const names = (evt.projectNames || []).map(n => '<li>' + escapeHtml(n) + '</li>').join('');
                resultEl.style.display = '';
                resultEl.innerHTML =
                    '<p>' + escapeHtml(evt.message || ('Synced ' + (evt.total || '?') + ' projects.')) + '</p>' +
                    (names ? '<details><summary>' + (evt.total || '?') + ' projects</summary><ul style="margin-top:0.5rem">' + names + '</ul></details>' : '') +
                    '<div class="row" style="margin-top:1rem">' +
                        '<button type="button" id="syncCommitBtn" class="btn btn-primary">Commit and Push</button>' +
                    '</div>' +
                    '<pre id="syncCommitLog" style="display:none"></pre>' +
                    '<div id="syncNetlifyContainer"></div>';
                el('syncCommitBtn').addEventListener('click', () => syncCommitPush(el('syncCommitBtn'), el('syncCommitLog')));
            } else {
                resultEl.style.display = '';
                resultEl.innerHTML = '<p style="color:var(--red)"><strong>' + escapeHtml(r.error || 'Sync failed') + '</strong></p>';
            }
        });
    }

    async function syncCommitPush(btn, logEl) {
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>Pushing...';
        logEl.style.display = 'block';
        logEl.textContent = '';
        let pushedOK = false;
        try {
            const r = await apiFetch('/api/git-push', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: 'Sync portfolio from Notion', paths: ['gallery.html', 'index.html'] })
            });
            if (!r.ok) { let msg = 'HTTP ' + r.status; try { msg = (await r.json()).error || msg; } catch (e) {} throw new Error(msg); }
            const reader = r.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const events = buf.split('\n\n');
                buf = events.pop();
                for (const block of events) {
                    for (const line of block.split('\n')) {
                        if (!line.startsWith('data: ')) continue;
                        let evt; try { evt = JSON.parse(line.slice(6)); } catch (e) { continue; }
                        if (evt.text)   logEl.textContent += '  ' + evt.text + '\n';
                        if (evt.output) logEl.textContent += evt.output + '\n';
                        if (!evt.step && evt.status === 'complete') pushedOK = true;
                    }
                }
            }
            btn.classList.remove('btn-primary');
            btn.classList.add('btn-ghost');
            btn.innerHTML = pushedOK ? 'Pushed to GitHub' : 'Push failed (see log)';
            if (pushedOK) {
                const pushedAt = Date.now();
                const container = el('syncNetlifyContainer');
                if (container) await watchNetlify(container, pushedAt);
            }
        } catch (err) {
            logEl.textContent += '[network] ' + (err.message || String(err)) + '\n';
            btn.disabled = false;
            btn.innerHTML = 'Retry push';
        }
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
})();
