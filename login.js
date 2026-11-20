(function () {
    'use strict';

    const THEME_KEY = 'theme';
    const form = document.getElementById('loginForm');
    const usernameInput = document.getElementById('usernameInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginBtn = document.getElementById('loginBtn');
    const loginStatus = document.getElementById('loginStatus');

    function setStatus(text, type) {
        loginStatus.textContent = text || '';
        loginStatus.className = 'admin-status' + (type ? ' ' + type : '');
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

    function safeNext(value) {
        const target = String(value || '').trim();
        if (!target.startsWith('/') || target.startsWith('//') || target.indexOf('\\') !== -1 || target.startsWith('/login')) {
            return '/';
        }
        return target;
    }

    function targetFor(data) {
        let next = safeNext(new URLSearchParams(window.location.search).get('next'));
        if (data.role === 'user' && (next === '/admin' || next.startsWith('/admin/') || next.startsWith('/admin?'))) {
            next = '/';
        }
        return next;
    }

    async function goIfAlreadyAuthenticated() {
        try {
            const response = await fetch('/api/session', { cache: 'no-store' });
            const data = await response.json();
            if (data.authenticated) {
                window.location.replace(targetFor(data));
                return true;
            }
            if (data.login_available === false) {
                setStatus('Вход не настроен на сервере. Задайте пароль главного администратора или создайте пользователей.', 'err');
                loginBtn.disabled = true;
            } else {
                usernameInput.focus();
            }
        } catch (error) {
            setStatus('Не удалось проверить сессию: ' + error.message, 'err');
        }
        return false;
    }

    async function onLogin(event) {
        event.preventDefault();
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        if (!username || !password) {
            setStatus('Введите логин и пароль.', 'err');
            return;
        }
        loginBtn.disabled = true;
        setStatus('Проверка…', 'load');
        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username, password: password })
            });
            const text = await response.text();
            let data = null;
            try {
                data = text ? JSON.parse(text) : null;
            } catch (error) {
                data = null;
            }
            if (!response.ok) {
                setStatus((data && data.error) || 'Не удалось войти (HTTP ' + response.status + ').', 'err');
                return;
            }
            passwordInput.value = '';
            window.location.replace(targetFor(data || {}));
        } catch (error) {
            setStatus('Не удалось соединиться с сервером. Проверьте, что server.py запущен.', 'err');
        } finally {
            loginBtn.disabled = false;
        }
    }

    form.addEventListener('submit', onLogin);
    applyTheme();
    goIfAlreadyAuthenticated();
})();
