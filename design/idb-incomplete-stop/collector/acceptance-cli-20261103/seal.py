"""SHA-256 manifest for only this new verification directory."""
import pathlib, hashlib, sys
root = pathlib.Path(__file__).resolve().parent
manifest = root / 'records/SHA256SUMS'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
if sys.argv[1] == 'create':
    if manifest.exists(): raise RuntimeError('manifest already exists')
    files = sorted(p for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts)
    manifest.write_bytes(''.join(digest(p) + '  ' + p.relative_to(root).as_posix() + '\n' for p in files).encode())
elif sys.argv[1] == 'verify':
    count = 0
    for line in manifest.read_text(encoding='utf-8').splitlines():
        sha, name = line.split('  ', 1)
        assert '..' not in pathlib.PurePosixPath(name).parts
        assert digest(root / name) == sha, name
        count += 1
    print('verified', count, 'new verification files')
else: raise RuntimeError('expected create or verify')
