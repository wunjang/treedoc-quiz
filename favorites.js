(function () {
    const FAVORITE_FILTER_VALUE = '__favorite__';
    const FAVORITE_FILTER_LABEL = '\uC990\uACA8\uCC3E\uAE30';
    const STORAGE_KEY = 'favoriteQuestions';

    let favoriteQuestions = {};
    let forceFavoriteFilterDuringRender = false;

    function loadFavorites() {
        try {
            favoriteQuestions = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            favoriteQuestions = {};
        }
    }

    function saveFavorites() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(favoriteQuestions));
    }

    function getQuestionKeyFromData(q) {
        if (!q) return '';
        return q.id || `${q.session}|${q.subject}|${q.number}`;
    }

    function isFavoriteKey(key) {
        return !!favoriteQuestions[key];
    }

    function isFavoriteQuestion(q) {
        return isFavoriteKey(getQuestionKeyFromData(q));
    }

    function getSelectedSessionsSet() {
        try {
            return (typeof selectedSessions !== 'undefined' && selectedSessions instanceof Set)
                ? selectedSessions
                : null;
        } catch (e) {
            return null;
        }
    }

    function isFavoriteSessionSelected() {
        const sessions = getSelectedSessionsSet();
        return sessions instanceof Set && sessions.has(FAVORITE_FILTER_VALUE);
    }

    function toggleFavoriteFilter() {
        const sessions = getSelectedSessionsSet();
        if (!(sessions instanceof Set)) return;
        if (sessions.has(FAVORITE_FILTER_VALUE)) {
            sessions.delete(FAVORITE_FILTER_VALUE);
        } else {
            sessions.add(FAVORITE_FILTER_VALUE);
        }
        if (typeof window.processAndRender === 'function') window.processAndRender();
    }

    function updateFavoriteSessionTag() {
        const group = document.getElementById('sessionGroup');
        const sessions = getSelectedSessionsSet();
        if (!group || !(sessions instanceof Set)) return;

        const hasFavorites = Object.keys(favoriteQuestions).length > 0;
        let tag = group.querySelector('[data-favorite-session-tag="1"]');

        if (!hasFavorites) {
            if (sessions.has(FAVORITE_FILTER_VALUE)) {
                sessions.delete(FAVORITE_FILTER_VALUE);
            }
            if (tag) tag.remove();
            return;
        }

        if (!tag) {
            tag = document.createElement('div');
            tag.className = 'tag session';
            tag.dataset.favoriteSessionTag = '1';
            tag.textContent = FAVORITE_FILTER_LABEL;
            tag.onclick = function () { toggleFavoriteFilter(); };
            group.appendChild(tag);
        }
        tag.classList.toggle('active', isFavoriteSessionSelected());
    }

    function updateFavoriteButtonsInDom() {
        const cards = document.querySelectorAll('#questionList .q-card');
        cards.forEach((card) => {
            const header = card.querySelector('.q-header');
            const memoBtn = header ? header.querySelector('.memo-icon-btn') : null;
            const editor = card.querySelector('.memo-editor');
            const key = editor ? editor.dataset.memoKey : '';
            if (!header || !memoBtn || !key) return;

            const textarea = editor ? editor.querySelector('.memo-textarea') : null;
            const syncMemoState = function () {
                const hasMemo = !!(textarea && textarea.value && textarea.value.trim());
                memoBtn.classList.toggle('active', hasMemo);
            };

            if (textarea && !textarea.dataset.memoStateBound) {
                textarea.addEventListener('input', syncMemoState);
                textarea.dataset.memoStateBound = '1';
            }
            syncMemoState();

            let actionsWrap = header.querySelector('.q-action-buttons');
            if (!actionsWrap) {
                actionsWrap = document.createElement('div');
                actionsWrap.className = 'q-action-buttons';
                memoBtn.parentNode.insertBefore(actionsWrap, memoBtn);
                actionsWrap.appendChild(memoBtn);
            }

            let favoriteBtn = actionsWrap.querySelector('.favorite-icon-btn');
            if (!favoriteBtn) {
                favoriteBtn = document.createElement('button');
                favoriteBtn.type = 'button';
                favoriteBtn.className = 'favorite-icon-btn';
                favoriteBtn.title = FAVORITE_FILTER_LABEL;
                favoriteBtn.setAttribute('aria-label', FAVORITE_FILTER_LABEL);
                favoriteBtn.innerHTML = '&#9733;';
                favoriteBtn.onclick = function (event) {
                    if (event) {
                        event.preventDefault();
                        event.stopPropagation();
                    }
                    const shouldRerender = isFavoriteSessionSelected();
                    if (isFavoriteKey(key)) {
                        delete favoriteQuestions[key];
                    } else {
                        favoriteQuestions[key] = true;
                    }
                    saveFavorites();
                    updateFavoriteSessionTag();
                    favoriteBtn.classList.toggle('active', isFavoriteKey(key));
                    if (shouldRerender && typeof window.processAndRender === 'function') {
                        window.processAndRender();
                    }
                };
                actionsWrap.appendChild(favoriteBtn);
            }
            favoriteBtn.classList.toggle('active', isFavoriteKey(key));
        });
    }

    function patchFunctions() {
        const originalInitFilters = window.initFilters;
        if (typeof originalInitFilters === 'function' && !originalInitFilters.__favorite_patched) {
            window.initFilters = function () {
                originalInitFilters.apply(this, arguments);
                updateFavoriteSessionTag();
            };
            window.initFilters.__favorite_patched = true;
        }

        const originalRenderQuestions = window.renderQuestions;
        if (typeof originalRenderQuestions === 'function' && !originalRenderQuestions.__favorite_patched) {
            window.renderQuestions = function (data, keywords) {
                let nextData = data;
                if (isFavoriteSessionSelected() || forceFavoriteFilterDuringRender) {
                    nextData = (Array.isArray(data) ? data : []).filter(isFavoriteQuestion);
                }
                originalRenderQuestions.call(this, nextData, keywords);
                updateFavoriteButtonsInDom();
            };
            window.renderQuestions.__favorite_patched = true;
        }

        const originalRenderMockExam = window.renderMockExam;
        if (typeof originalRenderMockExam === 'function' && !originalRenderMockExam.__favorite_patched) {
            window.renderMockExam = function () {
                originalRenderMockExam.apply(this, arguments);
                updateFavoriteButtonsInDom();
            };
            window.renderMockExam.__favorite_patched = true;
        }

        const originalProcessAndRender = window.processAndRender;
        if (typeof originalProcessAndRender === 'function' && !originalProcessAndRender.__favorite_patched) {
            window.processAndRender = function () {
                const sessions = getSelectedSessionsSet();
                const hasFavoriteOnly = sessions instanceof Set
                    && sessions.has(FAVORITE_FILTER_VALUE)
                    && sessions.size === 1;

                if (hasFavoriteOnly) {
                    forceFavoriteFilterDuringRender = true;
                    sessions.delete(FAVORITE_FILTER_VALUE);
                }

                originalProcessAndRender.apply(this, arguments);

                if (hasFavoriteOnly) {
                    sessions.add(FAVORITE_FILTER_VALUE);
                    forceFavoriteFilterDuringRender = false;
                }

                updateFavoriteSessionTag();
                if (window.appMode !== 'mock') {
                    updateFavoriteButtonsInDom();
                    const summaryEl = document.getElementById('filterSummary');
                    const countEl = document.getElementById('headerResultCount');
                    if (summaryEl && isFavoriteSessionSelected() && !summaryEl.innerText.includes(FAVORITE_FILTER_LABEL)) {
                        summaryEl.innerText = summaryEl.innerText ? `${summaryEl.innerText}, ${FAVORITE_FILTER_LABEL}` : FAVORITE_FILTER_LABEL;
                    }
                    if (countEl && isFavoriteSessionSelected()) {
                        const count = document.querySelectorAll('#questionList .q-card').length;
                        countEl.innerText = `(${count}개)`;
                    }
                }
            };
            window.processAndRender.__favorite_patched = true;
        }
    }

    function boot() {
        loadFavorites();
        patchFunctions();
        updateFavoriteSessionTag();
        updateFavoriteButtonsInDom();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
