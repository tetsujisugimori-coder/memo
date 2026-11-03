"""Manifest for this new directory. Historical manifests remain tied to their fixed versions."""
import pathlib, hashlib, sys
root=pathlib.Path(__file__).resolve().parent
manifest=root/'records/SHA256SUMS'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if sys.argv[1]=='create':
    if manifest.exists():raise RuntimeError('never overwrite a manifest')
    manifest.write_bytes(''.join(sha(p)+'  '+p.relative_to(root).as_posix()+'\n' for p in sorted(root.rglob('*')) if p.is_file() and '__pycache__' not in p.parts).encode())
elif sys.argv[1]=='verify':
    lines=manifest.read_text().splitlines()
    for line in lines:
        digest,rel=line.split('  ',1); assert '..' not in pathlib.PurePosixPath(rel).parts
        assert sha(root/rel)==digest,rel
    print('verified',len(lines),'new evidence files')
else:raise RuntimeError('expected create or verify')
