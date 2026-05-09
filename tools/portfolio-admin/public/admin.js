// Layer Lama -- Portfolio Admin frontend
// Talks to the local Express server at the same origin.

(() => {
    'use strict';

    // ----- theme toggle (uses the same ll-theme localStorage key as the public site) -----
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

    // ----- status -----
    async function checkHealth() {
        try {
            const r = await fetch('/api/health').then(x => x.json());
            if (r.notionConfigured) {
                statusDot.className = 'status-dot online';
                statusText.textContent = 'connected, Notion ready';
            } else {
                statusDot.className = 'status-dot warning';
                statusText.textContent = 'connected, Notion not configured';
                writeNotion.checked = false;
                writeNotion.disabled = true;
                writeNotion.parentElement.title = 'Add NOTION_TOKEN to .env to enable Notion mirroring.';
            }
        } catch {
            statusDot.className = 'status-dot offline';
            statusText.textContent = 'server offline';
        }
    }
    checkHealth();

    // ----- auto-fill folder + key from project name -----
    function pascalSnake(s) {
        return String(s).trim().replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).join('_');
    }
    function jsKey(s) {
        return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    let userTouchedFolder = false;
    let userTouchedKey = false;
    folderName.addEventListener('input', () => { userTouchedFolder = true; });
    projectKey.addEventListener('input', () => { userTouchedKey = true; });
    projectName.addEventListener('input', () => {
        const v = projectName.value;
        if (!userTouchedFolder) folderName.value = pascalSnake(v);
        if (!userTouchedKey)    projectKey.value  = jsKey(v);
    });

    // ----- card meta auto-build -----
    function rebuildMeta() {
        if (cardMeta.dataset.touched === 'true') return;
        const m = material.value.trim();
        const p = printer.value.trim();
        const bullet = String.fromCharCode(0x2022); // U+2022 BULLET
        cardMeta.value = (m && p) ? (m + ' ' + bullet + ' ' + p) : (m || p);
    }
    cardMeta.addEventListener('input', () => { cardMeta.dataset.touched = 'true'; });
    material.addEventListener('input', rebuildMeta);
    printer.addEventListener('input', rebuildMeta);

    // ----- thumbnail preview (single, replace on change) -----
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

    // ----- gallery preview (accumulates, with per-image remove) -----
    // Track our own File[] list. The native <input type="file" multiple>
    // replaces its FileList every time the user picks files, so we keep our
    // own array and sync it back to the input via DataTransfer.
    let galleryFiles = [];

    function syncGalleryInput() {
        const dt = new DataTransfer();
        for (const f of galleryFiles) dt.items.add(f);
        gallery.files = dt.files;
    }
    function renderGalleryPreview() {
        galleryPrev.innerHTML = '';
        galleryFiles.forEach((f, idx) => {
            const wrap = document.createElement('div');
            wrap.className = 'preview-item';
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
            del.addEventListener('click', () => {
                galleryFiles.splice(idx, 1);
                syncGalleryInput();
                renderGalleryPreview();
            });
            wrap.appendChild(img);
            wrap.appendChild(del);
            galleryPrev.appendChild(wrap);
        });
    }
    gallery.addEventListener('change', () => {
        const incoming = Array.from(gallery.files || []);
        // Skip duplicates by name+size (cheap dedup)
        for (const f of incoming) {
            const dup = galleryFiles.some(g => g.name === f.name && g.size === f.size);
            if (!dup) galleryFiles.push(f);
        }
        syncGalleryInput();
        renderGalleryPreview();
    });

    // ----- reset -----
    resetBtn.addEventListener('click', () => {
        form.reset();
        thumbPrev.innerHTML = '';
        galleryFiles = [];
        syncGalleryInput();
        renderGalleryPreview();
        result.classList.add('hidden');
        userTouchedFolder = false;
        userTouchedKey = false;
        cardMeta.dataset.touched = 'false';
    });

    // ----- result rendering -----
    function showResult(opts) {
        result.className = 'result ' + (opts.type || '');
        result.innerHTML = opts.html;
        result.classList.remove('hidden');
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ----- submit -----
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const cats = Array.from(document.querySelectorAll('input[name="categories"]:checked')).map(c => c.value);
        if (!cats.length) {
            showResult({ type: 'error', html: '<h3>Pick at least one category.</h3>' });
            return;
        }

        const fd = new FormData(form);
        if (!fd.has('featured'))    fd.set('featured', 'false');
        if (!fd.has('published'))   fd.set('published', 'false');
        if (!fd.has('writeNotion')) fd.set('writeNotion', 'false');

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span>Adding...';

        try {
            const r = await fetch('/api/create-project', { method: 'POST', body: fd });
            let data;
            try { data = await r.json(); }
            catch (jsonErr) {
                const txt = await r.text().catch(() => '');
                throw new Error('Server returned a non-JSON response (HTTP ' + r.status + '). First chars: ' + txt.slice(0, 200));
            }

            if (!data.ok) {
                showResult({ type: 'error', html: '<h3>' + escapeHtml(data.error || 'Something went wrong.') + '</h3>' });
                return;
            }

            const project = data.project;
            const filesChanged = data.filesChanged || [];
            const notionUrl = data.notionUrl;
            const notionWarning = data.notionWarning;

            const filesList = filesChanged.map(f => '<li>' + escapeHtml(f) + '</li>').join('');
            const notionLine = notionUrl
                ? '<p><a href="' + escapeHtml(notionUrl) + '" target="_blank">Open Notion entry</a></p>'
                : (notionWarning ? '<p class="muted" style="color:var(--orange)">' + escapeHtml(notionWarning) + '</p>' : '');

            const pushPaths = [
                'Images/Portfolio/' + project.folderName,
                'gallery.html'
            ].concat(project.featured ? ['index.html'] : []);

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
                    '<pre id="gitOut" style="display:none"></pre>'
            });

            const commitBtn = el('commitBtn');
            const newBtn    = el('newBtn');
            const gitOut    = el('gitOut');

            commitBtn.addEventListener('click', async () => {
                commitBtn.disabled = true;
                commitBtn.innerHTML = '<span class="spinner"></span>Pushing...';
                try {
                    const r2 = await fetch('/api/git-push', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            message: 'Add portfolio: ' + project.projectName,
                            paths: pushPaths
                        })
                    });
                    const data2 = await r2.json();
                    gitOut.style.display = 'block';
                    gitOut.textContent = (data2.log || []).map(s =>
                        '-- ' + s.step + ' (exit ' + s.code + ') --\n' + (s.stdout || '') + (s.stderr ? '\n[stderr]\n' + s.stderr : '')
                    ).join('\n\n');
                    if (data2.ok) {
                        commitBtn.innerHTML = 'Pushed - Netlify is rebuilding';
                    } else {
                        commitBtn.innerHTML = 'Push failed (see log)';
                        commitBtn.classList.remove('btn-primary');
                        commitBtn.classList.add('btn-ghost');
                    }
                } catch (err) {
                    gitOut.style.display = 'block';
                    gitOut.textContent = 'Network error: ' + (err.message || err);
                    commitBtn.innerHTML = 'Push failed';
                }
            });

            newBtn.addEventListener('click', () => resetBtn.click());

        } catch (err) {
            showResult({ type: 'error', html: '<h3>Network error</h3><pre>' + escapeHtml(err.message || String(err)) + '</pre>' });
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Project';
        }
    });

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
})();
