import os
import tempfile
import unittest

import server


class CourseIdTests(unittest.TestCase):
    def test_accepts_valid_ids(self):
        self.assertEqual(server.safe_course_id('KAFKA'), 'KAFKA')
        self.assertEqual(server.safe_course_id('LLM arh'), 'LLM arh')
        self.assertEqual(server.safe_course_id('GIT_LAB_CI_CD'), 'GIT_LAB_CI_CD')

    def test_rejects_unsafe_ids(self):
        for value in ('', '../KAFKA', 'a/b', 'a\\b', '.hidden', ' KAFKA', 'KAFKA ', 'CON', 'name.'):
            with self.subTest(value=value):
                with self.assertRaises(server.ValidationError):
                    server.safe_course_id(value)


class DayNumberTests(unittest.TestCase):
    def test_accepts_valid_days(self):
        self.assertEqual(server.safe_day_num('1'), 1)
        self.assertEqual(server.safe_day_num(365), 365)

    def test_rejects_invalid_days(self):
        for value in (0, -1, 366, 'abc', None):
            with self.subTest(value=value):
                with self.assertRaises(server.ValidationError):
                    server.safe_day_num(value)

    def test_rejects_fractional_days(self):
        with self.assertRaises(server.ValidationError):
            server.safe_day_num(1.5)


class PlanHeadingTests(unittest.TestCase):
    def test_replaces_existing_day_heading(self):
        text = '# Курс\n\n## План курса\n\n### День 1. Старая тема\n\n### День 2. Вторая\n'
        result = server.ensure_plan_heading(text, 1, 'Новая тема')
        self.assertIn('### День 1. Новая тема', result)
        self.assertEqual(result.count('### День 1'), 1)
        self.assertIn('### День 2. Вторая', result)

    def test_appends_heading_to_existing_plan(self):
        text = '# Курс\n\n## План курса\n\n### День 1. Первая\n'
        result = server.ensure_plan_heading(text, 2, 'Вторая')
        self.assertIn('### День 2. Вторая', result)
        self.assertIn('### День 1. Первая', result)

    def test_appends_plan_when_missing(self):
        text = '# Курс\n\nОписание\n'
        result = server.ensure_plan_heading(text, 1, 'Первая')
        self.assertIn('## План курса', result)
        self.assertIn('### День 1. Первая', result)

    def test_prefers_plan_section_over_body_heading(self):
        text = '# Курс\n\n### День 1. В теле\n\n## План курса\n\n### День 1. В плане\n'
        result = server.ensure_plan_heading(text, 1, 'Новая')
        self.assertIn('### День 1. В теле', result)
        self.assertIn('### День 1. Новая', result)
        self.assertNotIn('### День 1. В плане', result)


class GuardDecisionTests(unittest.TestCase):
    def test_parses_allowed(self):
        self.assertEqual(
            server.parse_guard_decision('{"allowed": true, "reason": "ok"}'),
            (True, 'ok'),
        )

    def test_parses_denied_with_text_around(self):
        self.assertEqual(
            server.parse_guard_decision('Ответ: {"allowed": false, "reason": "нет"} конец'),
            (False, 'нет'),
        )

    def test_rejects_invalid_payloads(self):
        for value in ('', 'не json', '{"allowed": "true"}', '{"reason": "нет"}', '[]'):
            with self.subTest(value=value):
                self.assertIsNone(server.parse_guard_decision(value))


class GuardPromptTests(unittest.TestCase):
    def test_includes_dialog_history_and_current_request(self):
        prompt = server.build_guard_prompt([
            {'role': 'user', 'content': 'Создай курс по Kafka'},
            {'role': 'assistant', 'content': 'Сколько дней?'},
            {'role': 'user', 'content': '3'},
        ], {'course_id': 'KAFKA', 'day': None})
        self.assertIn('Создай курс по Kafka', prompt)
        self.assertIn('Сколько дней?', prompt)
        self.assertIn('<request>\n3\n</request>', prompt)
        self.assertIn('курс: KAFKA', prompt)


class ChangeValidationTests(unittest.TestCase):
    def test_create_day_requires_practice(self):
        with self.assertRaises(server.ValidationError):
            server.normalize_change({
                'op': 'create_day',
                'course_id': 'KAFKA',
                'day': 1,
                'topic': 'Введение',
                'theory_md': '# Теория',
            })

    def test_create_course_builds_main_md(self):
        change = server.normalize_change({
            'op': 'create_course',
            'course_id': 'KAFKA',
            'title': 'Apache Kafka',
            'description': 'Курс по Kafka',
            'days': [{
                'day': 1,
                'topic': 'Введение',
                'theory_md': '# Теория',
                'practice_md': '# Практика',
            }],
        })
        self.assertIn('# Apache Kafka', change['main_md'])
        self.assertIn('## План курса', change['main_md'])
        self.assertIn('### День 1. Введение', change['main_md'])

    def test_rejects_unknown_operation(self):
        with self.assertRaises(server.ValidationError):
            server.normalize_change({'op': 'delete_course', 'course_id': 'KAFKA'})


class ConfigTests(unittest.TestCase):
    def test_rejects_non_http_url(self):
        with self.assertRaises(server.ValidationError):
            server.normalize_target_config({
                'provider': 'openai',
                'base_url': 'file:///etc/passwd',
                'model': 'test',
            })

    def test_clamps_numbers(self):
        config = server.normalize_target_config({
            'provider': 'ollama',
            'base_url': 'http://127.0.0.1:11434',
            'model': 'llama3.1',
            'temperature': 5,
            'top_p': -1,
            'num_ctx': 10,
        })
        self.assertEqual(config['temperature'], 2)
        self.assertEqual(config['top_p'], 0)
        self.assertEqual(config['num_ctx'], 256)

    def test_messages_require_last_user(self):
        with self.assertRaises(server.ValidationError):
            server.normalize_messages([{'role': 'assistant', 'content': 'ответ'}])


class JsonRepairTests(unittest.TestCase):
    def test_repairs_unescaped_quotes_and_newlines(self):
        raw = (
            '{"reply":"ok","changes":[{"op":"create_day","course_id":"C","day":1,'
            '"topic":"T","theory_md":"Код: print("hi")\nСтрока","practice_md":"# P"}]}'
        )
        result = server.parse_model_payload(raw)
        self.assertIsNone(result['parse_error'])
        self.assertEqual(len(result['changes']), 1)
        self.assertEqual(result['changes'][0]['theory_md'], 'Код: print("hi")\nСтрока')

    def test_keeps_valid_escaped_quotes(self):
        raw = '{"reply":"Сказал \\"привет\\"","changes":[]}'
        result = server.parse_model_payload(raw)
        self.assertIsNone(result['parse_error'])
        self.assertEqual(result['reply'], 'Сказал "привет"')

    def test_removes_trailing_commas(self):
        raw = (
            '{"reply":"ok","changes":[{"op":"create_day","course_id":"C","day":1,'
            '"topic":"T","theory_md":"# T","practice_md":"# P",},],}'
        )
        result = server.parse_model_payload(raw)
        self.assertIsNone(result['parse_error'])
        self.assertEqual(len(result['changes']), 1)

    def test_reports_truncated_json(self):
        raw = '{"reply":"ok","changes":[{"op":"create_course","course_id":"C","main_md":"# C\n...'
        result = server.parse_model_payload(raw)
        self.assertEqual(result['changes'], [])
        self.assertIn('оборван', result['parse_error'])

    def test_accepts_markdown_fence(self):
        raw = '```json\n{"reply":"ok","changes":[]}\n```'
        result = server.parse_model_payload(raw)
        self.assertIsNone(result['parse_error'])
        self.assertEqual(result['reply'], 'ok')


class ContextTests(unittest.TestCase):
    def test_context_accepts_display_course_id(self):
        self.assertEqual(
            server.normalize_context({'course_id': 'LLM arh', 'day': 1}),
            {'course_id': 'LLM arh', 'day': 1},
        )
        self.assertEqual(
            server.normalize_context({'course_id': 'Курс.1'}),
            {'course_id': 'Курс.1'},
        )

    def test_context_is_added_to_target_messages(self):
        captured = {}
        original = server.call_openai_chat

        def fake(base_url, api_key, model, messages, temperature, top_p, max_tokens, timeout, json_mode=False):
            captured['messages'] = messages
            return '{"reply":"ok","changes":[]}', None, 'stop'

        server.call_openai_chat = fake
        try:
            config = server.normalize_target_config({
                'provider': 'openai',
                'base_url': 'http://127.0.0.1:1/v1',
                'model': 'm',
                'api_key': '',
                'temperature': 0.2,
                'top_p': 0.9,
                'num_ctx': 1000,
            })
            server.call_target_model(
                config,
                [{'role': 'user', 'content': 'Создай день'}],
                {'course_id': 'KAFKA', 'day': 2},
            )
        finally:
            server.call_openai_chat = original

        system_prompt = captured['messages'][0]['content']
        user_message = captured['messages'][-1]['content']
        self.assertIn('Текущий контекст: курс: KAFKA, день: 2', system_prompt)
        self.assertIn('[Контекст: курс: KAFKA, день: 2]', user_message)
        self.assertIn('Создай день', user_message)


class SystemPromptTests(unittest.TestCase):
    def test_default_prompt_is_loaded_and_corrected(self):
        prompt = server.DEFAULT_TARGET_SYSTEM_PROMPT
        self.assertIn('create_course', prompt)
        self.assertIn('Ожидаемая структура ответа', prompt)
        self.assertIn('"reply"', prompt)
        self.assertIn('"changes"', prompt)
        self.assertIn('не оставляй сырые кавычки', prompt)
        self.assertIn('Самопроверка перед ответом', prompt)
        self.assertIn('иначе будет конфликт', prompt)
        self.assertNotIn('será', prompt)


class PasswordTests(unittest.TestCase):
    def setUp(self):
        self.old_hash = server.ADMIN_PASSWORD_HASH
        self.old_password = server.ADMIN_PASSWORD

    def tearDown(self):
        server.ADMIN_PASSWORD_HASH = self.old_hash
        server.ADMIN_PASSWORD = self.old_password

    def test_colon_hash(self):
        salt = b'0123456789abcdef'
        digest = server.hashlib.pbkdf2_hmac('sha256', b'secret', salt, 1000)
        server.ADMIN_PASSWORD_HASH = 'pbkdf2_sha256:1000:%s:%s' % (salt.hex(), digest.hex())
        server.ADMIN_PASSWORD = ''
        self.assertTrue(server.verify_admin_password('secret'))
        self.assertFalse(server.verify_admin_password('wrong'))

    def test_dollar_hash(self):
        salt = b'fedcba9876543210'
        digest = server.hashlib.pbkdf2_hmac('sha256', b'secret', salt, 1000)
        server.ADMIN_PASSWORD_HASH = 'pbkdf2_sha256$1000$%s$%s' % (salt.hex(), digest.hex())
        server.ADMIN_PASSWORD = ''
        self.assertTrue(server.verify_admin_password('secret'))

    def test_plain_fallback(self):
        server.ADMIN_PASSWORD_HASH = ''
        server.ADMIN_PASSWORD = 'secret'
        self.assertTrue(server.verify_admin_password('secret'))
        self.assertFalse(server.verify_admin_password('wrong'))


class ApplyTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.old_course_dir = server.COURSE_DIR
        self.old_backup_dir = server.BACKUP_DIR
        server.COURSE_DIR = self.temp_dir.name
        server.BACKUP_DIR = os.path.join(self.temp_dir.name, '.backups')

    def tearDown(self):
        server.COURSE_DIR = self.old_course_dir
        server.BACKUP_DIR = self.old_backup_dir
        self.temp_dir.cleanup()

    def test_create_course_and_day_in_one_batch(self):
        results = server.apply_changes([
            {
                'op': 'create_course',
                'course_id': 'BATCH',
                'title': 'Batch',
                'main_md': '# Batch\n\n## План курса\n',
            },
            {
                'op': 'create_day',
                'course_id': 'BATCH',
                'day': 1,
                'topic': 'Первый день',
                'theory_md': '# Теория\n',
                'practice_md': '# Практика\n',
            },
        ])
        self.assertEqual(len(results), 2)
        self.assertTrue(os.path.isfile(os.path.join(self.temp_dir.name, 'BATCH', 'main.md')))
        self.assertTrue(os.path.isfile(os.path.join(self.temp_dir.name, 'BATCH', 'day1_theory.md')))
        self.assertTrue(os.path.isfile(os.path.join(self.temp_dir.name, 'BATCH', 'day1_practice.md')))
        with open(os.path.join(self.temp_dir.name, 'BATCH', 'main.md'), encoding='utf-8') as file:
            content = file.read()
        self.assertIn('### День 1. Первый день', content)

    def test_duplicate_course_in_batch_is_rejected(self):
        with self.assertRaises(server.ConflictError):
            server.check_conflicts([
                {'op': 'create_course', 'course_id': 'BATCH', 'main_md': '# Batch\n'},
                {'op': 'create_course', 'course_id': 'BATCH', 'main_md': '# Batch 2\n'},
            ])


if __name__ == '__main__':
    unittest.main()
