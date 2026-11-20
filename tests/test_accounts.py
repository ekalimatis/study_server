import os
import tempfile
import unittest

import accounts
import server


class AccountLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.old_path = accounts.DB_PATH
        self.tempdir = tempfile.TemporaryDirectory()
        accounts.set_db_path(os.path.join(self.tempdir.name, 'test.db'))
        accounts.init_db()

    def tearDown(self):
        accounts.set_db_path(self.old_path)
        self.tempdir.cleanup()

    def test_group_admin_and_user_lifecycle(self):
        created = accounts.create_group_with_admin('Группа 1', 'teacher', 'password123')
        group_id = created['group']['id']
        self.assertIsNone(created['user'].get('password_hash'))
        self.assertEqual(created['user']['role'], 'admin')

        user = accounts.create_user('student', 'password123', group_id)
        self.assertEqual(user['role'], 'user')
        self.assertIsNone(user.get('password_hash'))

        users = accounts.list_users(group_id)
        self.assertEqual([item['username'] for item in users], ['student', 'teacher'])

        accounts.set_password(user['id'], 'newpassword123')
        stored = accounts.get_user_by_username('student')
        self.assertTrue(accounts.verify_password('newpassword123', stored['password_hash']))
        self.assertFalse(accounts.verify_password('password123', stored['password_hash']))

        accounts.update_user(user['id'], username='student2', active=False)
        updated = accounts.get_user(user['id'])
        self.assertEqual(updated['username'], 'student2')
        self.assertFalse(updated['active'])

    def test_one_admin_per_group(self):
        first = accounts.create_group_with_admin('Группа 1', 'teacher1', 'password123')
        with self.assertRaises(accounts.AccountConflict):
            accounts.create_user('teacher2', 'password123', first['group']['id'], role='admin')

        second = accounts.create_group_with_admin('Группа 2', 'teacher2', 'password123')
        with self.assertRaises(accounts.AccountConflict):
            accounts.update_user(second['user']['id'], group_id=first['group']['id'])

    def test_course_group_mapping(self):
        group = accounts.create_group_with_admin('Группа 1', 'teacher', 'password123')['group']
        accounts.set_course_group('KAFKA', group['id'])
        self.assertEqual(accounts.get_course_group('KAFKA'), group['id'])
        self.assertEqual(accounts.course_groups_map(), {'KAFKA': group['id']})
        self.assertEqual(accounts.get_group(group['id'])['course_count'], 1)
        accounts.set_course_group('KAFKA', None)
        self.assertIsNone(accounts.get_course_group('KAFKA'))
        self.assertEqual(accounts.course_groups_map(), {})


class PathSecurityTests(unittest.TestCase):
    def test_encoded_course_path_is_decoded(self):
        parts = server.CustomHandler.course_path_parts(None, '/COURSE%2FKAFKA%2Fmain.md')
        self.assertEqual(parts, ['COURSE', 'KAFKA', 'main.md'])

    def test_course_prefix_is_case_insensitive(self):
        parts = server.CustomHandler.course_path_parts(None, '/course/KAFKA/main.md')
        self.assertEqual(parts, ['course', 'KAFKA', 'main.md'])

    def test_encoded_busy_directories_are_blocked(self):
        self.assertTrue(server.CustomHandler.is_blocked('/%64ata/study.db'))
        self.assertTrue(server.CustomHandler.is_blocked('/COURSE/../data/study.db'))
        self.assertFalse(server.CustomHandler.is_blocked('/COURSE/KAFKA/main.md'))


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.old_path = accounts.DB_PATH
        self.old_chief = server.CHIEF_USERNAME
        server.CHIEF_USERNAME = 'admin'
        self.tempdir = tempfile.TemporaryDirectory()
        accounts.set_db_path(os.path.join(self.tempdir.name, 'test.db'))
        accounts.init_db()

    def tearDown(self):
        server.CHIEF_USERNAME = self.old_chief
        accounts.set_db_path(self.old_path)
        self.tempdir.cleanup()

    def test_db_user_authentication_and_deactivation(self):
        accounts.create_group_with_admin('Группа 1', 'teacher', 'password123')
        identity = server.authenticate_user('teacher', 'password123')
        self.assertEqual(identity['role'], 'admin')
        self.assertEqual(identity['username'], 'teacher')
        self.assertIsNone(server.authenticate_user('teacher', 'wrong-password'))

        user = accounts.get_user_by_username('teacher')
        accounts.update_user(user['id'], active=False)
        self.assertIsNone(server.authenticate_user('teacher', 'password123'))

    def test_chief_username_is_reserved_for_database_accounts(self):
        with self.assertRaises(server.ValidationError):
            server.validate_account_username('admin')

    def test_authorize_changes_keeps_admin_inside_group(self):
        group_one = accounts.create_group_with_admin('Группа 1', 'teacher1', 'password123')['group']
        group_two = accounts.create_group_with_admin('Группа 2', 'teacher2', 'password123')['group']
        accounts.set_course_group('OTHER', group_two['id'])
        identity = {'user_id': 1, 'username': 'teacher1', 'role': 'admin', 'group_id': group_one['id']}

        assignments = server.authorize_changes(identity, [
            {'op': 'create_course', 'course_id': 'NEW', 'title': 'New', 'main_md': '# New', 'days': []},
        ], {'group_id': group_one['id']})
        self.assertEqual(assignments, {'NEW': group_one['id']})

        with self.assertRaises(server.NotFoundError):
            server.authorize_changes(identity, [
                {'op': 'update_course', 'course_id': 'OTHER', 'title': '', 'main_md': '# Other'},
            ], {'group_id': group_one['id']})


if __name__ == '__main__':
    unittest.main()
