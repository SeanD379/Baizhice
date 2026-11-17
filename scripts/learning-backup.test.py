import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest


spec = importlib.util.spec_from_file_location('learning_backup', Path(__file__).with_name('learning-backup.py'))
learning_backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(learning_backup)


class LearningBackupTest(unittest.TestCase):
    def test_restored_learning_space_can_be_backed_up_and_restored_again(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / 'source'
            (source / 'uploads').mkdir(parents=True)
            original = source / 'uploads' / 'original.txt'
            original.write_text('学习资料原件', encoding='utf-8')
            with closing(sqlite3.connect(source / 'workbench.db')) as database:
                database.execute('CREATE TABLE Material (filePath TEXT)')
                database.execute('INSERT INTO Material VALUES (?)', (str(original),))
                database.execute('CREATE TABLE InboxItem (filePath TEXT)')
                database.execute('CREATE TABLE Notebook (content TEXT)')
                database.execute('INSERT INTO Notebook VALUES (?)', ('原有笔记内容',))
                database.commit()
            first, second = directory / 'first.tar.gz', directory / 'second.tar.gz'
            restored, restored_again = directory / 'restored', directory / 'restored-again'
            learning_backup.backup(source, first)
            learning_backup.restore(first, restored)
            learning_backup.backup(restored, second)
            learning_backup.restore(second, restored_again)
            self.assertEqual((restored_again / 'uploads' / 'original.txt').read_bytes(), original.read_bytes())
            with closing(sqlite3.connect(restored_again / 'workbench.db')) as database:
                self.assertEqual(database.execute('SELECT content FROM Notebook').fetchone()[0], '原有笔记内容')


if __name__ == '__main__':
    unittest.main()
