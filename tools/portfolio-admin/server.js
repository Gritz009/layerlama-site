// Layer Lama -- Portfolio Admin (local-only)
// Express server: serves admin form, saves images, injects markup into
// gallery.html (and index.html if Featured), optional Notion mirror, git push.
// NEVER deploy. Local-only. Reads secrets from .env.

'use strict';

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { execFile, exec } = require('child_process');
const { Client: NotionClient } = require('@notionhq/client');

const ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORTFOLIO_IMG_ROOT = path.join(ROOT, 'Images', 'Portfolio');
const GALLERY_HTML = path.join(ROOT, 'gallery.html');
const INDEX_HTML = path.join(ROOT, 'index.html');

const HTML_MARKER = 'LL_PORTFOLIO_INSERT_HTML';
const JS_MARKER = 'LL_PORTFOLIO_INSERT_JS';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NOTION_TOKEN = process.env.NOTION_TOKEN || '';
const NOTION_DB_ID = process.env.NOTION_PORTFOLIO_DB_ID || 'e3709cae-61b5-41e0-820d-507d5c63c304';
const notion = NOTION_TOKEN ? new NotionClient({ auth: NOTION_TOKEN }) : null;

// ----- helpers -----
// Middle dot (U+00B7) and bullet (U+2022) built via String.fromCharCode so the
// source file stays pure ASCII (some editors/saves were truncating files with
// inline non-ASCII characters in this codebase).
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

// ----- site logo (dark + light) -----
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

// ----- routes -----
const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

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
            projectName: projectName, folderName: folderName, projectKey: projectKey, categories: categories,
            designer: designer, designerUrl: designerUrl, material: material, printer: printer, cardMeta: cardMeta,
            displayOrder: displayOrder, featured: featured, published: published,
            thumbnailFile: thumbName, galleryImages: galleryImagePaths
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

        res.json({ ok: true, project: project, filesChanged: filesChanged, notionUrl: notionUrl, notionWarning: notionWarning });
    } catch (err) {
        console.error('[create-project]', err);
        cleanupStaging();
        res.status(400).json({ ok: false, error: err.message || String(err) });
    }
});

// JSON error handler -- catches multer errors (file too large, bad fields)
// and any other unhandled middleware error so the frontend sees JSON instead
// of Express's default HTML 500 page.
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

function runGit(args, cwd) {
    return new Promise(function (resolve) {
        execFile('git', args, { cwd: cwd, windowsHide: true }, function (err, stdout, stderr) {
            resolve({ ok: !err, code: err && err.code != null ? err.code : 0, stdout: stdout ? stdout.toString() : '', stderr: stderr ? stderr.toString() : '' });
        });
    });
}

app.post('/api/git-push', async (req, res) => {
    try {
        const message = String((req.body && req.body.message) || '').trim() || 'Add new portfolio project';
        const paths = Array.isArray(req.body && req.body.paths) ? req.body.paths : ['.'];
        const safePaths = paths.filter(function (p) {
            return typeof p === 'string' && !p.includes('..') && (p === 'gallery.html' || p === 'index.html' || p.startsWith('Images/Portfolio/'));
        });
        if (!safePaths.length) return res.status(400).json({ ok: false, error: 'No safe paths to commit.' });

        const log = [];
        const add = await runGit(['add', '--'].concat(safePaths), ROOT);
        log.push(Object.assign({ step: 'add' }, add));
        if (!add.ok) return res.status(500).json({ ok: false, error: 'git add failed', log: log });

        const commit = await runGit(['commit', '-m', message], ROOT);
        log.push(Object.assign({ step: 'commit' }, commit));
        if (!commit.ok && !/nothing to commit/i.test(commit.stdout + commit.stderr)) {
            return res.status(500).json({ ok: false, error: 'git commit failed', log: log });
        }

        const push = await runGit(['push'], ROOT);
        log.push(Object.assign({ step: 'push' }, push));
        if (!push.ok) return res.status(500).json({ ok: false, error: 'git push failed', log: log });

        res.json({ ok: true, log: log });
    } catch (err) {
        console.error('[git-push]', err);
        res.status(500).json({ ok: false, error: err.message || String(err) });
    }
});

app.listen(PORT, function () {
    const url = 'http://localhost:' + PORT;
    console.log('');
    console.log('  +----------------------------------------------------------+');
    console.log('  |  Layer Lama -- Portfolio Admin                           |');
    console.log('  |  ' + (url + '                                                          ').slice(0, 56) + '|');
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
