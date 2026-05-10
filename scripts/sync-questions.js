const fs = require('fs');
const path = require('path');
const {
    DEFAULT_SHEET_GID,
    DEFAULT_SHEET_ID,
    loadQuestionsFromSheet
} = require('./sheet-data');

const ROOT = path.resolve(__dirname, '..');
const QUESTIONS_PATH = path.join(ROOT, 'questions.json');

function getArgValue(name, fallback) {
    const prefix = `--${name}=`;
    const inline = process.argv.find(arg => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);

    const idx = process.argv.indexOf(`--${name}`);
    if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
    return fallback;
}

function summarize(questions) {
    const sessions = [...new Set(questions.map(q => q.session).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' }));
    const subjects = [...new Set(questions.map(q => q.subject).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true, sensitivity: 'base' }));
    return { sessions, subjects };
}

async function main() {
    const sheetId = getArgValue('sheet-id', DEFAULT_SHEET_ID);
    const gid = getArgValue('gid', DEFAULT_SHEET_GID);
    const previous = fs.existsSync(QUESTIONS_PATH)
        ? JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'))
        : [];

    const result = await loadQuestionsFromSheet({ sheetId, gid });
    const next = result.questions;
    const { sessions, subjects } = summarize(next);

    fs.writeFileSync(QUESTIONS_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8');

    console.log(`Synced questions.json from ${result.source}.`);
    console.log(`Sheet: ${sheetId}, gid: ${gid}`);
    console.log(`Questions: ${previous.length} -> ${next.length}`);
    console.log(`Sessions: ${sessions.join(', ')}`);
    console.log(`Subjects: ${subjects.join(', ')}`);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
