from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/node/backup.py'


def database(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db, db:
        db.execute('CREATE TABLE marker(value TEXT)')
        db.execute('INSERT INTO marker VALUES(?)', (value,))


def run(environment):
    # The caller's own variables must not decide which database the script finds.
    inherited = {key: value for key, value in os.environ.items() if key not in ('DATABASE_PATH', 'ROCKSHOWBOT_ENV_FILE', 'ROCKSHOWBOT_CONFIG_DIR')}
    return subprocess.run([sys.executable, '-B', str(SCRIPT)], env={**inherited, **environment}, capture_output=True, text=True)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'data'

    def archived(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        with tarfile.open(result.stdout.strip()) as bundle:
            manifest = json.load(bundle.extractfile('manifest.json'))
            files = {name: bundle.extractfile(name).read() for name in manifest['files']}
            self.assertEqual(sorted(bundle.getnames()), sorted([*files, 'manifest.json']))
        for name, content in files.items():
            self.assertEqual(hashlib.sha256(content).hexdigest(), manifest['files'][name])
        return files

    def marker(self, content):
        copy = Path(self.temporary.name) / 'restored.db'
        copy.write_bytes(content)
        with closing(sqlite3.connect(copy)) as db:
            return db.execute('SELECT value FROM marker').fetchone()[0]

    def test_real_file_name_and_every_account_database_are_archived(self):
        database(self.root / 'radar.db', 'owner')
        database(self.root / 'users' / 'guest.db', 'guest')
        files = self.archived(run({'DATABASE_PATH': str(self.root / 'radar.db')}))
        self.assertEqual(sorted(files), ['radar.db', 'users/guest.db'])
        self.assertEqual(self.marker(files['radar.db']), 'owner')
        self.assertEqual(self.marker(files['users/guest.db']), 'guest')

    def test_path_comes_from_node_env_when_the_shell_does_not_export_it(self):
        database(self.root / 'custom.db', 'owner')
        config = Path(self.temporary.name) / 'node.env'
        config.write_text("APP_USER=admin\nDATABASE_PATH='" + str(self.root / 'custom.db') + "'\nSMTP_HOST=\n")
        self.assertEqual(sorted(self.archived(run({'ROCKSHOWBOT_ENV_FILE': str(config)}))), ['custom.db'])

    def test_missing_main_database_fails_without_writing_an_archive(self):
        database(self.root / 'users' / 'guest.db', 'guest')
        result = run({'DATABASE_PATH': str(self.root / 'web.db')})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), '')
        self.assertFalse((self.root / 'backups').exists())


if __name__ == '__main__':
    unittest.main()
