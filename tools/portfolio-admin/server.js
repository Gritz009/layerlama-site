// Layer Lama -- Portfolio Admin (local-only)
//
// Security: bound to 127.0.0.1, per-startup ADMIN_TOKEN, host/origin/token
// middleware. NEVER deploy. Local-only. Reads secrets from .env.

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

const HTML_MARKER_END = 'LL_PORTFOLIO_INSERT_HTML';
const HTML_MARKER_START = 'LL_PORTFOLIO_INSERT_HTML_START';
const JS_MARKER_END = 'LL_PORTFOLIO_INSERT_JS';
const JS_MARKER_START = 'LL_PORTFOLIO_INSERT_JS_START';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = '127.0.0.1';
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DB_ID = process.env.NOTION_PORTFOLIO_DB_ID || 'e3709cae-61b5-41e0-820d-507d5c63c304';
const notion = NOTION_TOKEN ? new NotionClient({ auth: NOTION_TOKEN }) : null;

const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex');

// ----- helpers -----
const MIDDLE_DOT = ' ' + String.fromCharCode(0xB7) + ' ';
const BULLET = ' ' + String.fromCharCode(0x2022) + ' ';
const BULLET_HTML = ' &bull; ';

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

// ----- builders -----
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
    if (idx < 0) throw new Error('Marker ' + marker + ' not found.');
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
function replaceBetweenMarkers(content, startMarker, endMarker, replacement) {
    const lines = content.split('\n');
    const startIdx = lines.findIndex(l => l.includes(startMarker));
    if (startIdx < 0) throw new Error('Start marker ' + startMarker + ' not found.');
    // Search for endMarker AFTER the start, otherwise the start line itself
    // (which contains endMarker as a substring) wins.
    let endIdx = -1;
    for (let i = startIdx + 1; i < lines.length; i++) {
        if (lines[i].includes(endMarker)) { endIdx = i; break; }
    }
    if (endIdx < 0) throw new Error('End marker ' + endMarker + ' not found after start marker.');
    return [].concat(lines.slice(0, startIdx + 1), [replacement], lines.slice(endIdx)).join('\n');
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
    } catch (e) {}
    return null;
}

// ----- Notion helpers -----
async function listAllNotionProjects() {
    if (!notion) throw new Error('Notion not configured. Set NOTION_TOKEN in .env.');
    const all = [];
    let cursor = undefined;
    do {
        const resp = await notion.databases.query({
            database_id: NOTION_DB_ID,
            page_size: 100,
            start_cursor: cursor,
            sorts: [{ property: 'Display Order', direction: 'ascending' }]
        });
        all.push.apply(all, resp.results);
        cursor = resp.has_more ? resp.next_cursor : undefined;
    } while (cursor);
    return all;
}
function readRichText(prop) {
    if (!prop) return '';
    if (prop.rich_text) return prop.rich_text.map(function (t) { return t.plain_text || ''; }).join('');
    if (prop.title) return prop.title.map(function (t) { return t.plain_text || ''; }).join('');
    return '';
}
function notionPageToProject(page) {
    const props = page.properties || {};
    const projectName = readRichText(props['Project Name']);
    const cats = (props['Category'] && props['Category'].multi_select) ? props['Category'].multi_select.map(function (o) { return o.name; }) : [];
    const designer = readRichText(props['Designer']);
    const designerUrl = (props['Designer URL'] && props['Designer URL'].url) || '';
    const material = readRichText(props['Material']);
    const printer = readRichText(props['Printer']);
    const imageUrlsRaw = readRichText(props['Image URLs']);
    const thumbUrl = (props['Thumbnail URL'] && props['Thumbnail URL'].url) || '';
    const displayOrder = (props['Display Order'] && typeof props['Display Order'].number === 'number') ? props['Display Order'].number : 100;
    const featured = !!(props['Featured'] && props['Featured'].checkbox);
    const published = props['Published'] && typeof props['Published'].checkbox === 'boolean' ? props['Published'].checkbox : true;

    const galleryImages = imageUrlsRaw.split(/\s*,\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    const firstImage = galleryImages[0] || thumbUrl.replace(/^\//, '');
    const folderMatch = firstImage.match(/Images\/Portfolio\/([^/]+)\//);
    const folderName = folderMatch ? folderMatch[1] : safeFolderName(projectName);
    const projectKey = safeJsKey(projectName);

    let thumbnailFile = '';
    if (thumbUrl) {
        thumbnailFile = thumbUrl.split('/').pop() || '';
    }
    if (!thumbnailFile && firstImage) {
        thumbnailFile = firstImage.split('/').pop() || 'Thumbnail.png';
    }

    const cardMeta = (material && printer) ? (material + BULLET_HTML.trim().replace('&bull;', String.fromCharCode(0x2022)) + ' ' + printer) :
                     (material && printer ? (material + ' ' + String.fromCharCode(0x2022) + ' ' + printer) : (material || printer || ''));
    // Use plain bullet; HTML escaper will leave it intact in the resulting HTML
    const cardMetaClean = (material && printer) ? (material + ' ' + String.fromCharCode(0x2022) + ' ' + printer) : (material || printer || '');

    return {
        projectName: projectName,
        folderName: folderName,
        projectKey: projectKey,
        categories: cats,
        designer: designer,
        designerUrl: designerUrl,
        material: material,
        printer: printer,
        cardMeta: cardMetaClean,
        displayOrder: displayOrder,
        featured: featured,
        published: published,
        thumbnailFile: thumbnailFile || 'Thumbnail.png',
        galleryImages: galleryImages
    };
}

// ----- security middleware -----
const ALLOWED_HOSTS = new Set(['localhost:' + PORT, '127.0.0.1:' + PORT, '[::1]:' + PORT]);
const ALLOWED_ORIGINS = new Set(['http://localhost:' + PORT, 'http://127.0.0.1:' + PORT, 'http://[::1]:' + PORT]);

function validateHost(req, res, next) {
    const host = (req.headers.host || '').toLowerCase();
    if (!ALLOWED_HOSTS.has(host)) {
        return res.status(403).json({ ok: false, error: 'Forbidden host: ' + host });
    }
    next();
}
function validateOrigin(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';
    if (origin) {
        if (!ALLOWED_ORIGINS.has(origin.toLowerCase())) {
            return res.status(403).json({ ok: false, error: 'Forbidden origin: ' + origin });
        }
    } else if (referer) {
        const ok = Array.from(ALLOWED_ORIGINS).some(function (o) { return referer.toLowerCase().startsWith(o + '/') || referer.toLowerCase() === o; });
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
app.use(express.static(PUBLIC_DIR));

// Favicon: serve the same icons as the live site so the admin tab matches.
function siteAssetRoute(filename) {
    return function (req, res) {
        const p = path.join(ROOT, filename);
        if (fs.existsSync(p)) return res.sendFile(p);
        res.status(404).end();
    };
}
app.get('/favicon.ico', siteAssetRoute('favicon.ico'));
app.get('/favicon-16.png', siteAssetRoute('favicon-16.png'));
app.get('/favicon-32.png', siteAssetRoute('favicon-32.png'));
app.get('/apple-touch-icon.png', siteAssetRoute('icon-192.png'));

// Site logo
app.get('/site-logo', function (req, res) {
    const buf = getSiteLogo(req.query.theme);
    if (buf) {
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.send(buf);
    }
    for (const fb of ['icon-192.png', 'icon-512.png', 'favicon-32.png']) {
        const p = path.join(ROOT, fb);
        if (fs.existsSync(p)) return res.sendFile(p);
    }
    res.status(404).end();
});

// /api/* requires origin + token
app.use('/api', validateOrigin, requireToken);

app.get('/api/health', function (req, res) {
    res.json({
        ok: true,
        notionConfigured: Boolean(NOTION_TOKEN),
        notionDbId: NOTION_DB_ID,
        portfolioRoot: PORTFOLIO_IMG_ROOT,
        gallery: GALLERY_HTML,
        index: INDEX_HTML
    });
});

// ----- create project -----
app.post('/api/create-project', upload.fields([
    { name: 'thumbnail', maxCount: 1 },
    { name: 'gallery', maxCount: 30 }
]), async function (req, res) {
    const stagedFiles = [];
    if (req.files && req.files.thumbnail) stagedFiles.push.apply(stagedFiles, req.files.thumbnail);
    if (req.files && req.files.gallery) stagedFiles.push.apply(stagedFiles, req.files.gallery);
    function cleanupStaging() { for (const f of stagedFiles) { try { fs.unlinkSync(f.path); } catch (e) {} } }
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
        if (fs.existsSync(targetDir)) throw new Error('Folder Images/Portfolio/' + folderName + ' already exists.');
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
        galleryContent = injectAtMarker(galleryContent, HTML_MARKER_END, buildGalleryCardHtml(project), 'html');
        galleryContent = injectAtMarker(galleryContent, JS_MARKER_END, buildGalleryJsEntry(project) + ',', 'js');
        fs.writeFileSync(GALLERY_HTML, galleryContent, 'utf8');

        const filesChanged = ['Images/Portfolio/' + folderName, 'gallery.html'];
        if (featured) {
            let indexContent = fs.readFileSync(INDEX_HTML, 'utf8');
            indexContent = injectAtMarker(indexContent, HTML_MARKER_END, buildIndexCardHtml(project), 'html');
            indexContent = injectAtMarker(indexContent, JS_MARKER_END, buildIndexJsEntry(project) + ',', 'js');
            fs.writeFileSync(INDEX_HTML, indexContent, 'utf8');
            filesChanged.push('index.html');
        }

        let notionUrl = null, notionWarning = null;
        if (writeNotion) {
            if (!notion) {
                notionWarning = 'Notion not configured -- set NOTION_TOKEN in .env.';
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
        proc.on('error', function (err) { resolve({ ok: false, code: -1, output: lines.join('\n') + '\n[spawn error] ' + err.message }); });
        proc.on('close', function (code) { resolve({ ok: code === 0, code: code, output: lines.join('\n') }); });
    });
}
app.post('/api/git-push', async function (req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    if (req.socket) { req.socket.setTimeout(0); req.socket.setKeepAlive(true); req.socket.setNoDelay(true); }
    function emit(o) { res.write('data: ' + JSON.stringify(o) + '\n\n'); }
    const heartbeat = setInterval(function () { res.write(': ping\n\n'); }, 15000);
    function endResponse() { clearInterval(heartbeat); try { res.end(); } catch (e) {} }
    try {
        const message = String((req.body && req.body.message) || '').trim() || 'Add new portfolio project';
        const paths = Array.isArray(req.body && req.body.paths) ? req.body.paths : [];
        const safePaths = paths.filter(function (p) {
            return typeof p === 'string' && !p.includes('..') && (p === 'gallery.html' || p === 'index.html' || p.startsWith('Images/Portfolio/'));
        });
        if (!safePaths.length) { emit({ status: 'error', message: 'No safe paths to commit.' }); return endResponse(); }
        emit({ status: 'started', paths: safePaths, message: message });
        emit({ step: 'add', status: 'running', label: 'Staging files' });
        const add = await spawnGitStreamed(['add', '--'].concat(safePaths), function (line) { emit({ step: 'add', status: 'progress', text: line }); });
        if (!add.ok) { emit({ step: 'add', status: 'error', code: add.code, output: add.output }); return endResponse(); }
        emit({ step: 'add', status: 'done' });

        emit({ step: 'commit', status: 'running', label: 'Creating commit' });
        const commit = await spawnGitStreamed(['commit', '-m', message], function (line) { emit({ step: 'commit', status: 'progress', text: line }); });
        const nothingToCommit = /nothing to commit|nothing added to commit/i.test(commit.output);
        if (!commit.ok && !nothingToCommit) { emit({ step: 'commit', status: 'error', code: commit.code, output: commit.output }); return endResponse(); }
        emit({ step: 'commit', status: 'done', skipped: nothingToCommit });

        emit({ step: 'push', status: 'running', label: 'Pushing to remote' });
        const push = await spawnGitStreamed(['push', '--progress'], function (line) { emit({ step: 'push', status: 'progress', text: line }); });
        if (!push.ok) { emit({ step: 'push', status: 'error', code: push.code, output: push.output }); return endResponse(); }
        emit({ step: 'push', status: 'done' });

        emit({ status: 'complete', message: 'Pushed to remote. Netlify is now rebuilding.' });
    } catch (err) {
        console.error('[git-push]', err);
        emit({ status: 'error', message: err.message || String(err) });
    } finally { endResponse(); }
});

// ----- sync from Notion (regenerates site portfolio from Notion DB) -----
app.post('/api/sync-from-notion', async function (req, res) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    res.flushHeaders();
    if (req.socket) { req.socket.setTimeout(0); req.socket.setKeepAlive(true); }
    function emit(o) { res.write('data: ' + JSON.stringify(o) + '\n\n'); }
    const heartbeat = setInterval(function () { res.write(': ping\n\n'); }, 15000);
    function endResponse() { clearInterval(heartbeat); try { res.end(); } catch (e) {} }

    try {
        if (!notion) { emit({ status: 'error', message: 'Notion not configured -- set NOTION_TOKEN in .env.' }); return endResponse(); }

        emit({ status: 'started' });

        emit({ step: 'read', status: 'running', label: 'Reading Notion database' });
        const allPages = await listAllNotionProjects();
        emit({ step: 'read', status: 'progress', text: 'Fetched ' + allPages.length + ' rows' });
        const all = allPages.map(notionPageToProject).filter(function (p) { return p.published && p.projectName; });
        all.sort(function (a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); });
        emit({ step: 'read', status: 'done', total: all.length });

        emit({ step: 'gallery', status: 'running', label: 'Updating gallery.html (' + all.length + ' projects)' });
        const galleryHtmlBlock = all.map(buildGalleryCardHtml).join('\n\n');
        const galleryJsBlock = all.map(buildGalleryJsEntry).join(',\n');
        let gallery = fs.readFileSync(GALLERY_HTML, 'utf8');
        gallery = replaceBetweenMarkers(gallery, HTML_MARKER_START, HTML_MARKER_END, galleryHtmlBlock);
        gallery = replaceBetweenMarkers(gallery, JS_MARKER_START, JS_MARKER_END, galleryJsBlock);
        fs.writeFileSync(GALLERY_HTML, gallery, 'utf8');
        emit({ step: 'gallery', status: 'done' });

        const featured = all.filter(function (p) { return p.featured; });
        emit({ step: 'index', status: 'running', label: 'Updating index.html (' + featured.length + ' featured)' });
        const indexHtmlBlock = featured.map(buildIndexCardHtml).join('\n\n');
        const indexJsBlock = featured.map(buildIndexJsEntry).join(',\n');
        let indexContent = fs.readFileSync(INDEX_HTML, 'utf8');
        indexContent = replaceBetweenMarkers(indexContent, HTML_MARKER_START, HTML_MARKER_END, indexHtmlBlock);
        indexContent = replaceBetweenMarkers(indexContent, JS_MARKER_START, JS_MARKER_END, indexJsBlock);
        fs.writeFileSync(INDEX_HTML, indexContent, 'utf8');
        emit({ step: 'index', status: 'done' });

        emit({
            status: 'complete',
            total: all.length,
            featuredCount: featured.length,
            message: 'Synced ' + all.length + ' projects (' + featured.length + ' featured) from Notion. Commit and push to deploy.',
            projectNames: all.map(function (p) { return p.projectName; })
        });
    } catch (err) {
        console.error('[sync-from-notion]', err);
        emit({ status: 'error', message: err.message || String(err) });
    } finally { endResponse(); }
});

// JSON error handler
app.use(function (err, req, res, next) {
    console.error('[server error]', err);
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ ok: false, error: 'A file is too large. Per-file limit is 50 MB.' });
    if (err && err.code === 'LIMIT_UNEXPECTED_FILE') return res.status(400).json({ ok: false, error: 'Unexpected file field: ' + err.field });
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
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 0;
server.timeout = 0;
      } catch (e) {}
    }, 400);
});
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 0;
server.timeout = 0;
