"""Package deployable source without learning data, caches or environment secrets."""
from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parent.parent
target = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'tmp' / 'lms-private-cloud.zip'
if target.exists():
    raise SystemExit('Archive already exists; choose a new filename.')
target.parent.mkdir(parents=True, exist_ok=True)
names = ['package.json', 'package-lock.json', 'next.config.ts', 'next-env.d.ts',
         'tsconfig.json', 'vitest.config.mts', 'postcss.config.mjs', 'README.md',
         'Dockerfile', '.dockerignore', '.gitignore', '.env.example']
files = [root / name for name in names if (root / name).is_file()]
for folder in ['src', 'scripts', 'prisma', 'public', 'assets', 'deploy']:
    for file in (root / folder).rglob('*'):
        if file.is_file() and not file.is_symlink() and '__pycache__' not in file.parts and not file.name.startswith('.env') and not file.name.endswith(('.db', '.db-journal', '.db-wal', '.db-shm')):
            files.append(file)
files += [root / 'docs' / 'notebook-validation.md']
manifest = {}
with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(set(files)):
        name = file.relative_to(root).as_posix()
        content = file.read_bytes()
        manifest[name] = hashlib.sha256(content).hexdigest()
        archive.writestr('LMS/' + name, content)
    archive.writestr('LMS/package-manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(target) as archive:
    if archive.testzip():
        raise SystemExit('Archive integrity check failed.')
    assert all('LMS/' + name in archive.namelist() for name in ['Dockerfile', 'package-lock.json', 'prisma/schema.prisma', 'deploy/compose.yml', 'scripts/cloud-start.mjs'])
    assert not any(name.startswith(('LMS/data/', 'LMS/.next', 'LMS/node_modules/')) or name.endswith(('/.env', '/.env.local', '/.env.cloud')) for name in archive.namelist())
    for name, digest in manifest.items():
        assert hashlib.sha256(archive.read('LMS/' + name)).hexdigest() == digest
target.with_suffix(target.suffix + '.sha256').write_text(hashlib.sha256(target.read_bytes()).hexdigest() + '\n', encoding='ascii')
print(f'Package verified: {target} ({len(manifest)} files, {target.stat().st_size / 1024 / 1024:.1f} MiB)')
