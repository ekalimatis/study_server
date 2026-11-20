(function() {
    'use strict';

    const courseListEl = document.getElementById('courseList');
    const placeholder = document.getElementById('placeholder');
    const rendered = document.getElementById('renderedContent');
    const refreshBtn = document.getElementById('refreshBtn');
    const sidebar = document.getElementById('sidebar');
    const mainContent = document.getElementById('mainContent');
    const backBtn = document.getElementById('backBtn');
    const viewer = document.getElementById('viewer');
    const breadcrumbText = document.getElementById('breadcrumbText');
    const layout = document.getElementById('layout');
    const collapseBtn = document.getElementById('collapseBtn');
    const expandBtn = document.getElementById('expandBtn');
    const mobileMenuBtn = document.getElementById('mobileMenuBtn');
    const sidebarBackdrop = document.getElementById('sidebarBackdrop');
    const accountUser = document.getElementById('accountUser');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminLink = document.getElementById('adminLink');
    const mobileQuery = window.matchMedia
        ? window.matchMedia('(max-width: 768px)')
        : { matches: window.innerWidth <= 768 };

    let identity = null;
    let currentCourse = null;
    let currentDay = null;
    let currentTab = null; // 'plan' | 'theory' | 'practice' | 'materials'
    let coursesData = [];
    let dayTopics = {}; // courseId -> { dayNum: тема }
    let initialDrawerShown = false;

    function isMobileViewport() {
        return mobileQuery.matches;
    }

    function redirectToLogin() {
        const next = window.location.pathname + window.location.search;
        window.location.replace('/login?next=' + encodeURIComponent(next));
    }

    function updateAccountUi() {
        if (!identity) return;
        const roleLabels = {
            chief: 'Главный администратор',
            admin: 'Администратор',
            user: 'Пользователь'
        };
        const groupName = identity.group && identity.group.name ? ' · ' + identity.group.name : '';
        if (accountUser) {
            accountUser.textContent = identity.username + ' · ' + (roleLabels[identity.role] || identity.role) + groupName;
        }
        if (adminLink) {
            adminLink.style.display = identity.role === 'user' ? 'none' : '';
        }
    }

    async function loadSession() {
        const response = await fetch('/api/session', { cache: 'no-store' });
        if (!response.ok) throw new Error('Не удалось проверить сессию');
        const data = await response.json();
        if (!data.authenticated) {
            redirectToLogin();
            throw new Error('redirect');
        }
        identity = data;
        updateAccountUi();
    }

    async function logout() {
        try {
            await fetch('/api/logout', { method: 'POST' });
        } catch (error) {
            /* ignore */
        }
        window.location.replace('/login');
    }

    function openSidebar(focus) {
        if (!isMobileViewport()) return;
        sidebar.classList.add('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.add('open');
        document.body.classList.add('drawer-open');
        if (mobileMenuBtn) {
            mobileMenuBtn.setAttribute('aria-expanded', 'true');
            mobileMenuBtn.setAttribute('aria-label', 'Закрыть список курсов');
        }
        if (focus && collapseBtn) collapseBtn.focus({ preventScroll: true });
    }

    function closeSidebar(restoreFocus) {
        sidebar.classList.remove('open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('open');
        document.body.classList.remove('drawer-open');
        if (mobileMenuBtn) {
            mobileMenuBtn.setAttribute('aria-expanded', 'false');
            mobileMenuBtn.setAttribute('aria-label', 'Открыть список курсов');
        }
        if (restoreFocus && isMobileViewport() && mobileMenuBtn) {
            mobileMenuBtn.focus({ preventScroll: true });
        }
    }

    function scrollViewerIntoView() {
        if (!isMobileViewport()) return;
        const viewerEl = document.getElementById('viewer');
        if (viewerEl) viewerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // --- Вспомогательные функции ---
    function getCourseTitle(courseId) {
        const course = coursesData.find(c => c.id === courseId);
        return course ? course.title : courseId;
    }

    function pluralDays(n) {
        const n10 = n % 10;
        const n100 = n % 100;
        if (n10 === 1 && n100 !== 11) return 'день';
        if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'дня';
        return 'дней';
    }

    // --- Интерактивные задания из блоков ```quiz ... ``` ---
    function normalizeQuizText(value) {
        return String(value == null ? '' : value)
            .trim()
            .toLowerCase()
            .replace(/[’‘]/g, "'")
            .replace(/\s+/g, ' ')
            .replace(/[.!?]+$/g, '');
    }

    function renderQuizItem(q, uid) {
        const type = ['single', 'multiple', 'text'].includes(q.type) ? q.type : 'single';
        const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, '-');
        const id = `quiz-${safeUid}`;
        const question = escapeHtml(q.question || '');
        const hint = q.hint ? `<div class="quiz-hint">${escapeHtml(q.hint)}</div>` : '';
        const answer = type === 'text'
            ? (Array.isArray(q.answers) ? q.answers : [q.answers == null ? '' : q.answers])
            : q.answer;
        const data = escapeHtml(JSON.stringify({
            type: type,
            answer: answer,
            explanation: q.explanation || ''
        }));

        let body = '';
        if (type === 'text') {
            body = `<input type="text" class="quiz-input" id="${id}-input" placeholder="${escapeHtml(q.placeholder || 'Ваш ответ')}" aria-label="${escapeHtml(q.question || 'Ответ')}" autocomplete="off">`;
        } else {
            const options = (Array.isArray(q.options) ? q.options : []).map((opt, i) => `
                <label class="quiz-option" for="${id}-opt-${i}">
                    <input type="checkbox" id="${id}-opt-${i}" value="${i}" data-quiz-option>
                    <span>${escapeHtml(opt)}</span>
                </label>`).join('');
            body = `<div class="quiz-options">${options}</div>`;
        }

        return `
            <div class="quiz" data-quiz data-quiz-type="${type}" data-quiz-id="${escapeHtml(q.id || id)}" data-quiz-data="${data}">
                <div class="quiz-question">${question}</div>
                ${hint}
                ${body}
                <div class="quiz-actions">
                    <button type="button" class="quiz-check">Проверить</button>
                </div>
                <div class="quiz-feedback" aria-live="polite"></div>
            </div>`;
    }

    function renderQuizBlock(raw, idx) {
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            return `<div class="quiz quiz-error">Не удалось разобрать задание: ${escapeHtml(e.message)}</div>`;
        }

        const isArray = Array.isArray(data);
        const items = (isArray ? data : [data]).filter(q => q && typeof q === 'object');
        if (!items.length) {
            return `<div class="quiz quiz-error">Пустое задание.</div>`;
        }
        const rendered = items.map((q, i) => renderQuizItem(q, `${idx}-${i}`)).join('');

        if (isArray) {
            return `<div class="quiz-group" data-quiz-group>
                <div class="quiz-group-score" aria-live="polite">Верно: 0 из ${items.length} · порог 80%</div>
                ${rendered}
            </div>`;
        }
        return rendered;
    }

    function updateQuizGroupScore(quiz) {
        const group = quiz.closest('[data-quiz-group]');
        if (!group) return;
        const total = group.querySelectorAll('.quiz').length;
        const correct = group.querySelectorAll('.quiz[data-correct="true"]').length;
        const score = group.querySelector('.quiz-group-score');
        if (score) score.textContent = `Верно: ${correct} из ${total} · порог 80%`;
    }

    function updateStepFromQuizzes(quiz) {
        const step = quiz.closest('.practice-step');
        if (!step) return;

        const quizzes = Array.from(step.querySelectorAll('.quiz'));
        if (!quizzes.length) return;

        const correct = quizzes.filter(q => q.dataset.correct === 'true').length;
        const attempted = quizzes.filter(q => q.dataset.correct === 'true' || q.dataset.correct === 'false').length;
        const passed = attempted === quizzes.length && correct / quizzes.length >= 0.8;
        const cb = step.querySelector('.step-checkbox');
        if (!cb) return;

        if (passed && !cb.checked) {
            step.dataset.autoCompleted = '1';
            cb.checked = true;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (!passed) {
            const wasAutoCompleted = step.dataset.autoCompleted === '1';
            delete step.dataset.autoCompleted;
            if (wasAutoCompleted && cb.checked) {
                cb.checked = false;
                cb.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }

    function resetQuizFeedback(quiz) {
        if (!quiz) return;
        quiz.classList.remove('quiz-correct', 'quiz-incorrect');
        delete quiz.dataset.correct;
        const feedback = quiz.querySelector('.quiz-feedback');
        if (feedback) feedback.innerHTML = '';
        updateQuizGroupScore(quiz);
        updateStepFromQuizzes(quiz);
    }

    function checkQuiz(quiz) {
        if (!quiz) return;

        let data;
        try {
            data = JSON.parse(quiz.dataset.quizData || '{}');
        } catch (e) {
            return;
        }

        const type = data.type || quiz.dataset.quizType || 'single';
        let correct = false;
        let expectedText = '';

        if (type === 'text') {
            const input = quiz.querySelector('.quiz-input');
            const value = normalizeQuizText(input ? input.value : '');
            const answers = Array.isArray(data.answer) ? data.answer : [data.answer];
            correct = value !== '' && answers.some(a => normalizeQuizText(a) === value);
            expectedText = answers[0] || '';
        } else {
            const selected = Array.from(quiz.querySelectorAll('input[data-quiz-option]:checked'))
                .map(cb => parseInt(cb.value, 10))
                .sort((a, b) => a - b);
            const answers = (Array.isArray(data.answer) ? data.answer : [data.answer])
                .map(Number)
                .sort((a, b) => a - b);
            correct = selected.length === answers.length && selected.every((v, i) => v === answers[i]);
            const optionTexts = Array.from(quiz.querySelectorAll('.quiz-option span')).map(el => el.textContent);
            expectedText = answers.map(i => optionTexts[i]).filter(Boolean).join('; ');
        }

        quiz.classList.toggle('quiz-correct', correct);
        quiz.classList.toggle('quiz-incorrect', !correct);
        quiz.dataset.correct = correct ? 'true' : 'false';

        const feedback = quiz.querySelector('.quiz-feedback');
        if (feedback) {
            const explanation = data.explanation ? ` ${escapeHtml(data.explanation)}` : '';
            if (correct) {
                feedback.innerHTML = `<strong>Верно.</strong>${explanation}`;
            } else {
                const answerHtml = expectedText ? ` Правильный ответ: <strong>${escapeHtml(expectedText)}</strong>.` : '';
                feedback.innerHTML = `<strong>Неверно.</strong>${answerHtml}${explanation}`;
            }
        }

        updateQuizGroupScore(quiz);
        updateStepFromQuizzes(quiz);
    }

    // --- Горизонтальная прокрутка таблиц на узких экранах ---
    function wrapTables(html) {
        html = html.replace(/<table(\s[^>]*)?>/gi, '<div class="table-wrap"><table$1>');
        html = html.replace(/<\/table>/gi, '</table></div>');
        return html;
    }

    // --- Рендеринг Markdown с поддержкой блоков {info}/{note}/{warning}/{tip} ---
    function renderMarkdown(markdown) {
        const quizzes = [];
        markdown = markdown.replace(/```quiz[^\n]*\n([\s\S]*?)```/g, function(match, body) {
            const idx = quizzes.length;
            quizzes.push(body);
            return `\n\n@@QUIZ_${idx}@@\n\n`;
        });

        const callouts = [];
        markdown = markdown.replace(/\{(info|note|warning|tip)\}([\s\S]*?)\{\/\1\}/g, function(match, type, content) {
            const idx = callouts.length;
            callouts.push({ type: type, html: marked.parse(content.trim()) });
            return `\n\n@@CALLOUT_${idx}@@\n\n`;
        });
        let html = marked.parse(markdown);
        function insertCallout(match, idx) {
            const c = callouts[parseInt(idx, 10)];
            return `<div class="callout ${c.type}">${c.html}</div>`;
        }
        html = html.replace(/<p>@@CALLOUT_(\d+)@@<\/p>/g, insertCallout);
        html = html.replace(/@@CALLOUT_(\d+)@@/g, insertCallout);

        function insertQuiz(match, idx) {
            return renderQuizBlock(quizzes[parseInt(idx, 10)], parseInt(idx, 10));
        }
        html = html.replace(/<p>@@QUIZ_(\d+)@@<\/p>/g, insertQuiz);
        html = html.replace(/@@QUIZ_(\d+)@@/g, insertQuiz);

        return wrapTables(html);
    }

    // --- Обновление хлебных крошек ---
    function updateBreadcrumb(parts) {
        // parts: массив объектов { text, click? (функция) }
        let html = '<span class="breadcrumb">';
        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            const text = escapeHtml(part.text);
            if (part.click && !isLast) {
                html += `<span class="crumb clickable" data-index="${index}">${text}</span>`;
            } else {
                html += `<span class="crumb ${isLast ? 'current' : ''}">${text}</span>`;
            }
            if (!isLast) {
                html += '<span class="sep"> → </span>';
            }
        });
        html += '</span>';
        breadcrumbText.innerHTML = html;

        // Навешиваем обработчики на кликабельные крошки
        breadcrumbText.querySelectorAll('.crumb.clickable').forEach(el => {
            const idx = parseInt(el.dataset.index);
            el.addEventListener('click', function(e) {
                const part = parts[idx];
                if (part.click) part.click();
            });
        });
    }

    // --- Управление отображением ---
    function showCourseList() {
        sidebar.classList.remove('hidden');
        mainContent.classList.remove('expanded');
        backBtn.classList.remove('visible');
        currentDay = null;
        currentTab = null;
        document.getElementById('sidebarTitle').innerHTML = '<i class="fas fa-list"></i> Курсы';
        if (coursesData.length) renderCourseList(coursesData);
        if (!currentCourse) {
            placeholder.style.display = 'block';
            rendered.style.display = 'none';
            placeholder.innerHTML = '<i class="fas fa-file-alt"></i><p>Выберите курс из списка слева.</p>';
        }
        updateBreadcrumb([
            { text: 'Список курсов' }
        ]);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // --- Извлечение тем дней из main.md (заголовки "День N. Тема") ---
    function extractDayTopics(markdown) {
        const topics = {};
        const regex = /^#{2,3}\s+День\s+(\d+)[\.\s]*(.*)$/gim;
        let m;
        while ((m = regex.exec(markdown)) !== null) {
            const title = m[2].trim().replace(/<[^>]*>/g, '');
            if (title) topics[parseInt(m[1], 10)] = title;
        }
        return topics;
    }

    function ensureDayTopics(courseId, done) {
        fetch(`COURSE/${courseId}/main.md`)
            .then(res => res.ok ? res.text() : Promise.reject())
            .then(md => {
                dayTopics[courseId] = extractDayTopics(md);
                done();
            })
            .catch(() => {
                dayTopics[courseId] = {};
                done();
            });
    }

    // --- Навигация по курсу в сайдбаре: план дней с теорией и практикой ---
    function renderCourseNav(courseId, activeTab, day) {
        const course = coursesData.find(c => c.id === courseId);
        if (!course) return;
        if (dayTopics[courseId] === undefined) {
            ensureDayTopics(courseId, function() {
                if (currentCourse === courseId) {
                    renderCourseNav(courseId, currentTab, currentDay);
                }
            });
        }
        const topics = dayTopics[courseId] || {};
        document.getElementById('sidebarTitle').innerHTML = `<i class="fas fa-book-open"></i> ${escapeHtml(course.title)}`;
        const days = course.days || [];
        const isDayTab = activeTab === 'theory' || activeTab === 'practice';
        let html = '';
        html += `<div class="sidebar-nav">`;
        html += `<a href="#" class="plan-item ${activeTab === 'plan' ? 'active' : ''}" data-action="plan">
                    <i class="fas fa-map"></i> План курса
                </a>`;
        html += `<a href="#" class="plan-item ${activeTab === 'materials' ? 'active' : ''}" data-action="materials">
                    <i class="fas fa-link"></i> Дополнительные материалы
                </a>`;
        html += `</div>`;
        html += `<div class="course-days">`;
        days.forEach(d => {
            const dayActive = isDayTab && day === d;
            const theoryActive = dayActive && activeTab === 'theory';
            const practiceActive = dayActive && activeTab === 'practice';
            const topic = topics[d] ? escapeHtml(topics[d]) : '';
            html += `
                <div class="day-item ${dayActive ? 'active' : ''}">
                    <span class="day-name"><i class="far fa-calendar-alt"></i> День ${d}</span>
                    ${topic ? `<div class="day-topic">${topic}</div>` : ''}
                    <div class="day-actions">
                        <a href="#" class="theory-link ${theoryActive ? 'active' : ''}" data-course="${escapeHtml(courseId)}" data-day="${d}">
                            <i class="fas fa-book-open"></i> Теория
                        </a>
                        <a href="#" class="practice-link ${practiceActive ? 'active' : ''}" data-course="${escapeHtml(courseId)}" data-day="${d}">
                            <i class="fas fa-laptop-code"></i> Практика
                        </a>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        courseListEl.innerHTML = html;

        courseListEl.querySelectorAll('[data-action="plan"]').forEach(el => {
            el.addEventListener('click', function(e) {
                e.preventDefault();
                selectCourse(courseId);
            });
        });
        courseListEl.querySelectorAll('[data-action="materials"]').forEach(el => {
            el.addEventListener('click', function(e) {
                e.preventDefault();
                loadMaterials(courseId);
            });
        });
        courseListEl.querySelectorAll('.theory-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                loadTheory(this.dataset.course, parseInt(this.dataset.day, 10));
            });
        });
        courseListEl.querySelectorAll('.practice-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                loadPractice(this.dataset.course, parseInt(this.dataset.day, 10));
            });
        });
    }

    function showCoursePlan(courseId) {
        sidebar.classList.remove('hidden');
        mainContent.classList.remove('expanded');
        backBtn.classList.add('visible');
        currentDay = null;
        currentTab = 'plan';
        renderCourseNav(courseId, 'plan', null);
        const title = getCourseTitle(courseId);
        updateBreadcrumb([
            { text: 'Список курсов', click: () => backBtn.click() },
            { text: `Курс «${title}» — план` }
        ]);
    }

    function showTheory(courseId, day) {
        sidebar.classList.remove('hidden');
        mainContent.classList.remove('expanded');
        backBtn.classList.add('visible');
        currentDay = day;
        currentTab = 'theory';
        renderCourseNav(courseId, 'theory', day);
        const title = getCourseTitle(courseId);
        updateBreadcrumb([
            { text: 'Список курсов', click: () => backBtn.click() },
            { text: `Курс «${title}»`, click: () => selectCourse(courseId) },
            { text: `День ${day} — теория` }
        ]);
    }

    function showPractice(courseId, day) {
        sidebar.classList.remove('hidden');
        mainContent.classList.remove('expanded');
        backBtn.classList.add('visible');
        currentDay = day;
        currentTab = 'practice';
        renderCourseNav(courseId, 'practice', day);
        const title = getCourseTitle(courseId);
        updateBreadcrumb([
            { text: 'Список курсов', click: () => backBtn.click() },
            { text: `Курс «${title}»`, click: () => selectCourse(courseId) },
            { text: `День ${day} — практика` }
        ]);
    }

    function showMaterials(courseId) {
        sidebar.classList.remove('hidden');
        mainContent.classList.remove('expanded');
        backBtn.classList.add('visible');
        currentDay = null;
        currentTab = 'materials';
        renderCourseNav(courseId, 'materials', null);
        const title = getCourseTitle(courseId);
        updateBreadcrumb([
            { text: 'Список курсов', click: () => backBtn.click() },
            { text: `Курс «${title}»`, click: () => selectCourse(courseId) },
            { text: 'Дополнительные материалы' }
        ]);
    }

    // --- Загрузка дополнительных материалов курса ---
    function loadMaterials(courseId) {
        closeSidebar();
        fetch(`COURSE/${courseId}/materials.md`)
            .then(res => {
                if (!res.ok) throw new Error('materials.md не найден');
                return res.text();
            })
            .then(markdown => {
                try {
                    let html = renderMarkdown(markdown);
                    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
                    rendered.innerHTML = '<div class="materials-list">' + html + '</div>';
                    rendered.style.display = 'block';
                    placeholder.style.display = 'none';
                    rendered.querySelectorAll('.materials-list a').forEach(a => {
                        a.setAttribute('target', '_blank');
                        a.setAttribute('rel', 'noopener noreferrer');
                    });
                    insertNavButtons();
                    showMaterials(courseId);
                    document.getElementById('viewer').scrollIntoView({ behavior: 'smooth' });
                } catch (e) {
                    placeholder.style.display = 'block';
                    placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>Ошибка обработки материалов: ${e.message}</p>`;
                    rendered.style.display = 'none';
                }
            })
            .catch(err => {
                rendered.innerHTML = `
                    <div class="materials-empty">
                        <i class="fas fa-link"></i>
                        <h3>Дополнительные материалы пока не добавлены</h3>
                        <p>Чтобы добавить список, создайте в папке курса файл <code>${courseId}/materials.md</code>
                        и заполните его по структуре: заголовки разделов <code>## Название</code>
                        и пункты вида <code>- [Заголовок ссылки](https://адрес)</code>.</p>
                    </div>`;
                rendered.style.display = 'block';
                placeholder.style.display = 'none';
                insertNavButtons();
                showMaterials(courseId);
            });
    }

    // --- Кнопка "Назад" ---
    backBtn.addEventListener('click', function() {
        currentCourse = null;
        showCourseList();
        placeholder.style.display = 'block';
        placeholder.innerHTML = '<i class="fas fa-file-alt"></i><p>Выберите курс из списка слева.</p>';
        rendered.style.display = 'none';
        document.querySelectorAll('.course-card').forEach(c => c.classList.remove('active'));
        if (isMobileViewport()) openSidebar(true);
    });

    // --- Вспомогательная функция для вставки навигационных кнопок ---
    function insertNavButtons() {
        const oldNav = viewer.querySelector('.nav-buttons');
        if (oldNav) oldNav.remove();

        const navDiv = document.createElement('div');
        navDiv.className = 'nav-buttons';
        navDiv.innerHTML = `
            <button class="primary" id="backToPlanBtn"><i class="fas fa-arrow-left"></i> К плану курса</button>
            <button id="backToListBtn"><i class="fas fa-list"></i> К списку курсов</button>
        `;

        const sticky = rendered.querySelector('.practice-sticky');
        if (sticky) {
            sticky.insertBefore(navDiv, sticky.firstChild);
        } else {
            viewer.insertBefore(navDiv, viewer.firstChild);
        }

        document.getElementById('backToPlanBtn').addEventListener('click', function() {
            if (currentCourse) {
                selectCourse(currentCourse);
            }
        });
        document.getElementById('backToListBtn').addEventListener('click', function() {
            backBtn.click();
        });
    }

    // --- Загрузка списка курсов ---
    function loadCourses() {
        courseListEl.innerHTML = '<div style="padding:1rem; text-align:center; color:#94a3b8;"><i class="fas fa-spinner fa-spin"></i> Загрузка...</div>';
        fetch('/api/courses')
            .then(res => {
                if (res.status === 401) {
                    redirectToLogin();
                    throw new Error('redirect');
                }
                if (!res.ok) throw new Error('Ошибка загрузки списка курсов');
                return res.json();
            })
            .then(courses => {
                coursesData = courses;
                showCourseList();
                if (isMobileViewport() && !currentCourse && !initialDrawerShown) {
                    initialDrawerShown = true;
                    openSidebar(false);
                }
            })
            .catch(err => {
                if (err.message === 'redirect') return;
                courseListEl.innerHTML = `<div style="padding:1rem; text-align:center; color:#dc2626;">
                    <i class="fas fa-exclamation-triangle"></i> Ошибка: ${err.message}
                    <br><small>Убедитесь, что сервер запущен.</small>
                </div>`;
                updateBreadcrumb([{ text: 'Ошибка загрузки' }]);
            });
    }

    function renderCourseList(courses) {
        if (!courses.length) {
            courseListEl.innerHTML = '<div style="padding:1rem; text-align:center; color:#94a3b8;">Нет доступных курсов.</div>';
            return;
        }
        let html = '';
        for (const course of courses) {
            const active = currentCourse === course.id ? 'active' : '';
            html += `
                <div class="course-card ${active}" data-course="${escapeHtml(course.id)}">
                    <h3><i class="fas fa-folder"></i> ${escapeHtml(course.title)}</h3>
                    <p>${escapeHtml(course.description || 'Описание отсутствует')}</p>
                    <span class="days-badge"><i class="far fa-calendar-alt"></i> ${course.days.length} ${pluralDays(course.days.length)}</span>
                </div>
            `;
        }
        courseListEl.innerHTML = html;
        document.querySelectorAll('.course-card').forEach(card => {
            card.addEventListener('click', function() {
                const id = this.dataset.course;
                selectCourse(id);
            });
        });
    }

    // --- Выбор курса ---
    function selectCourse(courseId) {
        currentCourse = courseId;
        closeSidebar();
        showCoursePlan(courseId);
        document.querySelectorAll('.course-card').forEach(c => c.classList.remove('active'));
        const activeCard = document.querySelector(`.course-card[data-course="${courseId}"]`);
        if (activeCard) activeCard.classList.add('active');

        fetch(`COURSE/${courseId}/main.md`)
            .then(res => {
                if (!res.ok) throw new Error('main.md не найден');
                return res.text();
            })
            .then(markdown => {
                dayTopics[courseId] = extractDayTopics(markdown);
                renderMain(markdown, courseId);
                insertNavButtons();
                showCoursePlan(courseId); // обновим хлебные крошки после рендера
                scrollViewerIntoView();
            })
            .catch(err => {
                placeholder.style.display = 'block';
                placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>Ошибка загрузки плана: ${err.message}</p>`;
                rendered.style.display = 'none';
                const oldNav = viewer.querySelector('.nav-buttons');
                if (oldNav) oldNav.remove();
                updateBreadcrumb([
                    { text: 'Список курсов', click: () => backBtn.click() },
                    { text: 'Ошибка загрузки' }
                ]);
            });
    }

    // --- Рендеринг main.md ---
    function renderMain(markdown, courseId) {
        try {
            let html = renderMarkdown(markdown);
            html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
            rendered.innerHTML = html;
            rendered.style.display = 'block';
            placeholder.style.display = 'none';

            const headers = rendered.querySelectorAll('h2, h3');
            const course = coursesData.find(c => c.id === courseId);
            const days = course ? course.days : [];

            headers.forEach(header => {
                const text = header.textContent.trim();
                const match = text.match(/День\s*(\d+)/i);
                if (match) {
                    const dayNum = parseInt(match[1], 10);
                    if (days.includes(dayNum)) {
                        const linksDiv = document.createElement('div');
                        linksDiv.className = 'day-links-inline';
                        linksDiv.innerHTML = `
                            <a href="#" class="theory-link" data-course="${courseId}" data-day="${dayNum}">
                                <i class="fas fa-book-open"></i> Теория
                            </a>
                            <a href="#" class="practice-link" data-course="${courseId}" data-day="${dayNum}">
                                <i class="fas fa-laptop-code"></i> Практика
                            </a>
                        `;
                        header.parentNode.insertBefore(linksDiv, header.nextSibling);
                    }
                }
            });

            rendered.querySelectorAll('.theory-link').forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    loadTheory(this.dataset.course, this.dataset.day);
                });
            });
            rendered.querySelectorAll('.practice-link').forEach(link => {
                link.addEventListener('click', function(e) {
                    e.preventDefault();
                    loadPractice(this.dataset.course, this.dataset.day);
                });
            });

        } catch (e) {
            placeholder.style.display = 'block';
            placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>Ошибка парсинга Markdown: ${e.message}</p>`;
            rendered.style.display = 'none';
        }
    }

    // --- Загрузка теории ---
    function loadTheory(courseId, day) {
        closeSidebar();
        fetch(`COURSE/${courseId}/day${day}_theory.md`)
            .then(res => {
                if (!res.ok) throw new Error(`Теория дня ${day} не найдена`);
                return res.text();
            })
            .then(markdown => {
                try {
                    let html = renderMarkdown(markdown);
                    html = DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
                    rendered.innerHTML = html;
                    rendered.style.display = 'block';
                    placeholder.style.display = 'none';
                    insertNavButtons();
                    showTheory(courseId, day);
                    document.getElementById('viewer').scrollIntoView({ behavior: 'smooth' });
                } catch (e) {
                    placeholder.style.display = 'block';
                    placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>Ошибка парсинга: ${e.message}</p>`;
                    rendered.style.display = 'none';
                }
            })
            .catch(err => {
                placeholder.style.display = 'block';
                placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>${err.message}</p>`;
                rendered.style.display = 'none';
            });
    }

    // --- Загрузка практики ---
    function loadPractice(courseId, day) {
        closeSidebar();
        fetch(`COURSE/${courseId}/day${day}_practice.md`)
            .then(res => {
                if (!res.ok) throw new Error(`Практика дня ${day} не найдена`);
                return res.text();
            })
            .then(markdown => {
                try {
                    let html = renderMarkdown(markdown);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = html;
                    const steps = [];
                    const headers = tempDiv.querySelectorAll('h2, h3');
                    headers.forEach((h) => {
                        const text = h.textContent.trim();
                        const match = text.match(/^Шаг\s*(\d+)[\.\s]*(.*)/i);
                        if (match) {
                            const stepNum = parseInt(match[1], 10);
                            const title = match[2].trim() || `Шаг ${stepNum}`;
                            let content = '';
                            let next = h.nextElementSibling;
                            const level = h.tagName;
                            while (next && !(next.tagName === level && next.textContent.match(/^Шаг\s*\d+/i))) {
                                content += next.outerHTML;
                                next = next.nextElementSibling;
                            }
                            steps.push({ num: stepNum, title, content });
                        }
                    });
                    if (steps.length === 0) {
                        const regex = /\{step\}([\s\S]*?)\{\/step\}/g;
                        let match;
                        let index = 1;
                        while ((match = regex.exec(markdown)) !== null) {
                            const content = match[1].trim();
                            const lines = content.split('\n');
                            let title = `Шаг ${index}`;
                            if (lines.length && /^#{2,3}\s+/.test(lines[0])) {
                                title = lines.shift().replace(/^#{2,3}\s+/, '').trim();
                            }
                            const renderedContent = renderMarkdown(lines.join('\n').trim());
                            steps.push({ num: index, title, content: renderedContent });
                            index++;
                        }
                    }
                    if (steps.length > 0) {
                        let practiceHtml = '';
                        practiceHtml += `<div class="practice-sticky">`;
                        practiceHtml += `<div class="progress-container"><div class="progress-bar" id="practiceProgressBar" style="width: 0%;">0%</div></div>`;
                        practiceHtml += `</div>`;
                        practiceHtml += `<div id="practiceSteps">`;
                        const userKey = identity && identity.user_id != null ? 'u' + identity.user_id : 'chief';
                        const storageKey = `practice_${userKey}_${courseId}_day${day}`;
                        let savedStates = [];
                        try {
                            const saved = localStorage.getItem(storageKey);
                            if (saved) savedStates = JSON.parse(saved);
                        } catch(e) {}
                        while (savedStates.length < steps.length) {
                            savedStates.push(false);
                        }
                        localStorage.setItem(storageKey, JSON.stringify(savedStates));

                        steps.forEach((step, idx) => {
                            const checked = savedStates[idx] ? 'checked' : '';
                            const completedClass = savedStates[idx] ? 'completed' : '';
                            practiceHtml += `
                                <div class="practice-step ${completedClass}" data-step="${idx}">
                                    <input type="checkbox" class="step-checkbox" ${checked} data-step="${idx}" title="Можно отметить вручную; при 80% верных интерактивных ответов шаг закроется автоматически.">
                                    <div class="step-content">
                                        <div class="step-title">${step.title}</div>
                                        <div>${step.content}</div>
                                    </div>
                                </div>
                            `;
                        });
                        practiceHtml += `</div>`;
                        practiceHtml += `<button class="reset-btn" id="resetPracticeBtn"><i class="fas fa-undo-alt"></i> Сбросить прогресс</button>`;

                        rendered.innerHTML = practiceHtml;
                        rendered.style.display = 'block';
                        placeholder.style.display = 'none';

                        function updatePracticeProgress(key) {
                            const states = JSON.parse(localStorage.getItem(key) || '[]');
                            const total = states.length;
                            const done = states.filter(v => v === true).length;
                            const percent = total === 0 ? 0 : Math.round((done / total) * 100);
                            const bar = document.getElementById('practiceProgressBar');
                            if (bar) {
                                bar.style.width = percent + '%';
                                bar.textContent = percent + '%';
                            }
                        }
                        updatePracticeProgress(storageKey);

                        document.querySelectorAll('#practiceSteps .step-checkbox').forEach(cb => {
                            cb.addEventListener('change', function() {
                                const stepIdx = parseInt(this.dataset.step);
                                const states = JSON.parse(localStorage.getItem(storageKey) || '[]');
                                states[stepIdx] = this.checked;
                                localStorage.setItem(storageKey, JSON.stringify(states));
                                const stepDiv = this.closest('.practice-step');
                                if (this.checked) {
                                    stepDiv.classList.add('completed');
                                } else {
                                    stepDiv.classList.remove('completed');
                                }
                                updatePracticeProgress(storageKey);
                            });
                        });

                        document.getElementById('resetPracticeBtn').addEventListener('click', function() {
                            const states = new Array(steps.length).fill(false);
                            localStorage.setItem(storageKey, JSON.stringify(states));
                            document.querySelectorAll('#practiceSteps .step-checkbox').forEach((cb) => {
                                cb.checked = false;
                                cb.closest('.practice-step').classList.remove('completed');
                            });
                            rendered.querySelectorAll('[data-quiz]').forEach((quiz) => {
                                quiz.querySelectorAll('input[type="checkbox"][data-quiz-option]').forEach((cb) => { cb.checked = false; });
                                quiz.querySelectorAll('.quiz-input').forEach((input) => { input.value = ''; });
                                resetQuizFeedback(quiz);
                            });
                            document.querySelectorAll('#practiceSteps .practice-step').forEach((step) => {
                                delete step.dataset.autoCompleted;
                            });
                            updatePracticeProgress(storageKey);
                        });

                    } else {
                        rendered.innerHTML = html;
                        rendered.style.display = 'block';
                        placeholder.style.display = 'none';
                    }
                    insertNavButtons();
                    showPractice(courseId, day);
                    document.getElementById('viewer').scrollIntoView({ behavior: 'smooth' });
                } catch (e) {
                    placeholder.style.display = 'block';
                    placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>Ошибка обработки практики: ${e.message}</p>`;
                    rendered.style.display = 'none';
                }
            })
            .catch(err => {
                placeholder.style.display = 'block';
                placeholder.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#dc2626;"></i><p>${err.message}</p>`;
                rendered.style.display = 'none';
            });
    }

    // --- Обновить список ---
    refreshBtn.addEventListener('click', function(e) {
        e.preventDefault();
        loadCourses();
    });

    // --- Свернуть/развернуть список курсов ---
    function setSidebarCollapsed(collapsed) {
        layout.classList.toggle('collapsed', collapsed);
        try {
            localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
        } catch (e) {}
    }
    collapseBtn.addEventListener('click', function() {
        if (isMobileViewport()) {
            closeSidebar(true);
            return;
        }
        setSidebarCollapsed(true);
    });
    expandBtn.addEventListener('click', function() {
        if (isMobileViewport()) {
            openSidebar(true);
            return;
        }
        setSidebarCollapsed(false);
    });
    try {
        if (localStorage.getItem('sidebarCollapsed') === '1') {
            layout.classList.add('collapsed');
        }
    } catch (e) {}

    // --- Мобильная панель курсов ---
    if (mobileMenuBtn) {
        mobileMenuBtn.addEventListener('click', function() {
            if (sidebar.classList.contains('open')) {
                closeSidebar(true);
            } else {
                openSidebar(true);
            }
        });
    }
    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener('click', function() {
            closeSidebar(true);
        });
    }
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && sidebar.classList.contains('open')) {
            closeSidebar(true);
        }
    });
    function handleMobileQueryChange(event) {
        if (!event.matches) closeSidebar(false);
    }
    if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', handleMobileQueryChange);
    } else if (typeof mobileQuery.addListener === 'function') {
        mobileQuery.addListener(handleMobileQueryChange);
    }

    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    // --- Переключение темы ---
    const themeToggle = document.getElementById('themeToggle');
    function applyTheme(dark) {
        document.body.classList.toggle('dark', dark);
        themeToggle.innerHTML = dark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
        themeToggle.title = dark ? 'Светлая тема' : 'Тёмная тема';
        try {
            localStorage.setItem('theme', dark ? 'dark' : 'light');
        } catch (e) {}
    }
    themeToggle.addEventListener('click', function() {
        applyTheme(!document.body.classList.contains('dark'));
    });
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark' || (saved === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            applyTheme(true);
        }
    } catch (e) {}

    // --- Интерактивные задания ---
    rendered.addEventListener('click', function(e) {
        const checkBtn = e.target.closest('.quiz-check');
        if (!checkBtn) return;
        e.preventDefault();
        checkQuiz(checkBtn.closest('.quiz'));
    });

    rendered.addEventListener('change', function(e) {
        const option = e.target.closest('input[data-quiz-option]');
        if (!option) return;
        const quiz = option.closest('.quiz');
        if (quiz && quiz.dataset.quizType === 'single' && option.checked) {
            quiz.querySelectorAll('input[data-quiz-option]').forEach((cb) => {
                if (cb !== option) cb.checked = false;
            });
        }
        resetQuizFeedback(quiz);
    });

    rendered.addEventListener('input', function(e) {
        if (e.target.classList.contains('quiz-input')) {
            resetQuizFeedback(e.target.closest('.quiz'));
        }
    });

    rendered.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && e.target.classList.contains('quiz-input')) {
            const quiz = e.target.closest('.quiz');
            if (quiz) {
                e.preventDefault();
                checkQuiz(quiz);
            }
        }
    });

    // --- Инициализация ---
    loadSession().then(loadCourses).catch(function (error) {
        if (error.message === 'redirect') return;
        courseListEl.innerHTML = `<div style="padding:1rem; text-align:center; color:#dc2626;">
            <i class="fas fa-exclamation-triangle"></i> ${escapeHtml(error.message)}
        </div>`;
    });

    console.log('🚀 Универсальный клиент загружен (quiz v2).');
})();