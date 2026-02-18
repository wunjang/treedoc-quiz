
        let questions = [];
        let selectedSessions = new Set();
        let selectedSubjects = new Set();
        let selectedSubsubjects = new Set();
        let selectedMockSubjects = new Set();
        let mockQuestions = [];
        let mockAnswers = {};
        let isMockMode = false;
        let isMockFinished = false;
        let mockPaused = false;
        let mockTimerId = null;
        let mockTimeLeft = 0;
        let appMode = 'normal';
        let hasAutoOpenedMockMenu = false;
        let questionMemos = {};
        const subjectOrder = ["수목병리학", "수목해충학", "수목생리학", "산림토양학", "수목관리학"];
        const managementSubsubjects = ["수목관리학", "농약학", "비생물적 피해", "정책 및 법규"];
        const managementRatio = {
            "수목관리학": 8,
            "농약학": 6,
            "비생물적 피해": 8,
            "정책 및 법규": 3
        };

        // 다크 모드 토글 함수
        function toggleDarkMode() {
            const isChecked = document.getElementById('darkModeToggle').checked;
            const isDark = document.body.classList.toggle('dark-mode', isChecked);
            localStorage.setItem('darkMode', isDark ? 'enabled' : 'disabled');
        }

        // 초기 로드 시 다크 모드 설정 확인
        window.addEventListener('DOMContentLoaded', () => {
            const darkModeStatus = localStorage.getItem('darkMode');
            const toggle = document.getElementById('darkModeToggle');
            try {
                questionMemos = JSON.parse(localStorage.getItem('questionMemos') || '{}');
            } catch (e) {
                questionMemos = {};
            }
            if (darkModeStatus === 'enabled') {
                document.body.classList.add('dark-mode');
                if (toggle) toggle.checked = true;
            }
        });

        async function loadData() {
            try {
                const response = await fetch('questions.json');
                if (!response.ok) throw new Error('파일 로드 실패');
                questions = await response.json();
                initFilters();
                const modeParam = new URLSearchParams(window.location.search).get('mode');
                const initialMode = (modeParam && modeParam.toLowerCase() === 'mock') ? 'mock' : 'normal';
                switchAppMode(initialMode);
                processAndRender();
            } catch (e) {
                document.getElementById('questionList').innerHTML = `<p style="color:red; text-align:center;">데이터를 불러올 수 없습니다 (questions.json 확인 필요)</p>`;
            }
        }

        function initFilters() {
            const sessions = [...new Set(questions.map(q => q.session))].sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
            );
            const subjects = [...new Set(questions.map(q => q.subject))].sort((a, b) => {
                let idxA = subjectOrder.indexOf(a), idxB = subjectOrder.indexOf(b);
                return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
            });
            document.getElementById('sessionGroup').innerHTML = sessions.map(s => `<div class="tag session" onclick="toggleFilter('session', '${s}', this)">${s}</div>`).join('');
            document.getElementById('subjectGroup').innerHTML = subjects.map(s => `<div class="tag subject" onclick="toggleFilter('subject', '${s}', this)">${s}</div>`).join('');
            document.getElementById('subsubjectGroup').innerHTML = managementSubsubjects.map(s => `<div class="tag subsubject" onclick="toggleFilter('subsubject', '${s}', this)">${s}</div>`).join('');
            selectedMockSubjects = new Set(subjects);
            document.getElementById('mockSubjectGroup').innerHTML = subjects.map(s => `<div class="tag subject active" onclick="toggleMockSubject('${s}', this)">${s}</div>`).join('');
            document.getElementById('mockCountPerSubject').addEventListener('input', updateMockHeaderSummary);
            updateSubsubjectVisibility();
            initFeatureBubble();
        }

        function initFeatureBubble() {
            const shown = localStorage.getItem('mockFeatureBubbleShown');
            if (shown === '1') return;
            const bubble = document.getElementById('featureBubble');
            bubble.style.display = 'block';
            localStorage.setItem('mockFeatureBubbleShown', '1');
            setTimeout(() => {
                bubble.style.display = 'none';
            }, 8000);
        }

        function dismissFeatureBubble(e) {
            if (e) e.stopPropagation();
            const bubble = document.getElementById('featureBubble');
            bubble.style.display = 'none';
        }

        function toggleModeMenu(e) {
            e.stopPropagation();
            dismissFeatureBubble();
            const menu = document.getElementById('modeMenu');
            menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        }

        function closeModeMenu() {
            document.getElementById('modeMenu').style.display = 'none';
        }

        function switchAppMode(mode, e) {
            if (e) e.stopPropagation();
            appMode = mode;
            const shouldAutoOpenModeMenu = mode === 'mock' && !hasAutoOpenedMockMenu;
            if (shouldAutoOpenModeMenu) hasAutoOpenedMockMenu = true;
            document.getElementById('modeNormalBtn').classList.toggle('active', mode === 'normal');
            document.getElementById('modeMockBtn').classList.toggle('active', mode === 'mock');
            document.getElementById('normalFilterUI').style.display = mode === 'normal' ? 'block' : 'none';
            document.getElementById('mockPanel').style.display = mode === 'mock' ? 'block' : 'none';
            document.getElementById('headerTitle').innerText = mode === 'normal' ? '🔍 필터 설정' : '🧪 모의고사 설정';

            if (mode === 'normal') {
                resetMockState();
            } else {
                updateMockHeaderSummary();
            }
            if (shouldAutoOpenModeMenu) {
                document.getElementById('modeMenu').style.display = 'block';
            } else {
                closeModeMenu();
            }
            processAndRender();
        }

        function updateSubsubjectVisibility() {
            const row = document.getElementById('subsubjectRow');
            const shouldShow = selectedSubjects.has('수목관리학');
            row.style.display = shouldShow ? 'block' : 'none';

            // 수목관리학 과목이 해제되면 부과목 선택도 초기화
            if (!shouldShow && selectedSubsubjects.size) {
                selectedSubsubjects.clear();
                document.querySelectorAll('#subsubjectGroup .tag').forEach(t => t.classList.remove('active'));
            }
        }

        function togglePanel(e) { e.stopPropagation(); document.getElementById('filterPanel').classList.toggle('collapsed'); }

        window.addEventListener('click', function (e) {
            if (appMode === 'mock') return;
            const panel = document.getElementById('filterPanel');
            if (panel && !panel.contains(e.target)) panel.classList.add('collapsed');
            closeModeMenu();
        });

        function toggleFilter(type, value, el) {
            const set = type === 'session'
                ? selectedSessions
                : (type === 'subject' ? selectedSubjects : selectedSubsubjects);
            set.has(value) ? set.delete(value) : set.add(value);
            el.classList.toggle('active');
            if (type === 'subject') updateSubsubjectVisibility();
            processAndRender();
        }

        function toggleMockSubject(value, el) {
            selectedMockSubjects.has(value) ? selectedMockSubjects.delete(value) : selectedMockSubjects.add(value);
            el.classList.toggle('active');
            if (appMode === 'mock') updateMockHeaderSummary();
        }

        function shuffleArray(arr) {
            const copy = [...arr];
            for (let i = copy.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [copy[i], copy[j]] = [copy[j], copy[i]];
            }
            return copy;
        }

        function pickRandom(arr, n) {
            return shuffleArray(arr).slice(0, n);
        }

        function remapQuestionOptions(q) {
            const optionWithOrigin = q.options.map((text, idx) => ({ text, originalIndex: idx + 1 }));
            const shuffled = shuffleArray(optionWithOrigin);
            const remappedAnswer = shuffled
                .map((opt, idx) => ({ idx: idx + 1, originalIndex: opt.originalIndex }))
                .filter(v => q.answer.includes(v.originalIndex))
                .map(v => v.idx)
                .sort((a, b) => a - b);

            return {
                ...q,
                options: shuffled.map(v => v.text),
                answer: remappedAnswer
            };
        }

        function allocateByRatio(total, ratioObj) {
            const entries = Object.entries(ratioObj);
            const sum = entries.reduce((acc, [, w]) => acc + w, 0);
            const raw = entries.map(([k, w]) => ({ key: k, value: (total * w) / sum }));
            const result = {};
            let assigned = 0;

            raw.forEach(v => {
                result[v.key] = Math.floor(v.value);
                assigned += result[v.key];
            });
            raw.sort((a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)));
            for (let i = 0; i < total - assigned; i++) {
                result[raw[i % raw.length].key] += 1;
            }
            return result;
        }

        function pickManagementByRatio(pool, total) {
            const ratioCounts = allocateByRatio(total, managementRatio);
            const selected = [];
            const selectedIds = new Set();
            let shortage = 0;

            for (const sub of managementSubsubjects) {
                const subPool = pool.filter(q => Array.isArray(q.tags) && q.tags.includes(sub));
                const needed = ratioCounts[sub] || 0;
                const picked = pickRandom(subPool, Math.min(needed, subPool.length));
                picked.forEach(q => { selected.push(q); selectedIds.add(q.id); });
                if (picked.length < needed) shortage += (needed - picked.length);
            }

            if (shortage > 0) {
                const remainPool = pool.filter(q => !selectedIds.has(q.id));
                selected.push(...pickRandom(remainPool, Math.min(shortage, remainPool.length)));
            }

            return selected.slice(0, total);
        }

        function getUnansweredCount() {
            return mockQuestions.filter(q => !(mockAnswers[q.mockId] && mockAnswers[q.mockId].length)).length;
        }

        function updateMockHeaderSummary() {
            if (appMode !== 'mock') return;
            const perSubject = parseInt(document.getElementById('mockCountPerSubject').value || '0', 10);
            const selectedCount = selectedMockSubjects.size;
            if (!isMockMode) {
                const expected = Number.isInteger(perSubject) && perSubject > 0 ? selectedCount * perSubject : 0;
                document.getElementById('filterSummary').innerText = `모의고사 설정`;
                document.getElementById('headerResultCount').innerText = expected ? `(예상 ${expected}문항)` : '';
                return;
            }
            const mm = String(Math.floor(mockTimeLeft / 60)).padStart(2, '0');
            const ss = String(mockTimeLeft % 60).padStart(2, '0');
            const remain = getUnansweredCount();
            const pausedText = mockPaused ? '일시정지 | ' : '';
            document.getElementById('filterSummary').innerText = `${pausedText}남은 ${remain}문항 | ${mm}:${ss}`;
            document.getElementById('headerResultCount').innerText = `(${mockQuestions.length}문항)`;
        }

        function resetMockState() {
            if (mockTimerId) {
                clearInterval(mockTimerId);
                mockTimerId = null;
            }
            isMockMode = false;
            isMockFinished = false;
            mockPaused = false;
            mockQuestions = [];
            mockAnswers = {};
            mockTimeLeft = 0;
            document.getElementById('mockTimer').style.display = 'none';
            document.getElementById('startMockBtn').style.display = 'inline-block';
            document.getElementById('pauseMockBtn').style.display = 'none';
            document.getElementById('pauseMockBtn').innerText = '모의고사 일시정지';
            document.getElementById('endMockBtn').style.display = 'none';
        }

        function startMockExam() {
            if (appMode !== 'mock') return;
            if (!questions.length) return;
            const subjects = [...selectedMockSubjects];
            if (subjects.length === 0) {
                alert('모의고사 과목을 1개 이상 선택해 주세요.');
                return;
            }

            const perSubject = parseInt(document.getElementById('mockCountPerSubject').value, 10);
            if (!Number.isInteger(perSubject) || perSubject < 1) {
                alert('과목당 문제 수는 1 이상 정수여야 합니다.');
                return;
            }

            const generated = [];
            for (const subject of subjects) {
                const pool = questions.filter(q => q.subject === subject && Array.isArray(q.answer) && q.answer.length === 1);
                const count = Math.min(perSubject, pool.length);
                if (count < perSubject) {
                    alert(`${subject} 과목은 출제 가능한 문항이 ${pool.length}개여서 ${count}문항으로 출제합니다.`);
                }
                if (subject === '수목관리학') {
                    generated.push(...pickManagementByRatio(pool, count).map(remapQuestionOptions));
                } else {
                    generated.push(...pickRandom(pool, count).map(remapQuestionOptions));
                }
            }

            mockQuestions = generated
                .map(q => ({ ...q, _mockRand: Math.random() }))
                .sort((a, b) => {
                    const ai = subjectOrder.indexOf(a.subject);
                    const bi = subjectOrder.indexOf(b.subject);
                    if (ai !== bi) return ai - bi;
                    return a._mockRand - b._mockRand;
                })
                .map(({ _mockRand, ...q }, idx) => ({
                    ...q,
                    mockId: `${q.id}-${idx}`
                }));
            mockAnswers = {};
            isMockMode = true;
            isMockFinished = false;
            mockPaused = false;

            document.getElementById('startMockBtn').style.display = 'none';
            document.getElementById('pauseMockBtn').style.display = 'inline-block';
            document.getElementById('endMockBtn').style.display = 'inline-block';
            startMockTimer(mockQuestions.length * 60);
            document.getElementById('filterPanel').classList.add('collapsed');
            closeModeMenu();
            renderMockExam();
        }

        function updateMockTimerText() {
            const mm = String(Math.floor(mockTimeLeft / 60)).padStart(2, '0');
            const ss = String(mockTimeLeft % 60).padStart(2, '0');
            document.getElementById('mockTimer').innerText = `남은 시간 (문항당 1분 기준): ${mm}:${ss}`;
            updateMockHeaderSummary();
        }

        function startMockTimer(seconds) {
            if (mockTimerId) clearInterval(mockTimerId);
            mockTimeLeft = seconds;
            const timerEl = document.getElementById('mockTimer');
            timerEl.style.display = 'block';
            updateMockTimerText();

            mockTimerId = setInterval(() => {
                if (mockPaused) return;
                mockTimeLeft -= 1;
                if (mockTimeLeft <= 0) {
                    finishMockExam(true);
                    return;
                }
                updateMockTimerText();
            }, 1000);
        }

        function togglePauseMockExam() {
            if (!isMockMode || isMockFinished) return;
            mockPaused = !mockPaused;
            const pauseBtn = document.getElementById('pauseMockBtn');
            pauseBtn.innerText = mockPaused ? '모의고사 재개' : '모의고사 일시정지';
            if (mockPaused) {
                document.getElementById('mockTimer').innerText += ' (일시정지)';
            } else {
                updateMockTimerText();
            }
            updateMockHeaderSummary();
        }

        function finishMockExam(isAutoSubmit) {
            if (!isMockMode || isMockFinished) return;
            if (mockTimerId) {
                clearInterval(mockTimerId);
                mockTimerId = null;
            }
            isMockFinished = true;
            mockPaused = false;
            document.getElementById('pauseMockBtn').style.display = 'none';
            document.getElementById('endMockBtn').style.display = 'none';
            document.getElementById('startMockBtn').style.display = 'inline-block';
            if (isAutoSubmit) {
                document.getElementById('mockTimer').innerText = '시간이 종료되어 자동으로 모의고사가 제출되었습니다.';
            }
            updateMockHeaderSummary();
            renderMockExam();
        }

        function toggleMockOption(mockId, optionIndex) {
            if (!isMockMode || isMockFinished || mockPaused) return;
            mockAnswers[mockId] = [optionIndex];
            const cardEl = document.getElementById(`mock-card-${mockId}`);
            if (cardEl) {
                cardEl.querySelectorAll('.mock-option').forEach(el => el.classList.remove('selected'));
                const target = cardEl.querySelector(`.mock-option[data-option-index="${optionIndex}"]`);
                if (target) target.classList.add('selected');
            }
            updateMockHeaderSummary();
        }

        function isSameAnswer(a, b) {
            if (!Array.isArray(a) || !Array.isArray(b)) return false;
            if (a.length !== b.length) return false;
            const s1 = [...a].sort((x, y) => x - y);
            const s2 = [...b].sort((x, y) => x - y);
            for (let i = 0; i < s1.length; i++) {
                if (s1[i] !== s2[i]) return false;
            }
            return true;
        }

        function renderMockExam() {
            if (!isMockMode) return;
            const listEl = document.getElementById('questionList');
            if (mockQuestions.length === 0) {
                listEl.innerHTML = '<p style="text-align:center; padding:50px; color:#64748b;">출제된 문제가 없습니다.</p>';
                updateMockHeaderSummary();
                return;
            }

            let correctCount = 0;
            listEl.innerHTML = mockQuestions.map((q, idx) => {
                const selected = mockAnswers[q.mockId] || [];
                const correct = isSameAnswer(selected, q.answer);
                if (isMockFinished && correct) correctCount++;
                const answerSet = new Set(q.answer);
                const selectedSet = new Set(selected);
                const memoKey = getQuestionMemoKey(q);
                const memoText = getQuestionMemo(q);
                const memoHtml = memoText ? `<div class="memo-preview"><div class="memo-preview-title">📝 내 메모</div><div>${renderMemoText(memoText)}</div></div>` : '';

                const optionsHtml = q.options.map((opt, i) => {
                    const optionNo = i + 1;
                    const classes = ['mock-option'];
                    if (selectedSet.has(optionNo)) classes.push('selected');
                    if (isMockFinished && answerSet.has(optionNo)) classes.push('correct');
                    if (isMockFinished && selectedSet.has(optionNo) && !answerSet.has(optionNo)) classes.push('wrong');
                    return `<div class="${classes.join(' ')}" data-option-index="${optionNo}" onclick="toggleMockOption('${q.mockId}', ${optionNo})" style="padding:12px; border:1px solid var(--border); border-radius:8px; background:rgba(0,0,0,0.02); font-size:0.95em; cursor:${(isMockFinished || mockPaused) ? 'default' : 'pointer'};"><span style="font-weight:bold; margin-right:5px;">${optionNo}.</span> ${opt}</div>`;
                }).join('');

                return `
                <div class="q-card" id="mock-card-${q.mockId}">
                    <div class="q-header">
                        <small style="color:#64748b">${idx + 1}번 | ${q.session} | ${q.subject} | 원문항 ${q.number}번</small>
                        ${isMockFinished ? `<button class="memo-icon-btn" type="button" onclick="toggleMemoEditor(this)" title="메모 입력" aria-label="메모 입력">📝</button>` : ''}
                    </div>
                    ${isMockFinished ? `
                    <div class="memo-editor" data-memo-key="${memoKey}" style="display:none;">
                        <textarea class="memo-textarea" placeholder="이 문제에 대한 메모를 입력하세요..." oninput="saveMemo(this)">${escapeHtml(memoText)}</textarea>
                    </div>
                    ` : ''}
                    <div class="q-title" style="font-weight:bold; margin: 15px 0; font-size:1.1em; line-height:1.6;">${q.question}</div>
                    ${q.box ? `<div class="inner-box">${q.box}</div>` : ''}
                    ${q.tableData ? `
                        <table class="quiz-table">
                            ${q.tableData.map((row, rowIdx) => `<tr>${row.map(cell => `<${rowIdx === 0 ? 'th' : 'td'}>${cell}</${rowIdx === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}
                        </table>
                    ` : ''}
                    ${q.image ? `<img src="images/${q.image}" style="max-width:100%; border-radius:8px; margin-bottom:15px; display:block;">` : ''}
                    <div class="options-list" style="display:grid; gap:8px; margin: 20px 0;">
                        ${optionsHtml}
                    </div>
                    ${isMockFinished ? `<div style="font-weight:bold; color:${correct ? '#166534' : '#b91c1c'};">${correct ? '정답' : `오답 (정답: ${q.answer.join(', ')})`}</div><div class="memo-preview-target">${memoHtml}</div>` : ''}
                </div>
            `;
            }).join('');

            if (isMockFinished) {
                const scoreEl = document.createElement('div');
                scoreEl.className = 'q-card';
                scoreEl.innerHTML = `<div style="font-size:1.1em; font-weight:bold;">모의고사 결과: ${correctCount} / ${mockQuestions.length}</div>`;
                listEl.prepend(scoreEl);
            }
            updateMockHeaderSummary();
        }

        function highlightText(text, keywords) {
            if (!keywords || keywords.length === 0 || !text) return text;
            let highlighted = text;
            keywords.forEach(word => {
                if (!word) return;
                const regex = new RegExp(`(${word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
                highlighted = highlighted.replace(regex, `<mark style="background-color: #ffeb3b">$1</mark>`);
            });
            return highlighted;
        }

        function getQuestionMemoKey(q) {
            return q.id || `${q.session}|${q.subject}|${q.number}`;
        }

        function getQuestionMemo(q) {
            const key = getQuestionMemoKey(q);
            return (questionMemos[key] || '').trim();
        }

        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function renderMemoText(text) {
            return escapeHtml(text).replace(/\n/g, '<br>');
        }

        function processAndRender() {
            if (appMode === 'mock') {
                if (isMockMode) {
                    renderMockExam();
                } else {
                    document.getElementById('questionList').innerHTML = '<p style="text-align:center; padding:40px; color:#64748b;">모의고사 설정 후 시작 버튼을 눌러 주세요.</p>';
                    updateMockHeaderSummary();
                }
                return;
            }
            let res = questions;

            // 1. 세션 및 과목 필터링
            if (selectedSessions.size) res = res.filter(q => selectedSessions.has(q.session));
            if (selectedSubjects.size) res = res.filter(q => selectedSubjects.has(q.subject));
            if (selectedSubsubjects.size) {
                res = res.filter(q =>
                    q.subject === '수목관리학' &&
                    Array.isArray(q.tags) &&
                    [...selectedSubsubjects].some(tag => q.tags.includes(tag))
                );
            }

            // 2. 검색어 처리 및 이스터 에그 키워드 분리
            const searchVal = document.getElementById('searchInput').value.trim().toLowerCase();
            const rawKeywords = searchVal ? searchVal.split(/\s+/).filter(kw => kw !== '') : [];

            // 랜덤 트리거 단어 정의
            const randomTriggers = ["rand", "random", "랜덤", "무작위"];
            const hasRandomTrigger = rawKeywords.some(kw => randomTriggers.includes(kw));

            // 실제 검색에 사용할 키워드 (랜덤 트리거 단어는 제외)
            const searchKeywords = rawKeywords.filter(kw => !randomTriggers.includes(kw));

            // 3. 텍스트 검색 필터링
            if (searchKeywords.length > 0) {
                res = res.filter(q => {
                    const targetText = (q.question + q.options.join(' ') + (q.box || '')).toLowerCase();
                    return searchKeywords.every(kw => targetText.includes(kw));
                });
            }

            // 4. 정렬 로직 (이스터 에그 적용)
            if (hasRandomTrigger) {
                // 랜덤 정렬 (Fisher-Yates 알고리즘 방식의 간이 구현)
                res = res.sort(() => Math.random() - 0.5);
            } else {
                // 기본 정렬: 회차 순 -> 번호 순
                res.sort((a, b) => a.session.localeCompare(b.session, undefined, { numeric: true }) || a.number - b.number);
            }

            // 5. UI 업데이트
            const summary = [];
            if (selectedSessions.size) summary.push(`회차 ${selectedSessions.size}`);
            if (selectedSubjects.size) summary.push(`과목 ${selectedSubjects.size}`);
            if (selectedSubsubjects.size) summary.push(`부과목 ${selectedSubsubjects.size}`);
            if (searchKeywords.length) summary.push(`검색어 ${searchKeywords.length}`);
            if (hasRandomTrigger) summary.push(`🔀 랜덤 모드`);

            document.getElementById('filterSummary').innerText = summary.length ? summary.join(', ') : '전체 보기';
            document.getElementById('headerResultCount').innerText = `(${res.length}건)`;

            // 하이라이트 처리를 위해 검색 키워드만 전달
            renderQuestions(res, searchKeywords);
        }

        function renderQuestions(data, keywords = []) {
            const listEl = document.getElementById('questionList');
            if (data.length === 0) {
                listEl.innerHTML = '<p style="text-align:center; padding:50px; color:#64748b;">조건에 맞는 문제가 없습니다.</p>';
                return;
            }

            listEl.innerHTML = data.map(q => {
                const displayQuestion = highlightText(q.question, keywords);
                const displayBox = q.box ? highlightText(q.box, keywords) : '';
                const displayOptions = q.options.map(opt => highlightText(opt, keywords));
                const memoKey = getQuestionMemoKey(q);
                const memoText = getQuestionMemo(q);
                const memoHtml = memoText ? `<div class="memo-preview"><div class="memo-preview-title">📝 내 메모</div><div>${renderMemoText(memoText)}</div></div>` : '';

                return `
                <div class="q-card">
                    <div class="q-header">
                        <small style="color:#64748b">${q.session} | ${q.subject} | ${q.number}번</small>
                        <button class="memo-icon-btn" type="button" onclick="toggleMemoEditor(this)" title="메모 입력" aria-label="메모 입력">📝</button>
                    </div>
                    <div class="memo-editor" data-memo-key="${memoKey}" style="display:none;">
                        <textarea class="memo-textarea" placeholder="이 문제에 대한 메모를 입력하세요..." oninput="saveMemo(this)">${escapeHtml(memoText)}</textarea>
                    </div>
                    <div class="q-title" style="font-weight:bold; margin: 15px 0; font-size:1.1em; line-height:1.6;">${displayQuestion}</div>
                    ${q.box ? `<div class="inner-box">${displayBox}</div>` : ''}
                    ${q.tableData ? `
                        <table class="quiz-table">
                            ${q.tableData.map((row, idx) => `<tr>${row.map(cell => `<${idx === 0 ? 'th' : 'td'}>${cell}</${idx === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}
                        </table>
                    ` : ''}
                    ${q.image ? `<img src="images/${q.image}" style="max-width:100%; border-radius:8px; margin-bottom:15px; display:block;">` : ''}
                    <div class="options-list" style="display:grid; gap:8px; margin: 20px 0;">
                        ${displayOptions.map((opt, i) => `<div style="padding:12px; border:1px solid var(--border); border-radius:8px; background:rgba(0,0,0,0.02); font-size:0.95em;"><span style="font-weight:bold; margin-right:5px;">${i + 1}.</span> ${opt}</div>`).join('')}
                    </div>
                    <button class="btn-ans" onclick="toggleAns(this)">정답 확인</button>
                    <div class="ans-section">
                        <div style="font-weight:bold; color:#166534; font-size:1.1em;">정답: ${q.answer}</div>
                        ${memoHtml}
                    </div>
                </div>
            `;
            }).join('');
        }

        function toggleAns(btn) {
            const target = btn.nextElementSibling;
            target.style.display = (target.style.display === 'block') ? 'none' : 'block';
        }

        function toggleMemoEditor(btn) {
            const card = btn.closest('.q-card');
            if (!card) return;
            const editor = card.querySelector('.memo-editor');
            if (!editor) return;
            const isOpen = editor.style.display === 'block';
            editor.style.display = isOpen ? 'none' : 'block';
            if (!isOpen) {
                const ta = editor.querySelector('.memo-textarea');
                if (ta) ta.focus();
            }
        }

        function saveMemo(textarea) {
            const editor = textarea.closest('.memo-editor');
            const card = textarea.closest('.q-card');
            if (!editor || !card) return;
            const key = editor.dataset.memoKey;
            if (!key) return;
            const value = textarea.value || '';
            if (value.trim()) {
                questionMemos[key] = value.trim();
            } else {
                delete questionMemos[key];
            }
            localStorage.setItem('questionMemos', JSON.stringify(questionMemos));

            const previewTarget = card.querySelector('.ans-section') || card.querySelector('.memo-preview-target');
            if (!previewTarget) return;
            const existingPreview = previewTarget.querySelector('.memo-preview');
            const memoText = (questionMemos[key] || '').trim();

            if (memoText) {
                const html = `<div class="memo-preview"><div class="memo-preview-title">📝 내 메모</div><div>${renderMemoText(memoText)}</div></div>`;
                if (existingPreview) {
                    existingPreview.outerHTML = html;
                } else {
                    previewTarget.insertAdjacentHTML('beforeend', html);
                }
            } else if (existingPreview) {
                existingPreview.remove();
            }
        }

        function resetAll() {
            selectedSessions.clear(); selectedSubjects.clear(); selectedSubsubjects.clear();
            document.getElementById('searchInput').value = '';
            document.querySelectorAll('#sessionGroup .tag, #subjectGroup .tag, #subsubjectGroup .tag').forEach(t => t.classList.remove('active'));
            updateSubsubjectVisibility();

            resetMockState();
            selectedMockSubjects = new Set();
            document.querySelectorAll('#mockSubjectGroup .tag').forEach(t => t.classList.add('active'));
            document.querySelectorAll('#mockSubjectGroup .tag').forEach(t => selectedMockSubjects.add(t.innerText.trim()));

            if (appMode === 'mock') {
                document.getElementById('questionList').innerHTML = '<p style="text-align:center; padding:40px; color:#64748b;">모의고사 설정 후 시작 버튼을 눌러 주세요.</p>';
                updateMockHeaderSummary();
            } else {
                processAndRender();
            }
        }

        window.onscroll = function () {
            const btn = document.getElementById("btnTop");
            btn.style.display = (window.scrollY > 200) ? "block" : "none";
        };

        function toggleHelp(event, show) {
            if (event) event.stopPropagation();
            document.getElementById('helpModal').style.display = show ? 'flex' : 'none';
        }

        function copyEmail(el) {
            navigator.clipboard.writeText(el.innerText.trim()).then(() => {
                const msg = document.getElementById('copyMessage');
                msg.style.display = 'inline';
                setTimeout(() => msg.style.display = 'none', 2000);
            });
        }

        // 상태 관리를 위한 변수
        let currentFocusIndex = -1;
        let lastMoveTime = 0;

        document.addEventListener('keydown', function (e) {
            const searchInput = document.getElementById('searchInput');
            const filterPanel = document.getElementById('filterPanel');
            const cards = document.querySelectorAll('.q-card');
            const activeEl = document.activeElement;

            if (activeEl && activeEl.classList && activeEl.classList.contains('memo-textarea')) return;

            if (appMode === 'normal' && document.activeElement === searchInput && e.key !== 'Enter') return;

            if (e.key === 'Enter') {
                if (filterPanel.classList.contains('collapsed')) {
                    filterPanel.classList.remove('collapsed');
                    if (appMode === 'normal') {
                        setTimeout(() => searchInput.focus(), 100);
                    }
                } else {
                    filterPanel.classList.add('collapsed');
                    if (searchInput) searchInput.blur();
                }
                return;
            }

            if (cards.length > 0 && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
                const now = Date.now();
                if (now - lastMoveTime < 150) {
                    e.preventDefault();
                    return;
                }
                lastMoveTime = now;
                e.preventDefault();

                // --- 핵심 수정 부분: 현재 화면 중앙에 가장 가까운 카드 찾기 ---
                if (currentFocusIndex === -1) {
                    let closestIdx = 0;
                    let minDistance = Infinity;
                    const centerY = window.innerHeight / 2;

                    cards.forEach((card, idx) => {
                        const rect = card.getBoundingClientRect();
                        const cardCenter = rect.top + rect.height / 2;
                        const distance = Math.abs(centerY - cardCenter);
                        if (distance < minDistance) {
                            minDistance = distance;
                            closestIdx = idx;
                        }
                    });
                    currentFocusIndex = closestIdx;
                } else {
                    // 이미 포커스가 있는 상태에서 이동
                    if (e.key === 'ArrowRight') {
                        currentFocusIndex = Math.min(currentFocusIndex + 1, cards.length - 1);
                    } else if (e.key === 'ArrowLeft') {
                        currentFocusIndex = Math.max(currentFocusIndex - 1, 0);
                    }
                }
                // -------------------------------------------------------

                cards[currentFocusIndex].scrollIntoView({ behavior: 'smooth', block: 'center' });

                cards.forEach(c => {
                    c.style.borderColor = 'var(--border)';
                    c.style.boxShadow = 'none';
                });
                const activeCard = cards[currentFocusIndex];
                activeCard.style.borderColor = 'var(--primary)';
                activeCard.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.3)';
            }

            if (e.key === ' ' && currentFocusIndex >= 0) {
                e.preventDefault();
                const cards = document.querySelectorAll('.q-card');
                const activeCard = cards[currentFocusIndex];
                if (activeCard) {
                    const btn = activeCard.querySelector('.btn-ans');
                    if (btn) toggleAns(btn);
                }
            }
        });

        // 사용자가 직접 스크롤을 할 경우, 기존의 포커스 인덱스를 초기화하여 
        // 다음 화살표 입력 시 화면 기준 탐색이 다시 작동하게 합니다.
        window.addEventListener('scroll', () => {
            if (Date.now() - lastMoveTime > 1000) { // 화살표 이동 중이 아닐 때만
                currentFocusIndex = -1;
            }
        }, { passive: true });

        loadData();
