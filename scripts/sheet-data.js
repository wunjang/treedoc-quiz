const DEFAULT_SHEET_ID = '1jpI5fgLIYUQjyHXV3n4IbxOfAl9xLcaHmOAeVf5CECQ';
const DEFAULT_SHEET_GID = '322747574';

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

function normalizeTableCell(cell) {
    if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
        return {
            text: cell.text == null ? '' : String(cell.text),
            rowspan: Number(cell.rowspan),
            colspan: Number(cell.colspan)
        };
    }
    return cell == null ? '' : String(cell);
}

function getTableCellText(cell) {
    if (cell && typeof cell === 'object' && !Array.isArray(cell)) {
        return cell.text == null ? '' : String(cell.text);
    }
    return cell == null ? '' : String(cell);
}

function normalizeParsedTableData(parsed) {
    if (!Array.isArray(parsed)) return null;
    const rows = parsed
        .filter(row => Array.isArray(row))
        .map(row => row.map(normalizeTableCell))
        .filter(row => row.some(cell => getTableCellText(cell).trim() !== ''));
    if (!rows.length) return null;

    const hasSpan = rows.some(row => row.some((cell) => {
        if (!cell || typeof cell !== 'object' || Array.isArray(cell)) return false;
        return Number.isFinite(cell.rowspan) || Number.isFinite(cell.colspan);
    }));

    if (hasSpan) return rows;

    const maxCol = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (!maxCol) return null;

    const normalized = rows.map((row) => {
        const out = row.slice();
        while (out.length < maxCol) out.push('');
        return out;
    });

    const colHasContent = [];
    for (let c = 0; c < maxCol; c++) {
        colHasContent[c] = normalized.some(row => getTableCellText(row[c]).trim() !== '');
    }

    const trimmed = normalized.map(row => row.filter((_, c) => colHasContent[c]));
    return trimmed.some(row => row.length) ? trimmed : null;
}

function parseTableDataCell(value) {
    if (value == null) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    try {
        return normalizeParsedTableData(JSON.parse(raw));
    } catch (e) {
        return null;
    }
}

function buildTableDataFromRow(normalizedRow) {
    const tableDataFromCell = parseTableDataCell(normalizedRow.tabledata);
    if (tableDataFromCell) return tableDataFromCell;

    const table = [];
    let hasAnyContent = false;
    let maxRow = -1;
    let maxCol = -1;
    Object.keys(normalizedRow).forEach((key) => {
        const matched = key.match(/^tabledata\/(\d+)\/(\d+)$/);
        if (!matched) return;
        const rowIdx = Number(matched[1]);
        const colIdx = Number(matched[2]);
        const value = normalizedRow[key];
        if (!Number.isFinite(rowIdx) || !Number.isFinite(colIdx)) return;
        const text = value == null ? '' : String(value);
        if (!text.trim()) return;

        hasAnyContent = true;
        if (rowIdx > maxRow) maxRow = rowIdx;
        if (colIdx > maxCol) maxCol = colIdx;
        if (!table[rowIdx]) table[rowIdx] = [];
        table[rowIdx][colIdx] = text;
    });
    if (!hasAnyContent || maxRow < 0 || maxCol < 0) return null;

    const normalized = [];
    for (let r = 0; r <= maxRow; r++) {
        normalized[r] = [];
        for (let c = 0; c <= maxCol; c++) {
            normalized[r][c] = table[r] && table[r][c] != null ? table[r][c] : '';
        }
    }
    const rowHasContent = normalized.map((row) => row.some((cell) => String(cell || '').trim() !== ''));
    const colHasContent = [];
    for (let c = 0; c <= maxCol; c++) {
        colHasContent[c] = normalized.some(row => String((row && row[c]) || '').trim() !== '');
    }

    const trimmed = normalized
        .filter((_, r) => rowHasContent[r])
        .map((row) => row.filter((_, c) => colHasContent[c]));

    return trimmed.length ? trimmed : null;
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
            const tableData = buildTableDataFromRow(q);

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
                box: String(pickFirst(q, ['box'])).trim(),
                tableData
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

function getSheetUrls(sheetId = DEFAULT_SHEET_ID, gid = DEFAULT_SHEET_GID) {
    return {
        csv: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
        gviz: `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json&gid=${gid}&headers=1`
    };
}

async function loadQuestionsFromSheet(options = {}) {
    const sheetId = options.sheetId || DEFAULT_SHEET_ID;
    const gid = String(options.gid || DEFAULT_SHEET_GID);
    const urls = getSheetUrls(sheetId, gid);

    try {
        const text = await fetchText(urls.gviz);
        const mapped = mapGoogleSheetRowsToQuestions(parseGoogleGvizPayload(text));
        if (!mapped.length) throw new Error('구글 시트 GVIZ 데이터가 비어 있습니다.');
        return { questions: mapped, source: 'google_sheet_gviz', sheetId, gid };
    } catch (gvizError) {
        if (options.strictGviz) throw gvizError;
        console.warn(`Google Sheet GVIZ load failed: ${gvizError.message}`);
    }

    const text = await fetchText(urls.csv);
    const mapped = mapRowObjectsToQuestions(parseCsvToObjects(text));
    if (!mapped.length) throw new Error('구글 시트 CSV 데이터가 비어 있습니다.');
    return { questions: mapped, source: 'google_sheet_csv', sheetId, gid };
}

module.exports = {
    DEFAULT_SHEET_GID,
    DEFAULT_SHEET_ID,
    loadQuestionsFromSheet,
    mapRowObjectsToQuestions
};
