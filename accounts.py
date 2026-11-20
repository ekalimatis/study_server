#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Хранение пользователей, групп и привязки курсов к группам.

Используется только стандартная библиотека Python: sqlite3, hashlib, secrets.
Главный администратор хранится не здесь, а в переменных окружения сервера.
"""

import datetime
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, 'data', 'study.db')
DB_PATH = (os.environ.get('STUDY_DB_PATH') or DEFAULT_DB_PATH).strip()

PASSWORD_ITERATIONS = 260000
MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_LENGTH = 200
MAX_USERNAME_LENGTH = 32
MAX_GROUP_NAME_LENGTH = 100
USERNAME_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.-]{2,%d}$' % (MAX_USERNAME_LENGTH - 1))
_CONTROL_RE = re.compile(r'[\x00-\x1f\x7f]')

_UNSET = object()
_db_lock = threading.RLock()
_initialized_paths = set()

SCHEMA = """
CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    owner_user_id INTEGER UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    group_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_group ON users(group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_admin_per_group
    ON users(group_id) WHERE role = 'admin' AND group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS courses (
    course_id TEXT PRIMARY KEY,
    group_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_courses_group ON courses(group_id);
"""


class AccountError(Exception):
    pass


class AccountValidation(AccountError):
    pass


class AccountConflict(AccountError):
    pass


class AccountNotFound(AccountError):
    pass


def set_db_path(path):
    global DB_PATH
    DB_PATH = os.path.abspath(path)


def _now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def _connect():
    _ensure_db()
    directory = os.path.dirname(os.path.abspath(DB_PATH))
    if directory:
        os.makedirs(directory, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute('PRAGMA foreign_keys = ON')
    connection.execute('PRAGMA busy_timeout = 5000')
    return connection


def _ensure_db():
    path = os.path.abspath(DB_PATH)
    if path in _initialized_paths:
        return
    init_db()


def init_db():
    path = os.path.abspath(DB_PATH)
    with _db_lock:
        if path in _initialized_paths:
            return
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        connection = sqlite3.connect(path, timeout=10)
        try:
            connection.execute('PRAGMA foreign_keys = ON')
            connection.execute('PRAGMA journal_mode = WAL')
            connection.executescript(SCHEMA)
            connection.commit()
        finally:
            connection.close()
        _initialized_paths.add(path)


def validate_username(value):
    text = str(value or '').strip()
    if not USERNAME_RE.match(text):
        raise AccountValidation(
            'Логин: 3–%d символов, латиница, цифры, точка, дефис или подчёркивание; '
            'начинается с буквы или цифры' % MAX_USERNAME_LENGTH
        )
    return text


def validate_group_name(value):
    text = str(value or '').strip()
    if not text:
        raise AccountValidation('Введите название группы')
    if len(text) > MAX_GROUP_NAME_LENGTH:
        raise AccountValidation('Название группы слишком длинное')
    if _CONTROL_RE.search(text):
        raise AccountValidation('Название группы содержит недопустимые символы')
    return text


def validate_password(value):
    password = value if isinstance(value, str) else ''
    if len(password) < MIN_PASSWORD_LENGTH:
        raise AccountValidation('Пароль должен содержать не менее %d символов' % MIN_PASSWORD_LENGTH)
    if len(password) > MAX_PASSWORD_LENGTH:
        raise AccountValidation('Пароль слишком длинный')
    if '\x00' in password:
        raise AccountValidation('Пароль содержит недопустимый символ')
    return password


def hash_password(password):
    password = validate_password(password)
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, PASSWORD_ITERATIONS)
    return 'pbkdf2_sha256$%d$%s$%s' % (PASSWORD_ITERATIONS, salt.hex(), digest.hex())


def verify_password(password, encoded):
    if not isinstance(password, str) or not password or not isinstance(encoded, str):
        return False
    try:
        separator = '$' if '$' in encoded else ':'
        parts = encoded.split(separator)
        if len(parts) != 4 or parts[0] != 'pbkdf2_sha256':
            return False
        iterations = int(parts[1])
        salt = bytes.fromhex(parts[2])
        expected = bytes.fromhex(parts[3])
        actual = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(actual, expected)
    except (TypeError, ValueError):
        return False


def _user_dict(row, include_hash=False):
    if row is None:
        return None
    result = {
        'id': row['id'],
        'username': row['username'],
        'role': row['role'],
        'group_id': row['group_id'],
        'group_name': row['group_name'] if 'group_name' in row.keys() else None,
        'active': bool(row['active']),
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }
    if include_hash:
        result['password_hash'] = row['password_hash']
    return result


def get_user(user_id, include_hash=False):
    with _db_lock:
        connection = _connect()
        try:
            row = connection.execute(
                'SELECT u.*, g.name AS group_name FROM users u '
                'LEFT JOIN groups g ON g.id = u.group_id WHERE u.id = ?',
                (int(user_id),),
            ).fetchone()
            return _user_dict(row, include_hash=include_hash)
        finally:
            connection.close()


def get_user_by_username(username):
    text = str(username or '').strip()
    if not text:
        return None
    with _db_lock:
        connection = _connect()
        try:
            row = connection.execute(
                'SELECT u.*, g.name AS group_name FROM users u '
                'LEFT JOIN groups g ON g.id = u.group_id '
                'WHERE u.username = ? COLLATE NOCASE',
                (text,),
            ).fetchone()
            return _user_dict(row, include_hash=True)
        finally:
            connection.close()


def list_users(group_id=None):
    with _db_lock:
        connection = _connect()
        try:
            if group_id is None:
                rows = connection.execute(
                    'SELECT u.*, g.name AS group_name FROM users u '
                    'LEFT JOIN groups g ON g.id = u.group_id '
                    'ORDER BY g.name COLLATE NOCASE, u.username COLLATE NOCASE'
                ).fetchall()
            else:
                rows = connection.execute(
                    'SELECT u.*, g.name AS group_name FROM users u '
                    'LEFT JOIN groups g ON g.id = u.group_id '
                    'WHERE u.group_id = ? '
                    'ORDER BY u.username COLLATE NOCASE',
                    (int(group_id),),
                ).fetchall()
            return [_user_dict(row) for row in rows]
        finally:
            connection.close()


def has_active_users():
    with _db_lock:
        connection = _connect()
        try:
            row = connection.execute('SELECT 1 FROM users WHERE active = 1 LIMIT 1').fetchone()
            return row is not None
        finally:
            connection.close()


def create_user(username, password, group_id, role='user'):
    username = validate_username(username)
    if role not in ('admin', 'user'):
        raise AccountValidation('Недопустимая роль')
    password_hash = hash_password(password)
    now = _now()
    with _db_lock:
        connection = _connect()
        try:
            group = connection.execute('SELECT id FROM groups WHERE id = ?', (int(group_id),)).fetchone()
            if group is None:
                raise AccountNotFound('Группа не найдена')
            with connection:
                cursor = connection.execute(
                    'INSERT INTO users (username, password_hash, role, group_id, active, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, 1, ?, ?)',
                    (username, password_hash, role, int(group_id), now, now),
                )
                user_id = cursor.lastrowid
        except sqlite3.IntegrityError as error:
            message = str(error)
            if 'users.username' in message:
                raise AccountConflict('Логин уже занят')
            if 'idx_one_admin_per_group' in message or 'users.group_id' in message:
                raise AccountConflict('У группы уже есть администратор')
            raise AccountConflict('Не удалось создать пользователя')
        finally:
            connection.close()
    return get_user(user_id)


def update_user(user_id, username=None, group_id=_UNSET, active=None):
    user = get_user(user_id)
    if user is None:
        raise AccountNotFound('Пользователь не найден')
    fields = []
    params = []
    if username is not None:
        fields.append('username = ?')
        params.append(validate_username(username))
    if group_id is not _UNSET:
        new_group_id = None if group_id in (None, '') else int(group_id)
        if user['role'] == 'admin' and new_group_id != user['group_id']:
            raise AccountConflict('Нельзя перенести администратора в другую группу')
        if new_group_id is not None:
            with _db_lock:
                connection = _connect()
                try:
                    if connection.execute('SELECT 1 FROM groups WHERE id = ?', (new_group_id,)).fetchone() is None:
                        raise AccountNotFound('Группа не найдена')
                finally:
                    connection.close()
        fields.append('group_id = ?')
        params.append(new_group_id)
    if active is not None:
        fields.append('active = ?')
        params.append(1 if active else 0)
    if not fields:
        return user
    fields.append('updated_at = ?')
    params.append(_now())
    params.append(int(user_id))
    with _db_lock:
        connection = _connect()
        try:
            with connection:
                connection.execute(
                    'UPDATE users SET %s WHERE id = ?' % ', '.join(fields),
                    tuple(params),
                )
        except sqlite3.IntegrityError as error:
            message = str(error)
            if 'users.username' in message:
                raise AccountConflict('Логин уже занят')
            if 'idx_one_admin_per_group' in message or 'users.group_id' in message:
                raise AccountConflict('У группы уже есть администратор')
            raise AccountConflict('Не удалось изменить пользователя')
        finally:
            connection.close()
    return get_user(user_id)


def set_password(user_id, password):
    password_hash = hash_password(password)
    with _db_lock:
        connection = _connect()
        try:
            with connection:
                cursor = connection.execute(
                    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
                    (password_hash, _now(), int(user_id)),
                )
                if cursor.rowcount == 0:
                    raise AccountNotFound('Пользователь не найден')
        finally:
            connection.close()


def get_group(group_id):
    with _db_lock:
        connection = _connect()
        try:
            row = connection.execute(
                'SELECT g.id, g.name, g.owner_user_id, g.created_at, g.updated_at, '
                'u.username AS owner_username, '
                '(SELECT COUNT(*) FROM users x WHERE x.group_id = g.id AND x.role = ?) AS user_count, '
                '(SELECT COUNT(*) FROM courses c WHERE c.group_id = g.id) AS course_count '
                'FROM groups g LEFT JOIN users u ON u.id = g.owner_user_id '
                'WHERE g.id = ?',
                ('user', int(group_id)),
            ).fetchone()
            return _group_dict(row)
        finally:
            connection.close()


def _group_dict(row):
    if row is None:
        return None
    return {
        'id': row['id'],
        'name': row['name'],
        'owner_user_id': row['owner_user_id'],
        'owner_username': row['owner_username'],
        'user_count': row['user_count'],
        'course_count': row['course_count'],
        'created_at': row['created_at'],
        'updated_at': row['updated_at'],
    }


def list_groups():
    with _db_lock:
        connection = _connect()
        try:
            rows = connection.execute(
                'SELECT g.id, g.name, g.owner_user_id, g.created_at, g.updated_at, '
                'u.username AS owner_username, '
                '(SELECT COUNT(*) FROM users x WHERE x.group_id = g.id AND x.role = ?) AS user_count, '
                '(SELECT COUNT(*) FROM courses c WHERE c.group_id = g.id) AS course_count '
                'FROM groups g LEFT JOIN users u ON u.id = g.owner_user_id '
                'ORDER BY g.name COLLATE NOCASE',
                ('user',),
            ).fetchall()
            return [_group_dict(row) for row in rows]
        finally:
            connection.close()


def create_group_with_admin(group_name, username, password):
    group_name = validate_group_name(group_name)
    username = validate_username(username)
    password_hash = hash_password(password)
    now = _now()
    with _db_lock:
        connection = _connect()
        try:
            with connection:
                cursor = connection.execute(
                    'INSERT INTO groups (name, owner_user_id, created_at, updated_at) VALUES (?, NULL, ?, ?)',
                    (group_name, now, now),
                )
                group_id = cursor.lastrowid
                cursor = connection.execute(
                    'INSERT INTO users (username, password_hash, role, group_id, active, created_at, updated_at) '
                    'VALUES (?, ?, ?, ?, 1, ?, ?)',
                    (username, password_hash, 'admin', group_id, now, now),
                )
                user_id = cursor.lastrowid
                connection.execute(
                    'UPDATE groups SET owner_user_id = ?, updated_at = ? WHERE id = ?',
                    (user_id, now, group_id),
                )
        except sqlite3.IntegrityError as error:
            message = str(error)
            if 'groups.name' in message:
                raise AccountConflict('Группа с таким названием уже существует')
            if 'users.username' in message:
                raise AccountConflict('Логин уже занят')
            raise AccountConflict('Не удалось создать группу и администратора')
        finally:
            connection.close()
    return {'group': get_group(group_id), 'user': get_user(user_id)}


def course_groups_map():
    with _db_lock:
        connection = _connect()
        try:
            rows = connection.execute('SELECT course_id, group_id FROM courses').fetchall()
            return {row['course_id']: row['group_id'] for row in rows}
        finally:
            connection.close()


def get_course_group(course_id):
    with _db_lock:
        connection = _connect()
        try:
            row = connection.execute(
                'SELECT group_id FROM courses WHERE course_id = ?',
                (str(course_id),),
            ).fetchone()
            return row['group_id'] if row else None
        finally:
            connection.close()


def set_course_group(course_id, group_id):
    course_id = str(course_id or '').strip()
    if not course_id:
        raise AccountValidation('Некорректный идентификатор курса')
    now = _now()
    with _db_lock:
        connection = _connect()
        try:
            if group_id in (None, ''):
                with connection:
                    connection.execute('DELETE FROM courses WHERE course_id = ?', (course_id,))
                return
            group_id = int(group_id)
            if connection.execute('SELECT 1 FROM groups WHERE id = ?', (group_id,)).fetchone() is None:
                raise AccountNotFound('Группа не найдена')
            with connection:
                connection.execute(
                    'INSERT INTO courses (course_id, group_id, created_at, updated_at) VALUES (?, ?, ?, ?) '
                    'ON CONFLICT(course_id) DO UPDATE SET group_id = excluded.group_id, updated_at = excluded.updated_at',
                    (course_id, group_id, now, now),
                )
        finally:
            connection.close()
