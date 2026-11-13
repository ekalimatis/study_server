(function () {
    'use strict';

    const SETTINGS_KEY = 'studyAdminModelSettings';
    const THEME_KEY = 'theme';

    const DEFAULT_SYSTEM_PROMPT = 'Ты — методист и автор учебных курсов для учебного сервера. ' +
        'Помогай администратору создавать и изменять курсы и учебные дни. ' +
        'Пиши материалы на русском языке, структурированно, с примерами и практическими заданиями. ' +
        'Не выполняй посторонние задачи.';

    const DEFAULTS = {
        provider: 'ollama',
        base_url: 'http://127.0.0.1:11434',
        model: 'llama3.1',
        api_key: '',
        temperature: 0.2,
        top_p: 0.9,
        num_ctx: 8192,
        system_prompt: DEFAULT_SYSTEM_PROMPT
    };

    const loginView = document.getElementById('loginView');
    const adminView = document.getElementById('adminView');
    const loginForm = document.getElementById('loginForm');
    const passwordInput = document.getElementById('passwordInput');
    const loginStatus = document.getElementById('loginStatus');
    const logoutBtn = document.getElementById('logoutBtn');

    const courseList = document.getElementById('courseList');
    const refreshCoursesBtn = document.getElementById('refreshCoursesBtn');
    const contextCourse = document.getElementById('contextCourse');
    const contextDay = document.getElementById('contextDay');

    const cfgProvider = document.getElementById('cfgProvider');
    const cfgBaseUrl = document.getElementById('cfgBaseUrl');
    const cfgModel = document.getElementById('cfgModel');
    const cfgApiKey = document.getElementById('cfgApiKey');
    const cfgTemperature = document.getElementById('cfgTemperature');
    const cfgTopP = document.getElementById('cfgTopP');
    const cfgNumCtx = document.getElementById('cfgNumCtx');
    const cfgSystemPrompt = document.getElementById('cfgSystemPrompt');
    const modelOptions = document.getElementById('modelOptions');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const testConnectionBtn = document.getElementById('testConnectionBtn');
    const settingsStatus = document.getElementById('settingsStatus');

    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const chatStatus = document.getElementById('chatStatus');
    const sendBtn = document.getElementById('sendBtn');
    const guardBadge = document.getElementById('guardBadge');

    const changesCard = document.getElementById('changesCard');
    const changesList = document.getElementById('changesList');
    const applyAllBtn = document.getElementById('applyAllBtn');
    const applyStatus = document.getElementById('applyStatus');

    let courses = [];
    let messages = [];
    let pendingChanges = [];
    let currentCourse = '';

    function create(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined && text !== null) element.textContent = String(text);
        return element;
    }

    function setStatus(element, text, type) {
        element.textContent = text || '';
        element.className = 'admin-status' + (type ? ' ' + type : '');
    }

    function toNumber(value, fallback) {
        const number = parseFloat(String(value == null ? '' : value).replace(',', '.'));
        return isFinite(number) ? number : fallback;
    }

    function toInteger(value, fallback) {
        const number = parseInt(String(value == null ? '' : value), 10);
        return isFinite(number) ? number : fallback;
    }

    function applyTheme() {
        let theme = null;
        try {
            theme = localStorage.getItem(THEME_KEY);
        } catch (error) {
            theme = null;
        }
        if (theme === 'dark' || (theme === null && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.body.classList.add('dark');
        }
    }

    async function api(path, options) {
        const opts = Object.assign({ method: 'GET' }, options || {});
        if (opts.body) {
            opts.headers = Object.assign({}, opts.headers || {}, { 'Content-Type': 'application/json' });
        }
        const response = await fetch(path, opts).catch(function () {
            throw new Error('Не удалось соединиться с сервером. Проверьте, что server.py запущен.');
        });
        const text = await response.text();
        let data = null;
        if (text) {
            try {
                data = JSON.parse(text);
            } catch (error) {
                data = null;
            }
        }
        if (!response.ok) {
            if (response.status === 401 && path !== '/api/admin/login') {
                showLogin('Сессия истекла. Войдите снова.');
            }
            const error = new Error((data && data.error) || ('HTTP ' + response.status));
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data || {};
    }

    function showLogin(message) {
        loginView.classList.remove('hidden');
        adminView.classList.add('hidden');
        logoutBtn.classList.add('hidden');
        if (typeof message === 'string' && message) {
            setStatus(loginStatus, message, 'err');
        }
    }

    function showAdmin() {
        loginView.classList.add('hidden');
        adminView.classList.remove('hidden');
        logoutBtn.classList.remove('hidden');
        setStatus(loginStatus, '', '');
        loadCourses();
    }

    async function checkSession() {
        try {
            const data = await api('/api/admin/session');
            if (data.enabled === false) {
                showLogin('Админ-режим не настроен на сервере. Задайте ADMIN_PASSWORD_HASH или ADMIN_PASSWORD.');
                return;
            }
            if (data.authenticated) {
                showAdmin();
            } else {
                showLogin('');
            }
        } catch (error) {
            showLogin('Не удалось проверить сессию: ' + error.message);
        }
    }

    async function onLogin(event) {
        event.preventDefault();
        const password = passwordInput.value;
        if (!password) {
            setStatus(loginStatus, 'Введите пароль.', 'err');
            return;
        }
        setStatus(loginStatus, 'Проверка пароля…', 'load');
        try {
            await api('/api/admin/login', {
                method: 'POST',
                body: JSON.stringify({ password: password })
            });
            passwordInput.value = '';
            setStatus(loginStatus, '', '');
            showAdmin();
        } catch (error) {
            setStatus(loginStatus, 'Ошибка входа: ' + error.message, 'err');
        }
    }

    async function onLogout() {
        try {
            await api('/api/admin/logout', { method: 'POST' });
        } catch (error) {
            /* ignore */
        }
        messages = [];
        pendingChanges = [];
        chatMessages.innerHTML = '';
        chatMessages.appendChild(create('div', 'admin-empty', 'Опишите задачу: например, «Создай курс по PostgreSQL на 3 дня».'));
        hideChanges();
        setGuardBadge(null);
        showLogin('');
    }

    function loadSettings() {
        let settings = Object.assign({}, DEFAULTS);
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    settings = Object.assign(settings, parsed);
                }
            }
        } catch (error) {
            settings = Object.assign({}, DEFAULTS);
        }
        cfgProvider.value = settings.provider === 'openai' ? 'openai' : 'ollama';
        cfgBaseUrl.value = settings.base_url || DEFAULTS.base_url;
        cfgModel.value = settings.model || DEFAULTS.model;
        cfgApiKey.value = settings.api_key || '';
        cfgTemperature.value = settings.temperature != null ? settings.temperature : DEFAULTS.temperature;
        cfgTopP.value = settings.top_p != null ? settings.top_p : DEFAULTS.top_p;
        cfgNumCtx.value = settings.num_ctx != null ? settings.num_ctx : DEFAULTS.num_ctx;
        cfgSystemPrompt.value = settings.system_prompt || DEFAULT_SYSTEM_PROMPT;
        updateProviderUi();
    }

    function collectSettings() {
        return {
            provider: cfgProvider.value === 'openai' ? 'openai' : 'ollama',
            base_url: cfgBaseUrl.value.trim(),
            model: cfgModel.value.trim(),
            api_key: cfgProvider.value === 'openai' ? cfgApiKey.value : '',
            temperature: toNumber(cfgTemperature.value, DEFAULTS.temperature),
            top_p: toNumber(cfgTopP.value, DEFAULTS.top_p),
            num_ctx: toInteger(cfgNumCtx.value, DEFAULTS.num_ctx),
            system_prompt: cfgSystemPrompt.value
        };
    }

    function persistSettings(settings, announce) {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            if (announce) {
                setStatus(settingsStatus, 'Сохранено в браузере. На сервере не сохраняется.', 'ok');
            }
            return true;
        } catch (error) {
            setStatus(settingsStatus, 'Не удалось сохранить настройки в браузере: ' + error.message, 'err');
            return false;
        }
    }

    function updateProviderUi() {
        const isOpenai = cfgProvider.value === 'openai';
        cfgBaseUrl.placeholder = isOpenai ? 'https://routerai.ru/api/v1' : 'http://127.0.0.1:11434';
        cfgApiKey.disabled = !isOpenai;
        cfgApiKey.title = isOpenai
            ? 'Ключ хранится в браузере и передаётся только вместе с запросом'
            : 'Для Ollama ключ не требуется';
    }

    function onSaveSettings() {
        const settings = collectSettings();
        if (!settings.base_url || !settings.model) {
            setStatus(settingsStatus, 'Укажите Base URL и модель.', 'err');
            return;
        }
        persistSettings(settings, true);
    }

    async function onTestConnection() {
        const settings = collectSettings();
        if (!settings.base_url || !settings.model) {
            setStatus(settingsStatus, 'Укажите Base URL и модель.', 'err');
            return;
        }
        persistSettings(settings, false);
        setStatus(settingsStatus, 'Запрос списка моделей…', 'load');
        try {
            const data = await api('/api/admin/models', {
                method: 'POST',
                body: JSON.stringify({ config: settings })
            });
            const models = Array.isArray(data.models) ? data.models : [];
            modelOptions.innerHTML = '';
            models.forEach(function (model) {
                const option = document.createElement('option');
                option.value = model;
                modelOptions.appendChild(option);
            });
            if (models.length) {
                setStatus(settingsStatus, 'Подключение работает. Моделей: ' + models.length + '.', 'ok');
            } else {
                setStatus(settingsStatus, 'Подключение работает, но список моделей пуст.', 'warn');
            }
        } catch (error) {
            setStatus(settingsStatus, 'Ошибка: ' + error.message, 'err');
        }
    }

    async function loadCourses() {
        try {
            const data = await api('/api/courses');
            courses = Array.isArray(data) ? data : [];
            renderCourses();
            populateContextCourses();
        } catch (error) {
            courseList.innerHTML = '';
            courseList.appendChild(create('div', 'admin-empty', 'Не удалось загрузить курсы: ' + error.message));
        }
    }

    function renderCourses() {
        courseList.innerHTML = '';
        if (!courses.length) {
            courseList.appendChild(create('div', 'admin-empty', 'Курсов пока нет.'));
            return;
        }
        courses.forEach(function (course) {
            const card = create('div', 'admin-course');
            card.dataset.course = course.id;
            if (course.id === currentCourse) card.classList.add('active');
            card.appendChild(create('strong', '', course.title || course.id));
            const daysCount = Array.isArray(course.days) ? course.days.length : 0;
            card.appendChild(create('span', '', course.id + ' · ' + daysCount + ' дн.'));
            card.addEventListener('click', function () {
                selectContextCourse(course.id);
            });
            courseList.appendChild(card);
        });
    }

    function populateContextCourses() {
        const selected = contextCourse.value || currentCourse;
        contextCourse.innerHTML = '';
        contextCourse.appendChild(new Option('Не указан', ''));
        courses.forEach(function (course) {
            contextCourse.appendChild(new Option((course.title || course.id) + ' [' + course.id + ']', course.id));
        });
        if (selected && courses.some(function (course) { return course.id === selected; })) {
            contextCourse.value = selected;
        } else if (currentCourse && !courses.some(function (course) { return course.id === currentCourse; })) {
            currentCourse = '';
        }
    }

    function selectContextCourse(courseId) {
        currentCourse = courseId || '';
        contextCourse.value = currentCourse;
        document.querySelectorAll('.admin-course').forEach(function (element) {
            element.classList.toggle('active', element.dataset.course === currentCourse);
        });
    }

    function getContext() {
        const context = {};
        const courseId = contextCourse.value || '';
        const dayValue = contextDay.value.trim();
        if (courseId) context.course_id = courseId;
        if (dayValue) {
            const day = parseInt(dayValue, 10);
            if (isFinite(day) && day > 0) context.day = day;
        }
        return context;
    }

    function addMessage(role, text) {
        const empty = chatMessages.querySelector('.admin-empty');
        if (empty) empty.remove();
        const wrap = create('div', 'admin-message ' + role);
        wrap.appendChild(create('div', 'admin-message-role', role === 'user' ? 'Вы' : 'Модель'));
        wrap.appendChild(create('div', 'admin-message-text', text));
        chatMessages.appendChild(wrap);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function setGuardBadge(guard) {
        if (!guard) {
            guardBadge.classList.add('hidden');
            guardBadge.textContent = '';
            return;
        }
        guardBadge.classList.remove('hidden');
        guardBadge.textContent = guard.allowed ? 'Контроль: разрешено' : 'Контроль: запрещено';
        guardBadge.className = 'admin-badge ' + (guard.allowed ? 'ok' : 'err');
        guardBadge.title = guard.reason || '';
    }

    async function onSend(event) {
        event.preventDefault();
        const text = chatInput.value.trim();
        if (!text) {
            setStatus(chatStatus, 'Введите задачу.', 'err');
            return;
        }
        const settings = collectSettings();
        if (!settings.base_url || !settings.model) {
            setStatus(chatStatus, 'Заполните Base URL и модель в настройках доступа.', 'err');
            return;
        }
        persistSettings(settings, false);
        addMessage('user', text);
        messages.push({ role: 'user', content: text });
        chatInput.value = '';
        setStatus(chatStatus, 'Контрольная проверка и запрос к модели…', 'load');
        sendBtn.disabled = true;
        try {
            const data = await api('/api/admin/chat', {
                method: 'POST',
                body: JSON.stringify({
                    config: settings,
                    messages: messages.slice(-40),
                    context: getContext()
                })
            });
            const reply = data.reply || data.content || 'Модель вернула пустой ответ.';
            addMessage('assistant', reply);
            messages.push({ role: 'assistant', content: data.content || reply });
            setGuardBadge(data.guard || { allowed: true, reason: '' });
            if (data.parse_error) {
                setStatus(chatStatus, 'Ответ получен, но изменения не распознаны: ' + data.parse_error, 'warn');
            } else {
                setStatus(chatStatus, '', '');
            }
            if (Array.isArray(data.changes) && data.changes.length) {
                showChanges(data.changes);
            } else {
                hideChanges();
            }
        } catch (error) {
            if (error.status === 403) {
                const reason = (error.data && error.data.reason) || error.message;
                setStatus(chatStatus, 'Запрос отклонён контрольной моделью: ' + reason, 'err');
                setGuardBadge({ allowed: false, reason: reason });
            } else if (error.status === 401) {
                showLogin('Сессия истекла. Войдите снова.');
            } else {
                setStatus(chatStatus, 'Ошибка: ' + error.message, 'err');
            }
        } finally {
            sendBtn.disabled = false;
        }
    }

    function opLabel(op) {
        const labels = {
            create_course: 'Создать курс',
            update_course: 'Изменить курс',
            create_day: 'Создать день',
            update_day: 'Изменить день'
        };
        return labels[op] || op;
    }

    function addPreview(parent, label, text) {
        if (typeof text !== 'string' || !text.trim()) return;
        const details = create('details');
        details.appendChild(create('summary', '', label));
        const pre = create('pre');
        pre.textContent = text;
        details.appendChild(pre);
        parent.appendChild(details);
    }

    function showChanges(changes) {
        pendingChanges = changes.slice();
        changesCard.classList.remove('hidden');
        changesList.innerHTML = '';
        applyAllBtn.disabled = false;
        setStatus(applyStatus, '', '');
        changes.forEach(function (change, index) {
            const card = create('article', 'admin-change');
            const head = create('div', 'admin-change-head');
            head.appendChild(create('div', 'admin-change-title', (index + 1) + '. ' + opLabel(change.op)));
            const applyButton = create('button', 'admin-btn mini', 'Применить');
            applyButton.type = 'button';
            applyButton.addEventListener('click', function () {
                applyChanges([change], card, applyButton);
            });
            head.appendChild(applyButton);
            card.appendChild(head);

            const meta = create('div', 'admin-change-meta');
            if (change.course_id) meta.appendChild(create('span', 'admin-chip', 'Курс: ' + change.course_id));
            if (change.title) meta.appendChild(create('span', 'admin-chip', 'Название: ' + change.title));
            if (change.day) meta.appendChild(create('span', 'admin-chip', 'День: ' + change.day));
            if (change.topic) meta.appendChild(create('span', 'admin-chip', 'Тема: ' + change.topic));
            card.appendChild(meta);

            addPreview(card, 'main.md', change.main_md);
            addPreview(card, 'theory', change.theory_md);
            addPreview(card, 'practice', change.practice_md);
            if (Array.isArray(change.days)) {
                change.days.forEach(function (day) {
                    addPreview(card, 'День ' + day.day + ' · теория', day.theory_md);
                    addPreview(card, 'День ' + day.day + ' · практика', day.practice_md);
                });
            }
            changesList.appendChild(card);
        });
    }

    function hideChanges() {
        pendingChanges = [];
        changesCard.classList.add('hidden');
        changesList.innerHTML = '';
        setStatus(applyStatus, '', '');
    }

    async function applyChanges(changes, card, button) {
        if (!Array.isArray(changes) || !changes.length) return;
        setStatus(applyStatus, 'Применение изменений…', 'load');
        if (button) button.disabled = true;
        if (!card) applyAllBtn.disabled = true;
        try {
            const data = await api('/api/admin/apply', {
                method: 'POST',
                body: JSON.stringify({ changes: changes })
            });
            const results = Array.isArray(data.results) ? data.results : [];
            const okCount = results.filter(function (item) { return item.ok; }).length;
            setStatus(applyStatus, 'Применено: ' + okCount + ' из ' + results.length + '.', 'ok');
            if (card) {
                const index = pendingChanges.indexOf(changes[0]);
                if (index !== -1) pendingChanges.splice(index, 1);
                if (!pendingChanges.length) applyAllBtn.disabled = true;
                card.classList.add('applied');
            } else {
                document.querySelectorAll('.admin-change').forEach(function (element) {
                    element.classList.add('applied');
                });
                document.querySelectorAll('.admin-change button').forEach(function (element) {
                    element.disabled = true;
                });
                if (okCount === results.length) pendingChanges = [];
                else applyAllBtn.disabled = false;
            }
            loadCourses();
        } catch (error) {
            if (button) button.disabled = false;
            if (!card) applyAllBtn.disabled = false;
            setStatus(applyStatus, 'Ошибка применения: ' + error.message, 'err');
        }
    }

    loginForm.addEventListener('submit', onLogin);
    logoutBtn.addEventListener('click', onLogout);
    refreshCoursesBtn.addEventListener('click', loadCourses);
    saveSettingsBtn.addEventListener('click', onSaveSettings);
    testConnectionBtn.addEventListener('click', onTestConnection);
    cfgProvider.addEventListener('change', updateProviderUi);
    chatForm.addEventListener('submit', onSend);
    chatInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            if (chatForm.requestSubmit) chatForm.requestSubmit();
            else chatForm.dispatchEvent(new Event('submit', { cancelable: true }));
        }
    });
    applyAllBtn.addEventListener('click', function () {
        applyChanges(pendingChanges, null, applyAllBtn);
    });
    contextCourse.addEventListener('change', function () {
        currentCourse = contextCourse.value;
        document.querySelectorAll('.admin-course').forEach(function (element) {
            element.classList.toggle('active', element.dataset.course === currentCourse);
        });
    });

    applyTheme();
    loadSettings();
    checkSession();
})();
