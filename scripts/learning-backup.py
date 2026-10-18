"""Consistent SQLite and file backup. Stop the learning service before invoking backup."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import tarfile
import tempfile
from contextlib import closing


def digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(part)
    return result.hexdigest()


def verify(directory, manifest):
    for name, expected in manifest['files'].items():
        path = directory / name
        if not path.is_file() or digest(path) != expected:
            raise ValueError('备份文件不完整：' + name)
    with closing(sqlite3.connect(directory / 'workbench.db')) as database:
        if database.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('数据库完整性验证失败')
        for table, folder in [('Material', 'uploads'), ('InboxItem', 'import-inbox')]:
            for (stored,) in database.execute('SELECT filePath FROM ' + table):
                name = stored.replace('\\', '/').split('/')[-1]
                if folder + '/' + name not in manifest['files']:
                    raise ValueError('数据库引用的原文件未包含在备份中：' + name)


def backup(source, target):
    source, target = source.resolve(), target.resolve()
    if source == target or source in target.parents or target.exists():
        raise ValueError('备份必须保存到数据目录以外的新文件，已有备份不会覆盖')
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='learning-backup-') as temporary:
        snapshot = Path(temporary)
        with closing(sqlite3.connect(source / 'workbench.db')) as original, closing(sqlite3.connect(snapshot / 'workbench.db')) as copy:
            original.backup(copy)
        for item in source.rglob('*'):
            relative = item.relative_to(source)
            if item.is_symlink():
                raise ValueError('数据目录不能包含符号链接')
            if item.is_file() and relative.parts[0] != 'backups' and not item.name.startswith('workbench.db') and not item.name.endswith('.tmp'):
                destination = snapshot / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(item, destination)
        manifest = {'format': 1, 'files': {str(item.relative_to(snapshot)).replace('\\', '/'): digest(item) for item in snapshot.rglob('*') if item.is_file()}}
        verify(snapshot, manifest)
        (snapshot / 'backup-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
        with tarfile.open(target, 'w:gz') as archive:
            for item in snapshot.rglob('*'):
                if item.is_file():
                    archive.add(item, arcname=str(item.relative_to(snapshot)).replace('\\', '/'), recursive=False)
    os.chmod(target, 0o600)
    print('备份已创建并验证：', target, '文件数：', len(manifest['files']))


def restore(source, target):
    target = target.resolve()
    if target.exists() and any(target.iterdir()):
        raise ValueError('恢复目标必须是新的空目录，现有学习空间不会覆盖')
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(source, 'r:gz') as archive:
        seen = set()
        for member in archive.getmembers():
            name = PurePosixPath(member.name)
            if not member.isfile() or name.is_absolute() or '..' in name.parts or '\\' in member.name or ':' in member.name or member.name in seen:
                raise ValueError('备份包含不安全或重复的路径')
            seen.add(member.name)
            destination = target.joinpath(*name.parts)
            if target not in destination.resolve().parents:
                raise ValueError('恢复路径超出目标目录')
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as original, destination.open('xb') as output:
                shutil.copyfileobj(original, output)
    manifest = json.loads((target / 'backup-manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 1:
        raise ValueError('备份格式不可识别')
    for name in manifest['files']:
        if '..' in PurePosixPath(name).parts or PurePosixPath(name).is_absolute() or '\\' in name or ':' in name:
            raise ValueError('清单路径不可识别')
    verify(target, manifest)
    print('恢复已完成，数据库和所有文件校验通过：', target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['backup', 'restore'])
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    arguments = parser.parse_args()
    try:
        (backup if arguments.action == 'backup' else restore)(arguments.source, arguments.target)
    except (ValueError, OSError, sqlite3.Error, tarfile.TarError) as error:
        parser.exit(1, str(error) + '\n')
