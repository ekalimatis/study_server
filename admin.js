(function () {
    'use strict';

    const SETTINGS_KEY = 'studyAdminModelSettings';
    const THEME_KEY = 'theme';

    const DEFAULT_SYSTEM_PROMPT = 'Ты — старший методист и технический автор учебных курсов для учебного сервера. ' +
        'Создавай и изменяй курсы и учебные дни в формате, который принимает сервер. ' +
        'Не выполняй посторонние задачи.';

    const LEGACY_SYSTEM_PROMPTS = [
        'Ты — методист и автор учебных курсов для учебного сервера. Помогай администратору создавать и изменять курсы и учебные дни. Пиши материалы на русском языке, структурированно, с примерами и практическими заданиями. Не выполняй посторонние задачи.',
        'Ты — методист и автор учебных курсов для учебного сервера. Помогай администратору создавать и изменять курсы и учебные дни. Пиши материалы на русском языке, структурированно, с примерами и практическими заданиями.Не выполняй посторонние задачи.',
        'Ты — методист и автор учебных курсов для учебного сервера. Помогай администратору создавать и изменять курсы и учебные дни. Пиши материалы на русском языке, структурированно, с примерами и практическими заданиями.'
    ];

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

    const adminView = document.getElementById('adminView');
    const logoutBtn = document.getElementById('logoutBtn');
    const adminIdentity = document.getElementById('adminIdentity');
    const adminSubtitle = document.getElementById('adminSubtitle');

    const manageBlock = document.getElementById('manageBlock');
    const manageSummary = document.getElementById('manageSummary');
    const chiefGroupFormWrap = document.getElementById('chiefGroupFormWrap');
    const groupNameInput = document.getElementById('groupNameInput');
    const groupAdminLogin = document.getElementById('groupAdminLogin');
    const groupAdminPassword = document.getElementById('groupAdminPassword');
    const createGroupBtn = document.getElementById('createGroupBtn');
    const groupStatus = document.getElementById('groupStatus');
    const groupsSection = document.getElementById('groupsSection');
    const refreshGroupsBtn = document.getElementById('refreshGroupsBtn');
    const groupsList = document.getElementById('groupsList');
    const refreshUsersBtn = document.getElementById('refreshUsersBtn');
    const usersList = document.getElementById('usersList');
    const createUserForm = document.getElementById('createUserForm');
    const userUsernameInput = document.getElementById('userUsernameInput');
    const userPasswordInput = document.getElementById('userPasswordInput');
    const userGroupWrap = document.getElementById('userGroupWrap');
    const userGroupSelect = document.getElementById('userGroupSelect');
    const userStatus = document.getElementById('userStatus');

    const courseList = document.getElementById('courseList');
    const refreshCoursesBtn = document.getElementById('refreshCoursesBtn');
    const contextGroupWrap = document.getElementById('contextGroupWrap');
    const contextGroup = document.getElementById('contextGroup');
    const contextCourse = document.getElementById('contextCourse');
    const contextDay = document.getElementById('contextDay');
    const assignCourseWrap = document.getElementById('assignCourseWrap');
    const assignCourseBtn = document.getElementById('assignCourseBtn');
    const assignStatus = document.getElementById('assignStatus');

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
    const contextBadge = document.getElementById('contextBadge');

    const changesCard = document.getElementById('changesCard');
    const changesList = document.getElementById('changesList');
    const applyAllBtn = document.getElementById('applyAllBtn');
    const applyStatus = document.getElementById('applyStatus');

    let identity = null;
    let groups = [];
    let users = [];
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
        if (!element) return;
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

    function isChief() {
        return identity && identity.role === 'chief';
    }

    function isAdmin() {
        return identity && identity.role === 'admin';
    }

    function roleLabel() {
        if (isChief()) return 'Главный администратор';
        if (isAdmin()) return 'Администратор';
        return 'Пользователь';
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

    function updateIdentityUi() {
        if (!identity) return;
        const groupName = identity.group && identity.group.name ? identity.group.name : '';
        if (adminIdentity) {
            adminIdentity.textContent = identity.username + ' · ' + roleLabel() + (groupName ? ' · ' + groupName : '');
        }
        if (adminSubtitle) {
            adminSubtitle.textContent = isChief()
                ? 'Все группы, курсы и пользователи'
                : 'Группа: ' + (groupName || 'не назначена');
        }
        if (manageSummary) {
            manageSummary.textContent = isChief() ? 'Группы и пользователи' : 'Пользователи группы';
        }
        if (chiefGroupFormWrap) chiefGroupFormWrap.classList.toggle('hidden', !isChief());
        if (userGroupWrap) userGroupWrap.classList.toggle('hidden', !isChief());
        if (contextGroupWrap) contextGroupWrap.classList.toggle('hidden', !isChief());
        if (assignCourseWrap) assignCourseWrap.classList.toggle('hidden', !isChief());
        if (groupsSection) groupsSection.classList.toggle('hidden', false);
    }

    function redirectToLogin() {
        window.location.replace('/login?next=%2Fadmin');
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
            if (response.status === 401) {
                redirectToLogin();
            }
            const error = new Error((data && data.error) || ('HTTP ' + response.status));
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data || {};
    }

    async function loadDefaultSystemPrompt() {
        try {
            const response = await fetch('/system_prompt.txt?ts=' + Date.now(), { cache: 'no-store' });
            if (!response.ok) return null;
            const text = await response.text();
            const prompt = text.replace(/^\uFEFF/, '').trim();
            return prompt || null;
        } catch (error) {
            return null;
        }
    }

    function loadSettings(defaultPrompt) {
        const promptDefault = defaultPrompt === undefined
            ? DEFAULTS.system_prompt
            : (typeof defaultPrompt === 'string' ? defaultPrompt : '');
        const defaults = Object.assign({}, DEFAULTS, {
            system_prompt: promptDefault
        });
        let settings = Object.assign({}, defaults);
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    settings = Object.assign(settings, parsed);
                }
            }
        } catch (error) {
            settings = Object.assign({}, defaults);
        }
        cfgProvider.value = settings.provider === 'openai' ? 'openai' : 'ollama';
        cfgBaseUrl.value = settings.base_url || defaults.base_url;
        cfgModel.value = settings.model || defaults.model;
        cfgApiKey.value = settings.api_key || '';
        cfgTemperature.value = settings.temperature != null ? settings.temperature : defaults.temperature;
        cfgTopP.value = settings.top_p != null ? settings.top_p : defaults.top_p;
        cfgNumCtx.value = settings.num_ctx != null ? settings.num_ctx : defaults.num_ctx;
        const savedPrompt = typeof settings.system_prompt === 'string' ? settings.system_prompt.trim() : '';
        if (!savedPrompt || LEGACY_SYSTEM_PROMPTS.indexOf(savedPrompt) !== -1) {
            settings.system_prompt = defaults.system_prompt;
        }
        cfgSystemPrompt.value = settings.system_prompt;
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

    async function checkSession() {
        try {
            const data = await api('/api/session');
            if (!data.authenticated) {
                redirectToLogin();
                return false;
            }
            if (data.role !== 'chief' && data.role !== 'admin') {
                window.location.replace('/');
                return false;
            }
            identity = data;
            updateIdentityUi();
            adminView.classList.remove('hidden');
            await loadGroups();
            await Promise.all([loadUsers(), loadCourses()]);
            return true;
        } catch (error) {
            if (error.status === 401) return false;
            if (adminIdentity) adminIdentity.textContent = 'Ошибка: ' + error.message;
            return false;
        }
    }

    async function onLogout() {
        try {
            await api('/api/logout', { method: 'POST' });
        } catch (error) {
            /* ignore */
        }
        window.location.replace('/login');
    }

    async function loadGroups() {
        try {
            const data = await api('/api/admin/groups');
            groups = Array.isArray(data.groups) ? data.groups : [];
            renderGroups();
            populateGroupSelects();
        } catch (error) {
            if (error.status === 401) return;
            groupsList.innerHTML = '';
            groupsList.appendChild(create('div', 'admin-empty', 'Не удалось загрузить группы: ' + error.message));
        }
    }

    function renderGroups() {
        groupsList.innerHTML = '';
        if (!groups.length) {
            groupsList.appendChild(create('div', 'admin-empty', 'Групп пока нет.'));
            return;
        }
        groups.forEach(function (group) {
            const row = create('div', 'admin-group-row');
            const info = create('div', 'admin-group-info');
            info.appendChild(create('strong', '', group.name));
            const details = [];
            if (group.owner_username) details.push('админ: ' + group.owner_username);
            details.push('пользователей: ' + group.user_count);
            details.push('курсов: ' + group.course_count);
            info.appendChild(create('span', '', details.join(' · ')));
            row.appendChild(info);
            groupsList.appendChild(row);
        });
    }

    function fillGroupSelect(select, includeEmpty) {
        const selected = select.value;
        select.innerHTML = '';
        if (includeEmpty) select.appendChild(new Option('Без группы', ''));
        groups.forEach(function (group) {
            select.appendChild(new Option(group.name, String(group.id)));
        });
        if (selected && Array.from(select.options).some(function (option) { return option.value === selected; })) {
            select.value = selected;
        }
    }

    function populateGroupSelects() {
        fillGroupSelect(userGroupSelect, false);
        fillGroupSelect(contextGroup, true);
        if (!isChief()) {
            const groupId = identity && identity.group ? String(identity.group.id) : '';
            if (groupId && Array.from(userGroupSelect.options).some(function (option) { return option.value === groupId; })) {
                userGroupSelect.value = groupId;
            }
            if (groupId && Array.from(contextGroup.options).some(function (option) { return option.value === groupId; })) {
                contextGroup.value = groupId;
            }
        }
    }

    async function loadUsers() {
        try {
            const data = await api('/api/admin/users');
            users = Array.isArray(data.users) ? data.users : [];
            renderUsers();
        } catch (error) {
            if (error.status === 401) return;
            usersList.innerHTML = '';
            usersList.appendChild(create('div', 'admin-empty', 'Не удалось загрузить пользователей: ' + error.message));
        }
    }

    function findUser(userId) {
        return users.find(function (user) { return user.id === userId; });
    }

    function renderUsers() {
        usersList.innerHTML = '';
        if (!users.length) {
            usersList.appendChild(create('div', 'admin-empty', 'Пользователей пока нет.'));
            return;
        }
        users.forEach(function (user) {
            const row = create('div', 'admin-user-row');
            row.dataset.userId = String(user.id);

            const name = create('input', 'admin-input admin-user-name');
            name.type = 'text';
            name.value = user.username;
            name.maxLength = 32;
            name.autocomplete = 'off';
            row.appendChild(name);

            const role = create('span', 'admin-chip', user.role === 'admin' ? 'Администратор' : 'Пользователь');
            row.appendChild(role);

            if (isChief() && user.role !== 'admin') {
                const groupSelect = create('select', 'admin-input admin-user-group');
                groups.forEach(function (group) {
                    groupSelect.appendChild(new Option(group.name, String(group.id)));
                });
                if (user.group_id != null) groupSelect.value = String(user.group_id);
                row.appendChild(groupSelect);
            } else {
                row.appendChild(create('span', 'admin-chip', user.group_name || 'Без группы'));
            }

            row.appendChild(create('span', 'admin-chip ' + (user.active ? 'ok' : 'err'), user.active ? 'Активен' : 'Отключён'));

            const actions = create('div', 'admin-user-actions');
            const save = create('button', 'admin-btn mini', 'Сохранить');
            save.type = 'button';
            save.dataset.action = 'save';
            actions.appendChild(save);

            const password = create('input', 'admin-input admin-user-password');
            password.type = 'password';
            password.placeholder = 'Новый пароль';
            password.autocomplete = 'new-password';
            password.minLength = 8;
            actions.appendChild(password);

            const reset = create('button', 'admin-btn mini', 'Сбросить пароль');
            reset.type = 'button';
            reset.dataset.action = 'password';
            actions.appendChild(reset);

            const toggle = create('button', 'admin-btn mini', user.active ? 'Отключить' : 'Включить');
            toggle.type = 'button';
            toggle.dataset.action = 'toggle';
            actions.appendChild(toggle);
            row.appendChild(actions);

            usersList.appendChild(row);
        });
    }

    async function createGroup() {
        const name = groupNameInput.value.trim();
        const username = groupAdminLogin.value.trim();
        const password = groupAdminPassword.value;
        if (!name || !username || !password) {
            setStatus(groupStatus, 'Заполните название группы, логин и пароль администратора.', 'err');
            return;
        }
        createGroupBtn.disabled = true;
        setStatus(groupStatus, 'Создание группы…', 'load');
        try {
            await api('/api/admin/groups', {
                method: 'POST',
                body: JSON.stringify({
                    name: name,
                    admin_username: username,
                    admin_password: password
                })
            });
            groupNameInput.value = '';
            groupAdminLogin.value = '';
            groupAdminPassword.value = '';
            setStatus(groupStatus, 'Группа и администратор созданы.', 'ok');
            await loadGroups();
            await Promise.all([loadUsers(), loadCourses()]);
        } catch (error) {
            setStatus(groupStatus, 'Ошибка: ' + error.message, 'err');
        } finally {
            createGroupBtn.disabled = false;
        }
    }

    async function createUser(event) {
        event.preventDefault();
        const username = userUsernameInput.value.trim();
        const password = userPasswordInput.value;
        if (!username || !password) {
            setStatus(userStatus, 'Введите логин и пароль.', 'err');
            return;
        }
        const body = { username: username, password: password };
        if (isChief()) {
            const groupId = parseInt(userGroupSelect.value, 10);
            if (!isFinite(groupId) || groupId <= 0) {
                setStatus(userStatus, 'Сначала создайте группу и выберите её.', 'err');
                return;
            }
            body.group_id = groupId;
        }
        setStatus(userStatus, 'Создание пользователя…', 'load');
        try {
            await api('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify(body)
            });
            userUsernameInput.value = '';
            userPasswordInput.value = '';
            setStatus(userStatus, 'Пользователь создан.', 'ok');
            await Promise.all([loadUsers(), loadGroups()]);
        } catch (error) {
            setStatus(userStatus, 'Ошибка: ' + error.message, 'err');
        }
    }

    async function updateUser(userId, body, successText) {
        try {
            await api('/api/admin/users/' + userId, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            setStatus(userStatus, successText || 'Пользователь обновлён.', 'ok');
            await Promise.all([loadUsers(), loadGroups()]);
        } catch (error) {
            setStatus(userStatus, 'Ошибка: ' + error.message, 'err');
        }
    }

    async function onUsersClick(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const row = button.closest('.admin-user-row');
        if (!row) return;
        const userId = parseInt(row.dataset.userId, 10);
        const user = findUser(userId);
        if (!user) return;

        if (button.dataset.action === 'save') {
            const nameInput = row.querySelector('.admin-user-name');
            const groupSelect = row.querySelector('.admin-user-group');
            const body = { username: nameInput.value.trim() };
            if (groupSelect) {
                const groupId = parseInt(groupSelect.value, 10);
                if (isFinite(groupId) && groupId > 0) body.group_id = groupId;
            }
            button.disabled = true;
            await updateUser(userId, body, 'Пользователь обновлён.');
            button.disabled = false;
            return;
        }

        if (button.dataset.action === 'password') {
            const passwordInput = row.querySelector('.admin-user-password');
            const password = passwordInput.value;
            if (!password) {
                setStatus(userStatus, 'Введите новый пароль.', 'err');
                return;
            }
            button.disabled = true;
            try {
                await api('/api/admin/users/' + userId + '/password', {
                    method: 'POST',
                    body: JSON.stringify({ password: password })
                });
                passwordInput.value = '';
                setStatus(userStatus, 'Пароль изменён. Сеансы пользователя завершены.', 'ok');
            } catch (error) {
                setStatus(userStatus, 'Ошибка: ' + error.message, 'err');
            } finally {
                button.disabled = false;
            }
            return;
        }

        if (button.dataset.action === 'toggle') {
            button.disabled = true;
            await updateUser(userId, { active: !user.active }, user.active ? 'Пользователь отключён.' : 'Пользователь включён.');
            button.disabled = false;
        }
    }

    async function loadCourses() {
        try {
            const data = await api('/api/courses');
            courses = Array.isArray(data) ? data : [];
            renderCourses();
            populateContextCourses();
        } catch (error) {
            if (error.status === 401) return;
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
            const groupName = course.group_name || (isChief() ? 'без группы' : '');
            card.appendChild(create('span', '', course.id + ' · ' + daysCount + ' дн.' + (groupName ? ' · ' + groupName : '')));
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
        setContextBadge(getContext());
    }

    function selectContextCourse(courseId) {
        currentCourse = courseId || '';
        contextCourse.value = currentCourse;
        document.querySelectorAll('.admin-course').forEach(function (element) {
            element.classList.toggle('active', element.dataset.course === currentCourse);
        });
        const course = courses.find(function (item) { return item.id === currentCourse; });
        if (isChief() && course) {
            contextGroup.value = course.group_id != null ? String(course.group_id) : '';
        }
        setContextBadge(getContext());
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
        if (isChief()) {
            const groupId = parseInt(contextGroup.value, 10);
            if (isFinite(groupId) && groupId > 0) context.group_id = groupId;
        } else if (identity && identity.group) {
            context.group_name = identity.group.name;
        }
        return context;
    }

    async function assignCourseGroup() {
        if (!isChief()) return;
        const courseId = contextCourse.value;
        if (!courseId) {
            setStatus(assignStatus, 'Сначала выберите курс.', 'err');
            return;
        }
        const groupId = contextGroup.value ? parseInt(contextGroup.value, 10) : null;
        setStatus(assignStatus, 'Сохранение привязки…', 'load');
        try {
            await api('/api/admin/courses/assign', {
                method: 'POST',
                body: JSON.stringify({
                    course_id: courseId,
                    group_id: groupId
                })
            });
            setStatus(assignStatus, 'Привязка сохранена.', 'ok');
            await Promise.all([loadCourses(), loadGroups()]);
            selectContextCourse(courseId);
        } catch (error) {
            setStatus(assignStatus, 'Ошибка: ' + error.message, 'err');
        }
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

    function groupNameForContext(context) {
        if (!context) return '';
        if (context.group_name) return context.group_name;
        if (context.group_id) {
            const group = groups.find(function (item) { return item.id === context.group_id; });
            if (group) return group.name;
        }
        if (!isChief() && identity && identity.group) return identity.group.name;
        return '';
    }

    function setContextBadge(context) {
        const parts = [];
        const groupName = groupNameForContext(context);
        if (groupName) parts.push('группа ' + groupName);
        if (context && context.course_id) parts.push('курс ' + context.course_id);
        if (context && context.day) parts.push('день ' + context.day);
        if (!parts.length) {
            contextBadge.classList.add('hidden');
            contextBadge.textContent = '';
            return;
        }
        contextBadge.classList.remove('hidden');
        contextBadge.textContent = 'Контекст: ' + parts.join(', ');
        contextBadge.className = 'admin-badge neutral';
        contextBadge.title = 'Передаётся в модель вместе с запросом';
    }

    async function onSend(event) {
        event.preventDefault();
        const text = chatInput.value.trim();
        if (!text) {
            setStatus(chatStatus, 'Введите задачу.', 'err');
            return;
        }
        if (isAdmin() && (!identity.group || !identity.group.id)) {
            setStatus(chatStatus, 'Администратор не привязан к группе. Обратитесь к главному администратору.', 'err');
            return;
        }
        const settings = collectSettings();
        if (!settings.base_url || !settings.model) {
            setStatus(chatStatus, 'Заполните Base URL и модель в настройках доступа.', 'err');
            return;
        }
        const context = getContext();
        setContextBadge(context);
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
                    context: context
                })
            });
            if (data.context) setContextBadge(data.context);
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
            } else if (error.status !== 401) {
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
                body: JSON.stringify({
                    changes: changes,
                    context: getContext()
                })
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
            await Promise.all([loadCourses(), loadGroups()]);
        } catch (error) {
            if (button) button.disabled = false;
            if (!card) applyAllBtn.disabled = false;
            if (error.status !== 401) setStatus(applyStatus, 'Ошибка применения: ' + error.message, 'err');
        }
    }

    logoutBtn.addEventListener('click', onLogout);
    chiefGroupFormWrap.addEventListener('submit', function (event) {
        event.preventDefault();
        createGroup();
    });
    createUserForm.addEventListener('submit', createUser);
    refreshGroupsBtn.addEventListener('click', loadGroups);
    refreshUsersBtn.addEventListener('click', loadUsers);
    usersList.addEventListener('click', onUsersClick);
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
        selectContextCourse(contextCourse.value);
    });
    contextDay.addEventListener('input', function () {
        setContextBadge(getContext());
    });
    contextGroup.addEventListener('change', function () {
        setContextBadge(getContext());
        setStatus(assignStatus, '', '');
    });
    assignCourseBtn.addEventListener('click', assignCourseGroup);

    async function init() {
        applyTheme();
        const defaultPrompt = await loadDefaultSystemPrompt();
        loadSettings(defaultPrompt);
        await checkSession();
    }

    init();
})();
