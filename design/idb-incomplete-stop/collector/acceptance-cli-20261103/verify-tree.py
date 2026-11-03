"""After the evidence commit, require every earlier Git blob/mode to remain unchanged."""
import subprocess, pathlib, hashlib, json
root = pathlib.Path(__file__).resolve().parents[4]
fixed = 'e4a5d414689f23e1b33660bce3e006c46fb4e37f'
prefix = 'design/idb-incomplete-stop/collector/acceptance-cli-20261103/'
def git(*args):
    return subprocess.run(['git', *args], cwd=root, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
def tree(ref):
    result = {}
    for row in git('ls-tree', '-rz', ref).split(b'\0'):
        if row:
            meta, name = row.split(b'\t', 1); mode, kind, blob = meta.decode().split()
            result[name.decode()] = dict(mode=mode, kind=kind, blob=blob)
    return result
old, new = tree(fixed), tree('HEAD')
for path, entry in old.items(): assert new.get(path) == entry, path
added = sorted(set(new) - set(old))
assert added and all(path.startswith(prefix) for path in added)
manifest = git('cat-file', 'blob', 'HEAD:' + prefix + 'records/SHA256SUMS')
checks = []
for row in manifest.decode().splitlines():
    digest, name = row.split('  ', 1)
    actual = hashlib.sha256(git('cat-file', 'blob', 'HEAD:' + prefix + name)).hexdigest()
    assert digest == actual, name
    checks.append(name)
print(json.dumps(dict(fixed=fixed, head=git('rev-parse', 'HEAD').decode().strip(), oldGitEntriesUnchanged=len(old),
    oldModesAndBlobsUnchanged=True, addedVerificationFiles=len(added), newManifestEntriesChecked=len(checks),
    implementationChanged=False, manifestMatchesGitBlobs=True)))
