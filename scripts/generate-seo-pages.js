const fs = require('fs');
const path = require('path');
const { loadQuestionsFromSheet } = require('./sheet-data');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = 'https://treedoc-quiz.work.gd';
const GOOGLE_SHEET_ID = '1jpI5fgLIYUQjyHXV3n4IbxOfAl9xLcaHmOAeVf5CECQ';
const GOOGLE_SHEET_GID = '322747574';
const GOOGLE_SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/export?format=csv&gid=${GOOGLE_SHEET_GID}`;
const GOOGLE_SHEET_GVIZ_URL = `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/gviz/tq?tqx=out:json&gid=${GOOGLE_SHEET_GID}&headers=1`;
const SUBJECT_ORDER = ['수목병리학', '수목해충학', '수목생리학', '산림토양학', '수목관리학'];
const MAX_SAMPLE_QUESTIONS = 12;

let questions = [];

function ensureDir(dir) {
    fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function stripHtml(value) {
    return String(value == null ? '' : value)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseCsvToObjects(csvText) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < csvText.length; i++) {
        const ch = csvText[i];
        const next = csvText[i + 1];
        if (ch === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }
        if (!inQuotes && ch === ',') {
            row.push(cell);
            cell = '';
            continue;
        }
        if (!inQuotes && (ch === '\n' || ch === '\r')) {
            if (ch === '\r' && next === '\n') i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = '';
            continue;
        }
        cell += ch;
    }
    if (cell.length || row.length) {
        row.push(cell);
        rows.push(row);
    }
    if (!rows.length) return [];

    const headers = rows[0].map(h => String(h || '').trim());
    return rows.slice(1)
        .filter(r => r.some(v => String(v || '').trim() !== ''))
        .map((r) => {
            const obj = {};
            headers.forEach((h, idx) => {
                obj[h || `column_${idx}`] = r[idx] == null ? '' : r[idx];
            });
            return obj;
        });
}

function parseGoogleGvizPayload(rawText) {
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd < 0 || jsonEnd <= jsonStart) {
        throw new Error('구글 시트 응답 파싱 실패');
    }
    return JSON.parse(rawText.slice(jsonStart, jsonEnd + 1));
}

function normalizeSheetHeader(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[_-]/g, '');
}

function normalizeObjectKeys(rowObj) {
    const normalized = {};
    Object.keys(rowObj).forEach((key) => {
        normalized[normalizeSheetHeader(key)] = rowObj[key];
    });
    return normalized;
}

function parseStringArray(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    if (value == null) return [];
    const raw = String(value).trim();
    if (!raw) return [];
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
        } catch (e) {
            // Use delimiter parsing below.
        }
    }
    return raw.split(/\r?\n|[,;|]/).map(v => v.trim()).filter(Boolean);
}

function parseAnswerArray(value) {
    if (Array.isArray(value)) return value.map(v => Number(v)).filter(Number.isFinite);
    if (typeof value === 'number') return [value];
    const raw = String(value || '').trim();
    if (!raw) return [];
    if (raw.startsWith('[') && raw.endsWith(']')) {
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.map(v => Number(v)).filter(Number.isFinite);
        } catch (e) {
            // Use digit parsing below.
        }
    }
    return raw
        .split(/[^0-9]+/)
        .map(v => Number(v))
        .filter(Number.isFinite);
}

function parseQuestionNumber(value) {
    if (typeof value === 'number') return value;
    const matched = String(value || '').match(/\d+/);
    return matched ? Number(matched[0]) : 0;
}

function pickFirst(row, keys) {
    for (const key of keys) {
        const value = row[normalizeSheetHeader(key)];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return value;
        }
    }
    return '';
}

function buildOptionsFromRow(normalizedRow) {
    const optionsRaw = pickFirst(normalizedRow, ['options', '보기', '선지']);
    const parsedOptions = parseStringArray(optionsRaw);
    if (parsedOptions.length) return parsedOptions;

    return ['option1', 'option2', 'option3', 'option4', 'option5', '보기1', '보기2', '보기3', '보기4', '보기5', '선지1', '선지2', '선지3', '선지4', '선지5']
        .map((key) => normalizedRow[normalizeSheetHeader(key)])
        .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
        .map(v => String(v).trim());
}

function collectIndexedValues(normalizedRow, baseKey, maxCount = 20) {
    const base = normalizeSheetHeader(baseKey);
    const values = [];
    for (let i = 0; i < maxCount; i++) {
        const keyA = `${base}/${i}`;
        const keyB = `${base}${i}`;
        const value = normalizedRow[keyA] ?? normalizedRow[keyB];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            values.push(String(value).trim());
        }
    }
    if (values.length) return values;

    return Object.keys(normalizedRow)
        .map((key) => {
            const m = key.match(new RegExp(`^${base}(?:\\/|_|-)?(\\d+)$`));
            return m ? { idx: Number(m[1]), value: normalizedRow[key] } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.idx - b.idx)
        .map(v => String(v.value == null ? '' : v.value).trim())
        .filter(Boolean);
}

function hashString(input) {
    let hash = 2166136261;
    const str = String(input || '');
    for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
}

function buildStableQuestionId(session, subject, number, question, fallbackId) {
    const explicit = String(fallbackId || '').trim();
    if (explicit) return explicit;
    if (Number.isFinite(number) && number > 0) return `${session}-${number}`;
    return `auto-${hashString(`${session}|${subject}|${question}`)}`;
}

function remapWithFirstDataRowAsHeader(rowObjects) {
    if (!Array.isArray(rowObjects) || rowObjects.length < 2) return [];
    const first = rowObjects[0] || {};
    const originalKeys = Object.keys(first);
    const newHeaders = originalKeys.map((k) => String(first[k] == null ? '' : first[k]).trim());
    if (!newHeaders.some(Boolean)) return [];

    return rowObjects.slice(1).map((row) => {
        const out = {};
        originalKeys.forEach((k, idx) => {
            out[(newHeaders[idx] || `column_${idx}`).trim()] = row[k];
        });
        return out;
    });
}

function mapRowObjectsToQuestions(rowObjects) {
    return rowObjects
        .map((rowObj) => {
            const q = normalizeObjectKeys(rowObj);
            const session = String(pickFirst(q, ['session', '회차'])).trim();
            const number = parseQuestionNumber(pickFirst(q, ['number', '문항번호', '번호', '문항']));
            const subject = String(pickFirst(q, ['subject', '과목'])).trim();
            const question = String(pickFirst(q, ['question', '문제'])).trim();
            const optionsFromIndexed = collectIndexedValues(q, 'options', 10);
            const options = optionsFromIndexed.length ? optionsFromIndexed : buildOptionsFromRow(q);
            const answersFromIndexed = collectIndexedValues(q, 'answer', 10)
                .map(v => Number(v))
                .filter(Number.isFinite);
            const answer = answersFromIndexed.length ? answersFromIndexed : parseAnswerArray(pickFirst(q, ['answer', '정답']));
            const tagsFromIndexed = collectIndexedValues(q, 'tags', 10);

            return {
                id: buildStableQuestionId(session, subject, number, question, pickFirst(q, ['id'])),
                session,
                number,
                subject,
                tags: tagsFromIndexed.length ? tagsFromIndexed : parseStringArray(pickFirst(q, ['tags', '태그'])),
                question,
                image: String(pickFirst(q, ['image', '이미지'])).trim() || null,
                options,
                answer,
                explanation: String(pickFirst(q, ['explanation', '해설'])).trim(),
                box: String(pickFirst(q, ['box'])).trim()
            };
        })
        .filter((q) => q.session && q.subject && q.question && Array.isArray(q.options) && q.options.length > 0 && Array.isArray(q.answer) && q.answer.length > 0);
}

function mapGoogleSheetRowsToQuestions(gvizPayload) {
    const table = gvizPayload && gvizPayload.table ? gvizPayload.table : null;
    if (!table || !Array.isArray(table.cols) || !Array.isArray(table.rows)) {
        throw new Error('구글 시트 테이블 형식이 올바르지 않습니다.');
    }

    const headers = table.cols.map((col, idx) => {
        const raw = (col && (col.label || col.id)) || `column_${idx}`;
        return String(raw).trim();
    });
    const rowObjects = table.rows.map((row) => {
        const values = Array.isArray(row && row.c) ? row.c : [];
        const rowObj = {};
        headers.forEach((header, idx) => {
            const cell = values[idx];
            rowObj[header] = cell && cell.v != null ? cell.v : '';
        });
        return rowObj;
    });

    let mapped = mapRowObjectsToQuestions(rowObjects);
    if (mapped.length) return mapped;
    mapped = mapRowObjectsToQuestions(remapWithFirstDataRowAsHeader(rowObjects));
    return mapped;
}

async function fetchText(url) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
}

async function loadQuestions() {
    try {
        const result = await loadQuestionsFromSheet({
            sheetId: GOOGLE_SHEET_ID,
            gid: GOOGLE_SHEET_GID
        });
        console.log(`Loaded ${result.questions.length} questions from ${result.source}.`);
        return result.questions;
    } catch (sheetError) {
        console.warn(`Google Sheet load failed: ${sheetError.message}`);
    }

    const fallback = JSON.parse(fs.readFileSync(path.join(ROOT, 'questions.json'), 'utf8'));
    console.log(`Loaded ${fallback.length} questions from questions.json fallback.`);
    return fallback;
}

function xmlEscape(value) {
    return escapeHtml(value);
}

function pagePath(group, label) {
    return `/${group}/${label}.html`;
}

function pageUrl(group, label) {
    return `${BASE_URL}${encodeURI(pagePath(group, label))}`;
}

function appFilterUrl(key, value) {
    return `${BASE_URL}/?${key}=${encodeURIComponent(value)}`;
}

function sortSessions(values) {
    return [...values].sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' }));
}

function sortSubjects(values) {
    return [...values].sort((a, b) => {
        const ai = SUBJECT_ORDER.indexOf(a);
        const bi = SUBJECT_ORDER.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b, 'ko-KR');
    });
}

function getUpdatedDate() {
    return new Date().toISOString().slice(0, 10);
}

function buildSampleQuestions(items) {
    return items.slice(0, MAX_SAMPLE_QUESTIONS).map((q) => {
        const questionText = stripHtml(q.question);
        const options = Array.isArray(q.options) ? q.options : [];
        return `
            <article class="question">
                <p class="eyebrow">${escapeHtml(q.session)} · ${escapeHtml(q.subject)} · ${escapeHtml(q.number)}번</p>
                <h2>${escapeHtml(questionText)}</h2>
                <ol>
                    ${options.map(option => `<li>${escapeHtml(stripHtml(option))}</li>`).join('\n')}
                </ol>
            </article>`;
    }).join('\n');
}

function buildJsonLd({ title, description, url, breadcrumbs }) {
    return JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'CollectionPage',
                '@id': `${url}#webpage`,
                url,
                name: title,
                description,
                inLanguage: 'ko-KR',
                isPartOf: {
                    '@id': `${BASE_URL}/#website`
                }
            },
            {
                '@type': 'BreadcrumbList',
                '@id': `${url}#breadcrumb`,
                itemListElement: breadcrumbs.map((crumb, index) => ({
                    '@type': 'ListItem',
                    position: index + 1,
                    name: crumb.name,
                    item: crumb.url
                }))
            }
        ]
    }, null, 2);
}

function renderPage({ title, description, canonical, heading, intro, ctaUrl, questionsHtml, breadcrumbs }) {
    const jsonLd = buildJsonLd({ title, description, url: canonical, breadcrumbs });
    return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="index, follow">
    <meta name="theme-color" content="#3b82f6">
    <link rel="canonical" href="${canonical}">
    <link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="TREEDOC-QUIZ">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${BASE_URL}/assets/og-image.svg">
    <meta property="og:locale" content="ko_KR">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${BASE_URL}/assets/og-image.svg">
    <script type="application/ld+json">${jsonLd}</script>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            background: #f1f5f9;
            color: #172033;
            line-height: 1.65;
        }
        .wrap { max-width: 920px; margin: 0 auto; padding: 28px 18px 56px; }
        .hero {
            background: #ffffff;
            border: 1px solid #dbe4ef;
            border-radius: 8px;
            padding: 28px;
            margin-bottom: 18px;
        }
        .brand { color: #2563eb; font-weight: 800; text-decoration: none; }
        h1 { margin: 12px 0 10px; font-size: clamp(28px, 5vw, 42px); line-height: 1.2; }
        h2 { margin: 0 0 10px; font-size: 20px; line-height: 1.45; }
        .intro { margin: 0 0 20px; color: #475569; }
        .cta {
            display: inline-block;
            padding: 11px 16px;
            border-radius: 8px;
            background: #2563eb;
            color: #ffffff;
            font-weight: 800;
            text-decoration: none;
        }
        .question {
            background: #ffffff;
            border: 1px solid #dbe4ef;
            border-radius: 8px;
            padding: 20px;
            margin: 14px 0;
        }
        .eyebrow { margin: 0 0 8px; color: #64748b; font-size: 14px; font-weight: 700; }
        ol { margin: 0; padding-left: 24px; }
        li { margin: 4px 0; }
        .footer { margin-top: 28px; color: #64748b; font-size: 14px; }
    </style>
</head>
<body>
    <main class="wrap">
        <section class="hero">
            <a class="brand" href="/">TREEDOC-QUIZ</a>
            <h1>${escapeHtml(heading)}</h1>
            <p class="intro">${escapeHtml(intro)}</p>
            <a class="cta" href="${ctaUrl}">전체 문제 풀기</a>
        </section>
        ${questionsHtml}
        <p class="footer">이 페이지는 검색 노출을 위해 questions.json 기준으로 생성된 정적 인덱스입니다.</p>
    </main>
</body>
</html>
`;
}

function writePage(group, label, html) {
    const filePath = path.join(ROOT, group, `${label}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
}

function generateSubjectPages(urls) {
    const subjects = sortSubjects(new Set(questions.map(q => q.subject).filter(Boolean)));
    subjects.forEach((subject) => {
        const items = questions.filter(q => q.subject === subject);
        const canonical = pageUrl('subjects', subject);
        const title = `${subject} 나무의사 기출문제 | TREEDOC-QUIZ`;
        const description = `${subject} 나무의사 필기 기출문제 ${items.length}개를 회차별로 학습하고 검색해 보세요.`;
        writePage('subjects', subject, renderPage({
            title,
            description,
            canonical,
            heading: `${subject} 기출문제`,
            intro: `TREEDOC-QUIZ의 ${subject} 문제를 모아둔 정적 인덱스입니다. 대표 문제를 확인한 뒤 전체 앱에서 검색, 정답 확인, 메모 기능으로 학습할 수 있습니다.`,
            ctaUrl: appFilterUrl('subject', subject),
            questionsHtml: buildSampleQuestions(items),
            breadcrumbs: [
                { name: 'TREEDOC-QUIZ', url: `${BASE_URL}/` },
                { name: `${subject} 기출문제`, url: canonical }
            ]
        }));
        urls.push(canonical);
    });
}

function generateSessionPages(urls) {
    const sessions = sortSessions(new Set(questions.map(q => q.session).filter(Boolean)));
    sessions.forEach((session) => {
        const items = questions.filter(q => q.session === session);
        const canonical = pageUrl('sessions', session);
        const title = `${session} 나무의사 기출문제 | TREEDOC-QUIZ`;
        const description = `${session} 나무의사 필기 기출문제 ${items.length}개를 과목별로 풀어보고 복습해 보세요.`;
        writePage('sessions', session, renderPage({
            title,
            description,
            canonical,
            heading: `${session} 나무의사 기출문제`,
            intro: `${session} 시험 문제를 과목별로 모아둔 정적 인덱스입니다. 전체 앱에서는 회차 필터가 자동 적용된 상태로 문제풀이를 시작할 수 있습니다.`,
            ctaUrl: appFilterUrl('session', session),
            questionsHtml: buildSampleQuestions(items),
            breadcrumbs: [
                { name: 'TREEDOC-QUIZ', url: `${BASE_URL}/` },
                { name: `${session} 기출문제`, url: canonical }
            ]
        }));
        urls.push(canonical);
    });
}

function generateTagPages(urls) {
    const tags = [...new Set(questions.flatMap(q => Array.isArray(q.tags) ? q.tags : []).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' }));
    tags.forEach((tag) => {
        const items = questions.filter(q => Array.isArray(q.tags) && q.tags.includes(tag));
        const canonical = pageUrl('tags', tag);
        const title = `${tag} 나무의사 기출문제 | TREEDOC-QUIZ`;
        const description = `${tag} 관련 나무의사 기출문제 ${items.length}개를 확인하고 과목별 문제풀이로 학습해 보세요.`;
        writePage('tags', tag, renderPage({
            title,
            description,
            canonical,
            heading: `${tag} 기출문제`,
            intro: `${tag} 태그가 포함된 대표 문제를 모아둔 정적 인덱스입니다. 전체 앱에서 검색어로 ${tag}를 입력하면 관련 문제를 더 넓게 찾아볼 수 있습니다.`,
            ctaUrl: `${BASE_URL}/?q=${encodeURIComponent(tag)}`,
            questionsHtml: buildSampleQuestions(items),
            breadcrumbs: [
                { name: 'TREEDOC-QUIZ', url: `${BASE_URL}/` },
                { name: `${tag} 기출문제`, url: canonical }
            ]
        }));
        urls.push(canonical);
    });
}

function writeRobots() {
    fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *
Allow: /

Sitemap: ${BASE_URL}/sitemap.xml
`, 'utf8');
}

function writeManifest() {
    const manifest = {
        name: 'TREEDOC-QUIZ - 나무의사 기출문제',
        short_name: 'TREEDOC-QUIZ',
        description: '나무의사 필기 시험 기출문제를 회차별, 과목별로 풀어보는 학습 서비스',
        lang: 'ko-KR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f1f5f9',
        theme_color: '#3b82f6',
        icons: [
            {
                src: '/assets/icon.svg',
                sizes: 'any',
                type: 'image/svg+xml',
                purpose: 'any maskable'
            }
        ]
    };
    fs.writeFileSync(path.join(ROOT, 'site.webmanifest'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function writeSitemap(urls) {
    const lastmod = getUpdatedDate();
    const entries = urls.map((url) => `    <url>
        <loc>${xmlEscape(url)}</loc>
        <lastmod>${lastmod}</lastmod>
        <changefreq>weekly</changefreq>
        <priority>${url === `${BASE_URL}/` ? '1.0' : '0.8'}</priority>
    </url>`).join('\n');
    fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`, 'utf8');
}

function writeAssets() {
    const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#14532d"/>
  <circle cx="256" cy="188" r="118" fill="#22c55e"/>
  <path d="M256 230v154" stroke="#f8fafc" stroke-width="42" stroke-linecap="round"/>
  <path d="M176 330h160" stroke="#f8fafc" stroke-width="42" stroke-linecap="round"/>
</svg>
`;
    const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#f1f5f9"/>
  <rect x="72" y="72" width="1056" height="486" rx="32" fill="#ffffff" stroke="#dbe4ef" stroke-width="4"/>
  <text x="112" y="170" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="#2563eb">TREEDOC-QUIZ</text>
  <text x="112" y="285" font-family="Arial, sans-serif" font-size="78" font-weight="800" fill="#172033">나무의사 기출문제</text>
  <text x="112" y="365" font-family="Arial, sans-serif" font-size="38" fill="#475569">회차별 · 과목별 문제풀이와 모의고사</text>
  <text x="112" y="455" font-family="Arial, sans-serif" font-size="30" fill="#64748b">수목병리학 · 수목해충학 · 수목생리학 · 산림토양학 · 수목관리학</text>
  <circle cx="970" cy="232" r="86" fill="#22c55e"/>
  <path d="M970 278v116" stroke="#14532d" stroke-width="34" stroke-linecap="round"/>
  <path d="M906 358h128" stroke="#14532d" stroke-width="34" stroke-linecap="round"/>
</svg>
`;
    fs.writeFileSync(path.join(ROOT, 'assets', 'icon.svg'), icon, 'utf8');
    fs.writeFileSync(path.join(ROOT, 'assets', 'og-image.svg'), og, 'utf8');
}

async function main() {
    questions = await loadQuestions();

    ensureDir('subjects');
    ensureDir('sessions');
    ensureDir('tags');
    ensureDir('assets');

    const urls = [`${BASE_URL}/`];
    generateSubjectPages(urls);
    generateSessionPages(urls);
    generateTagPages(urls);
    writeRobots();
    writeManifest();
    writeAssets();
    writeSitemap(urls);

    console.log(`Generated ${urls.length} sitemap URLs.`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
