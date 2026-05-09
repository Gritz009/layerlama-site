// Layer Lama -- Portfolio Admin (local-only)
//
// Security model:
//   * Bound to 127.0.0.1 only (loopback) -- never reachable from the LAN.
//   * Per-startup random ADMIN_TOKEN. Frontend reads it from ?t=... in the URL
//     that the launcher auto-opens, persists to sessionStorage, sends on every
//     /api/* call as X-Admin-Token. Other tabs/processes don't have it.
//   * Middleware validates Host header (DNS rebinding defense) and Origin
//     header on POST (CSRF defense).
//   * Node HTTP server timeouts disabled so long git pushes don't drop.
//   * SSE keep-alive heartbeat every 15s so proxies/firewalls don't drop the
//     connection during a long push.
//
// NEVER deploy. Local-only. Reads secrets from .env.

'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile, exec, spawn } = require('child_process');
const { Client: NotionClient } = require('@notionhq/client');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORTFOLIO_IMG_ROOT = path.join(ROOT, 'Images', 'Portfolio');
const GALLERY_HTML = path.join(ROOT, 'gallery.html');
const INDEX_HTML = path.join(ROOT, 'index.html');

const HTML_MARKER = 'LL_PORTFOLIO_INSERT_HTML';
const JS_MARKER = 'LL_PORTFOLIO_INSERT_JS';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '127.0.0.1';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DB_ID = process.env.NOTION_PORTFOLIO_DB_ID || 'e3709cae-61b5-41e0-820d-507d5c63c304';
const notion = NOTION_TOKEN ? new NotionClient({ auth: NOTION_TOKEN }) : null;

// Per-startup admin token. Random 32-char hex (128 bits).
const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');

// ----- helpers -----
const MIDDLE_DOT = ' ' + String.fromCharCode(0xB7) + ' ';
const BULLET = ' ' + String.fromCharCode(0x2022) + ' ';

function safeFolderName(s) { return String(s || '').trim().replace(/[^A-Za-z0-9_\-]/g, '_').replace(/_+/g, '_'); }
function safeJsKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function htmlEscape(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function jsString(s) {
    return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, ' ') + "'";
}
function categoryTagInfo(categories) {
    const set = new Set(categories);
    if (set.has('Artistic') && set.has('Functional')) return { i18n: 'tag.artistic_functional', text: 'Artistic' + MIDDLE_DOT + 'Functional' };
    if (set.has('Artistic') && set.has('Miniatures')) return { i18n: 'tag.artistic_miniatures', text: 'Artistic' + MIDDLE_DOT + 'Miniatures' };
    if (set.has('Prototypes')) return { i18n: 'tag.prototyping', text: 'Prototyping' };
    if (set.has('Functional')) return { i18n: 'tag.functional', text: 'Functional' };
    if (set.has('Artistic')) return { i18n: 'tag.artistic', text: 'Artistic' };
    if (set.has('Miniatures')) return { i18n: 'tag.artistic_miniatures', text: 'Miniatures' };
    if (set.has('Educational')) return { i18n: 'tag.educational', text: 'Educational' };
    return { i18n: 'tag.functional', text: 'Functional' };
}
function primaryCategoryLower(categories) {
    const order = ['Functional', 'Artistic', 'Miniatures', 'Prototypes', 'Educational'];
    for (const c of order) if (categories.includes(c)) return c.toLowerCase();
    return 'functional';
}

// ----- multer staging -----
const STAGING = path.join(__dirname, '.staging');
fs.mkdirSync(STAGING, { recursive: true });
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, STAGING),
        filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + file.originalname.replace(/[^A-Za-z0-9._-]/g, '_'))
    }),
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ----- builders (HTML cards + JS lightbox entries) -----
function buildGalleryCardHtml(p) {
    const { i18n, text } = categoryTagInfo(p.categories);
    const cat = primaryCategoryLower(p.categories);
    const designerLink = p.designerUrl
        ? '<a href="' + htmlEscape(p.designerUrl) + '" target="_blank">' + htmlEscape(p.designer || 'Designer') + '</a>'
        : htmlEscape(p.designer || 'Layerlama');
    return [
        '            <div class="gallery-card" data-category="' + htmlEscape(cat) + '" onclick="openLightbox(\'' + htmlEscape(p.projectKey) + '\')">',
        '                <div class="card-image">',
        '                    <span class="card-tag" data-i18n="' + htmlEscape(i18n) + '">' + htmlEscape(text) + '</span>',
        '                    <img src="Images/Portfolio/' + htmlEscape(p.folderName) + '/' + htmlEscape(p.thumbnailFile) + '" alt="' + htmlEscape(p.projectName) + '">',
        '                </div>',
        '                <div class="card-body">',
        '                    <div class="card-title">' + htmlEscape(p.projectName) + '</div>',
        '                    <div class="card-meta">' + htmlEscape(p.cardMeta) + '</div>',
        '                    <div class="card-credit">Design by ' + designerLink + ' via MakerWorld</div>',
        '                </div>',
        '            </div>'
    ].join('\n');
}
function buildIndexCardHtml(p) {
    const { i18n, text } = categoryTagInfo(p.categories);
    const cat = primaryCategoryLower(p.categories);
    const designerLink = p.designerUrl
        ? '<a href="' + htmlEscape(p.designerUrl) + '" target="_blank">' + htmlEscape(p.designer || 'Designer') + '</a>'
        : htmlEscape(p.designer || 'Layerlama');
    return [
        '            <!-- ' + htmlEscape(p.projectName) + ' -->',
        '            <div class="gallery-card extra-8 reveal" data-category="' + htmlEscape(cat) + '" onclick="openLightbox(\'' + htmlEscape(p.projectKey) + '\')">',
        '                <div class="card-image">',
        '                    <span class="card-tag" data-i18n="' + htmlEscape(i18n) + '">' + htmlEscape(text) + '</span>',
        '                    <img src="Images/Portfolio/' + htmlEscape(p.folderName) + '/' + htmlEscape(p.thumbnailFile) + '" alt="' + htmlEscape(p.projectName) + '" style="width:100%;height:100%;object-fit:cover;position:relative;z-index:1;">',
        '                </div>',
        '                <div class="card-body">',
        '                    <div class="card-title">' + htmlEscape(p.projectName) + '</div>',
        '                    <div class="card-meta"><span>' + htmlEscape(p.cardMeta) + '</span></div>',
        '                    <div class="card-credit">Design by ' + designerLink + ' via MakerWorld</div>',
        '                </div>',
        '            </div>'
    ].join('\n');
}
function buildGalleryJsEntry(p) {
    const credit = 'Design by ' + (p.designer || 'Layerlama') + ' via MakerWorld';
    const imgs = p.galleryImages.map(jsString).join(',');
    return '            ' + p.projectKey + ': { title: ' + jsString(p.projectName) + ', credit: ' + jsString(credit) + ', images: [' + imgs + '] }';
}
function buildIndexJsEntry(p) {
    const credit = 'Design by ' + (p.designer || 'Layerlama') + ' via MakerWorld';
    const imgs = p.galleryImages.map(jsString).join(',');
    return [
        '            ' + p.projectKey + ': {',
        '                title: ' + jsString(p.projectName) + ',',
        '                credit: ' + jsString(credit) + ',',
        '                images: [' + imgs + ']',
        '            }'
    ].join('\n');
}
function injectAtMarker(content, marker, snippet, kind) {
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.includes(marker));
    if (idx < 0) throw new Error('Marker ' + marker + ' not found -- site files may be out of sync with the admin tool.');
    if (kind === 'js') {
        let prev = idx - 1;
        while (prev >= 0 && lines[prev].trim() === '') prev--;
        if (prev >= 0 && /}\s*$/.test(lines[prev])) {
            lines[prev] = lines[prev].replace(/}\s*$/, '},');
        }
    }
    lines.splice(idx, 0, snippet);
    return lines.join('\n');
}

// ----- site logo -----
const _logoCache = { dark: null, light: null };
function getSiteLogo(variant) {
    const v = variant === 'light' ? 'light' : 'dark';
    if (_logoCache[v]) return _logoCache[v];
    try {
        const html = fs.readFileSync(INDEX_HTML, 'utf8');
        const className = v === 'light' ? 'logo-light' : 'logo-dark';
        const re = new RegExp('<img[^>]*\\bclass="' + className + '"[^>]*>');
        const tag = html.match(re);
        if (tag) {
            const src = tag[0].match(/src="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
            if (src) { _logoCache[v] = Buffer.from(src[1], 'base64'); return _logoCache[v]; }
        }
    } catch (e) { /* ignore */ }
    return null;
}

// ----- security middleware -----
// Allowed Host headers. Reject anything else (DNS rebinding defense).
const ALLOWED_HOSTS = new Set([
    'localhost:' + PORT,
    '127.0.0.1:' + PORT,
    '[::1]:' + PORT
]);
const ALLOWED_ORIGINS = new Set([
    'http://localhost:' + PORT,
    'http://127.0.0.1:' + PORT,
    'http://[::1]:' + PORT
]);

function validateHost(req, res, next) {
    const host = (req.headers.host || '').toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
        return res.status(403).json({ ok: false, error: 'Forbidden host: ' + host });
    }
    next();
}

function validateOrigin(req, res, next) {
    // POST/PUT/DELETE require an Origin or Referer that matches us. GET is fine
    // without (browser doesn't always send Origin on GET).
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';
    if (origin) {
        if (!ALLOWED_ORIGINS.has(origin.toLowerCase())) {
            return res.status(403).json({ ok: false, error: 'Forbidden origin: ' + origin });
        }
    } else if (referer) {
        const ok = Array.from(ALLOWED_ORIGINS).some(o => referer.toLowerCase().startsWith(o + '/') || referer.toLowerCase() === o);
        if (!ok) return res.status(403).json({ ok: false, error: 'Forbidden referer.' });
    } else {
        return res.status(403).json({ ok: false, error: 'Origin header missing on state-changing request.' });
    }
    next();
}

function requireToken(req, res, next) {
    const headerTok = req.headers['x-admin-token'];
    const queryTok = req.query.t;
    const presented = headerTok || queryTok || '';
    // Constant-time compare
    if (presented.length !== ADMIN_TOKEN.length ||
        !crypto.timingSafeEqual(Buffer.from(presented), Buffer.from(ADMIN_TOKEN))) {
        return res.status(401).json({ ok: false, error: 'Bad or missing access token. Open the URL printed in your terminal.' });
    }
    next();
}

// ----- app -----
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(validateHost);

// Static files (admin form HTML/CSS/JS) -- no token required because the
// page itself is just static markup; it can't do anything without an API call.
app.use(express.static(PUBLIC_DIR));

// Site logo route -- no token required (image only, read from project root).
app.get('/site-logo', (req, res) => {
    const buf = getSiteLogo(req.query.theme);
    if (buf) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buf);
    }
    for (const fallback of ['icon-192.png', 'icon-512.png', 'favicon-32.png']) {
        const p = path.join(ROOT, fallback);
        if (fs.existsSync(p)) return res.sendFile(p);
    }
    res.status(404).end();
});

// All /api/* routes require origin + token.
app.use('/api', validateOrigin, requireToken);

app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        notionConfigured: Boolean(NOTION_TOKEN),
        notionDbId: NOTION_DB_ID,
        portfolioRoot: PORTFOLIO_IMG_ROOT,
        gallery: GALLERY_HTML,
        index: INDEX_HTML
    });
});

app.post('/api/create-project', upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'gallery', maxCount: 30 }
]), async (req, res) => {
    const stagedFiles = [];
    if (req.files && req.files.thumbnail) stagedFiles.push.apply(stagedFiles, req.files.thumbnail);
    if (req.files && req.files.gallery) stagedFiles.push.apply(stagedFiles, req.files.gallery);
    function cleanupStaging() {
        for (const f of stagedFiles) { try { fs.unlinkSync(f.path); } catch (e) {} }
    }
    try {
        const b = req.body || {};
        const projectName = String(b.projectName || '').trim();
        const folderName  = safeFolderName(b.folderName || projectName);
        const projectKey  = safeJsKey(b.projectKey || projectName);
        const categories  = Array.isArray(b.categories) ? b.categories : (b.categories ? [b.categories] : []);
        const designer    = String(b.designer || '').trim();
        const designerUrl = String(b.designerUrl || '').trim();
        const material    = String(b.material || '').trim();
        const printer     = String(b.printer || '').trim();
        const cardMeta    = String(b.cardMeta || (material && printer ? (material + BULLET + printer) : (material || printer))).trim();
        const displayOrder = Number(b.displayOrder || 100);
        const featured    = String(b.featured || 'false') === 'true';
        const published   = String(b.published || 'true') === 'true';
        const writeNotion = String(b.writeNotion || 'true') === 'true';

        if (!projectName) throw new Error('Project Name is required.');
        if (!folderName)  throw new Error('Folder Name is required.');
        if (!projectKey)  throw new Error('Project Key is required.');
        if (!categories.length) throw new Error('Pick at least one category.');
        if (!(req.files && req.files.thumbnail && req.files.thumbnail[0])) throw new Error('Thumbnail image is required.');
        if (!(req.files && req.files.gallery && req.files.gallery.length)) throw new Error('At least one gallery image is required.');

        const targetDir = path.join(PORTFOLIO_IMG_ROOT, folderName);
        if (fs.existsSync(targetDir)) throw new Error('Folder Images/Portfolio/' + folderName + ' already exists. Pick a different folder name.');
        fs.mkdirSync(targetDir, { recursive: true });

        const thumbFile = req.files.thumbnail[0];
        const thumbExt = path.extname(thumbFile.originalname).toLowerCase() || '.png';
        const thumbName = 'Thumbnail' + thumbExt;
        fs.renameSync(thumbFile.path, path.join(targetDir, thumbName));

        const galleryFiles = req.files.gallery;
        const galleryNames = [];
        galleryFiles.forEach(function (f, i) {
            const ext = path.extname(f.originalname).toLowerCase() || '.png';
            const name = (i + 1) + ext;
            fs.renameSync(f.path, path.join(targetDir, name));
            galleryNames.push(name);
        });
        const galleryImagePaths = ['Images/Portfolio/' + folderName + '/' + thumbName].concat(galleryNames.map(function (n) { return 'Images/Portfolio/' + folderName + '/' + n; }));

        const project = {
            projectName, folderName, projectKey, categories,
            designer, designerUrl, material, printer, cardMeta,
            displayOrder, featured, published,
            thumbnailFile: thumbName,
            galleryImages: galleryImagePaths
        };

        let galleryContent = fs.readFileSync(GALLERY_HTML, 'utf8');
        galleryContent = injectAtMarker(galleryContent, HTML_MARKER, buildGalleryCardHtml(project), 'html');
        galleryContent = injectAtMarker(galleryContent, JS_MARKER, buildGalleryJsEntry(project) + ',', 'js');
        fs.writeFileSync(GALLERY_HTML, galleryContent, 'utf8');

        const filesChanged = ['Images/Portfolio/' + folderName, 'gallery.html'];
        if (featured) {
            let indexContent = fs.readFileSync(INDEX_HTML, 'utf8');
            indexContent = injectAtMarker(indexContent, HTML_MARKER, buildIndexCardHtml(project), 'html');
            indexContent = injectAtMarker(indexContent, JS_MARKER, buildIndexJsEntry(project) + ',', 'js');
            fs.writeFileSync(INDEX_HTML, indexContent, 'utf8');
            filesChanged.push('index.html');
        }

        let notionUrl = null, notionWarning = null;
        if (writeNotion) {
            if (!notion) {
                notionWarning = 'Notion not configured -- set NOTION_TOKEN in .env to mirror to the Portfolio Projects DB.';
            } else {
                try {
                    const resp = await notion.pages.create({
                        parent: { database_id: NOTION_DB_ID },
                        properties: {
                            'Project Name': { title: [{ text: { content: projectName } }] },
                            'Category':     { multi_select: categories.map(function (n) { return { name: n }; }) },
                            'Designer':     designer ? { rich_text: [{ text: { content: designer } }] } : { rich_text: [] },
                            'Designer URL': designerUrl ? { url: designerUrl } : { url: null },
                            'Material':     material ? { rich_text: [{ text: { content: material } }] } : { rich_text: [] },
                            'Printer':      printer  ? { rich_text: [{ text: { content: printer  } }] } : { rich_text: [] },
                            'Display Order':{ number: displayOrder },
                            'Featured':     { checkbox: featured },
                            'Published':    { checkbox: published },
                            'Image URLs':   { rich_text: [{ text: { content: galleryImagePaths.join(', ') } }] },
                            'Thumbnail URL':{ url: '/' + galleryImagePaths[0] }
                        }
                    });
                    notionUrl = resp.url || null;
                } catch (err) {
                    console.error('[notion]', err);
                    notionWarning = 'Notion write failed: ' + (err.message || err);
                }
            }
        }

        res.json({ ok: true, project, filesChanged, notionUrl, notionWarning });
    } catch (err) {
        console.error('[create-project]', err);
        cleanupStaging();
        res.status(400).json({ ok: false, error: err.message || String(err) });
    }
});

// ----- streaming git push -----
// Server-Sent Events: each event is one line of git progress.
// Disables socket timeout so a 10-minute push doesn't drop.
function spawnGitStreamed(args, onLine) {
    return new Promise(function (resolve) {
        const proc = spawn('git', args, { cwd: ROOT, windowsHide: true });
        const lines = [];
        function consume(buf) {
            const text = buf.toString();
            for (const part of text.split(/\r?\n/)) {
                if (part === '') continue;
                lines.push(part);
                try { onLine(part); } catch (e) {}
            }
        }
        proc.stdout.on('data', consume);
        proc.stderr.on('data', consume);
        proc.on('error', (err) => resolve({ ok: false, code: -1, output: lines.join('\n') + '\n[spawn error] ' + err.message }));
        proc.on('close', (code) => resolve({ ok: code === 0, code, output: lines.join('\n') }));
    });
}

app.post('/api/git-push', async (req, res) => {
    // SSE setup
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    if (req.socket) {
        req.socket.setTimeout(0);
        req.socket.setKeepAlive(true);
        req.socket.setNoDelay(true);
    }

    function emit(obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
    const heartbeat = setInterval(function () { res.write(': ping\n\n'); }, 15000);

    function endResponse() {
        clearInterval(heartbeat);
        try { res.end(); } catch (e) {}
    }

    try {
        const message = String((req.body && req.body.message) || '').trim() || 'Add new portfolio project';
        const paths = Array.isArray(req.body && req.body.paths) ? req.body.paths : [];
        const safePaths = paths.filter(function (p) {
            return typeof p === 'string'
                && !p.includes('..')
                && (p === 'gallery.html' || p === 'index.html' || p.startsWith('Images/Portfolio/'));
        });
        if (!safePaths.length) {
            emit({ status: 'error', message: 'No safe paths to commit.' });
            return endResponse();
        }

        emit({ status: 'started', paths: safePaths, message });

        // 1. git add
        emit({ step: 'add', status: 'running', label: 'Staging files' });
        const add = await spawnGitStreamed(['add', '--'].concat(safePaths), function (line) {
            emit({ step: 'add', status: 'progress', text: line });
        });
        if (!add.ok) {
            emit({ step: 'add', status: 'error', code: add.code, output: add.output });
            return endResponse();
        }
        emit({ step: 'add', status: 'done' });

        // 2. git commit
        emit({ step: 'commit', status: 'running', label: 'Creating commit' });
        const commit = await spawnGitStreamed(['commit', '-m', message], function (line) {
            emit({ step: 'commit', status: 'progress', text: line });
        });
        const nothingToCommit = /nothing to commit|nothing added to commit/i.test(commit.output);
        if (!commit.ok && !nothingToCommit) {
            emit({ step: 'commit', status: 'error', code: commit.code, output: commit.output });
            return endResponse();
        }
        emit({ step: 'commit', status: 'done', skipped: nothingToCommit });

        // 3. git push (long step)
        emit({ step: 'push', status: 'running', label: 'Pushing to remote' });
        const push = await spawnGitStreamed(['push', '--progress'], function (line) {
            emit({ step: 'push', status: 'progress', text: line });
        });
        if (!push.ok) {
            emit({ step: 'push', status: 'error', code: push.code, output: push.output });
            return endResponse();
        }
        emit({ step: 'push', status: 'done' });

        emit({ status: 'complete', message: 'Pushed to remote. Netlify is now rebuilding.' });
    } catch (err) {
        console.error('[git-push]', err);
        emit({ status: 'error', message: err.message || String(err) });
    } finally {
        endResponse();
    }
});

// JSON error handler -- catches multer errors and any unhandled middleware
// error so the frontend sees JSON instead of Express's HTML 500 page.
app.use(function (err, req, res, next) {
    console.error('[server error]', err);
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, error: 'A file is too large. Per-file limit is 50 MB.' });
    }
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ ok: false, error: 'Unexpected file field: ' + err.field });
    }
    res.status(err && err.status ? err.status : 500).json({ ok: false, error: (err && err.message) || 'Server error' });
});

// ----- listen -----
const server = app.listen(PORT, HOST, function () {
    const url = 'http://localhost:' + PORT + '/?t=' + ADMIN_TOKEN;
    console.log('');
    console.log('  +----------------------------------------------------------+');
    console.log('  |  Layer Lama -- Portfolio Admin                           |');
    console.log('  |  bound to 127.0.0.1 only -- not reachable from LAN       |');
    console.log('  |                                                          |');
    console.log('  |  open this URL (token included):                         |');
    console.log('  |  ' + url.slice(0, 56).padEnd(56, ' ') + (url.length > 56 ? '+' : '|'));
    if (url.length > 56) console.log('  |  ' + url.slice(56).padEnd(56, ' ') + '|');
    console.log('  |                                                          |');
    console.log('  |  Notion: ' + (NOTION_TOKEN ? 'configured                                      ' : 'NOT configured -- set NOTION_TOKEN in .env      ') + '|');
    console.log('  |  Stop:   Ctrl+C                                          |');
    console.log('  +----------------------------------------------------------+');
    console.log('');

    if (process.env.NO_BROWSER === '1') return;
    setTimeout(function () {
        try {
            if (process.platform === 'win32')      exec('start "" "' + url + '"');
            else if (process.platform === 'darwin') exec('open "' + url + '"');
            else                                    exec('xdg-open "' + url + '"');
        } catch (e) {}
    }, 400);
});

// Disable Node HTTP server timeouts so long pushes don't drop.
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 0;
server.timeout = 0;
