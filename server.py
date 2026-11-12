#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COURSE_DIR = os.path.join(BASE_DIR, 'COURSE')

BLOCKED_NAMES = {
    'server.py',
    'dockerfile',
    'docker-compose.yml',
    'docker-compose.prod.yml',
    'caddyfile',
    '.env',
    '.gitignore',
    '.dockerignore',
}

CACHEABLE_SUFFIXES = (
    '.html', '.js', '.css', '.md', '.json', '.svg', '.png', '.jpg',
    '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf',
)


class CustomHandler(SimpleHTTPRequestHandler):
    server_version = 'StudyServer/1.0'
    sys_version = ''
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        path = urlparse(self.path).path
        if path.startswith('/api/') or path in ('', '/') or path.endswith(CACHEABLE_SUFFIXES):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin-when-cross-origin')
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if self.is_blocked(path):
            self.send_error(404)
            return

        if path == '/api/courses':
            self.send_json(self.get_courses())
            return

        if path == '/healthz':
            self.send_json({'status': 'ok'})
            return

        super().do_GET()

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    @staticmethod
    def is_blocked(path):
        parts = [unquote(part) for part in path.split('/') if part]
        return any(part.startswith('.') or part.lower() in BLOCKED_NAMES for part in parts)

    def get_courses(self):
        if not os.path.isdir(COURSE_DIR):
            return []

        result = []
        try:
            course_names = sorted(os.listdir(COURSE_DIR))
        except OSError:
            return []

        for item in course_names:
            course_path = os.path.join(COURSE_DIR, item)
            main_path = os.path.join(course_path, 'main.md')
            if not os.path.isdir(course_path) or not os.path.isfile(main_path):
                continue

            try:
                with open(main_path, 'r', encoding='utf-8-sig') as file:
                    content = file.read()
            except OSError:
                continue

            lines = content.split('\n')
            title = item
            description = ''

            for line in lines:
                if line.startswith('# '):
                    title = line[2:].strip()
                    break

            found_title = False
            for line in lines:
                if not found_title and line.startswith('# '):
                    found_title = True
                    continue
                if found_title and line.strip() and not line.startswith('#'):
                    description = line.strip()
                    break

            days = []
            try:
                filenames = os.listdir(course_path)
            except OSError:
                filenames = []
            for filename in filenames:
                match = re.match(r'^day(\d+)_theory\.md$', filename)
                if match:
                    days.append(int(match.group(1)))
            days.sort()

            result.append({
                'id': item,
                'title': title,
                'description': description,
                'days': days,
            })

        return result


def run():
    host = os.environ.get('HOST', '0.0.0.0')
    try:
        port = int(os.environ.get('PORT', '8000'))
    except ValueError:
        sys.exit('PORT must be an integer')

    try:
        httpd = ThreadingHTTPServer((host, port), CustomHandler)
    except OSError as error:
        sys.exit(f'Cannot start server on {host}:{port}: {error}')

    print(f'Сервер запущен на http://{host}:{port}', flush=True)
    print('Нажмите Ctrl+C для остановки.', flush=True)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nСервер остановлен.', flush=True)
    finally:
        httpd.server_close()


if __name__ == '__main__':
    run()
