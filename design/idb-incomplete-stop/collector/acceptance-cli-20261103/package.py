"""Seal fresh offline acceptance evidence; never overwrite a prior records directory."""
import pathlib, subprocess, hashlib, json, sys, gzip, tarfile, io, posixpath, shutil, datetime

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]
FIXED = 'e4a5d414689f23e1b33660bce3e006c46fb4e37f'
RUN, AUDIT = (pathlib.Path(x).resolve() for x in sys.argv[1:3])
OUT = HERE / 'records'
if OUT.exists(): raise RuntimeError('refusing to overwrite records')
OUT.mkdir()
def sha(b): return hashlib.sha256(b).hexdigest()
def command(args, cwd=REPO):
    if args[0] == 'git': args = ['git', '-c', 'safe.directory=' + str(cwd).replace('\\', '/'), *args[1:]]
    p = subprocess.run(args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode: raise RuntimeError(p.stderr.decode('utf-8', 'replace'))
    return p.stdout
def save(name, value):
    (OUT / name).write_bytes((json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode())
def compressed(name, data):
    (OUT / name).write_bytes(gzip.compress(data, mtime=0))
def archive(name, base, paths):
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode='w', format=tarfile.PAX_FORMAT) as tar:
        for rel in sorted(set(paths)):
            assert not pathlib.PurePosixPath(rel).is_absolute() and '..' not in pathlib.PurePosixPath(rel).parts
            data = (base / rel).read_bytes()
            item = tarfile.TarInfo(rel); item.size = len(data); item.mode = 0o644; item.mtime = 0
            tar.addfile(item, io.BytesIO(data))
    compressed(name, stream.getvalue())
def files(base): return [p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()]

# Recheck every pre-existing tracked research file and modified/untracked file in all worktrees.
before = json.loads((AUDIT / 'before.json').read_bytes()); checks = []; checked = 0
target = str(REPO).replace('\\', '/')
after = []
for old in before['worktrees']:
    cwd = pathlib.Path(old['path']); head = command(['git', 'rev-parse', 'HEAD'], cwd).decode().strip()
    status = command(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd)
    assert head == old['head'], (cwd, 'HEAD changed')
    is_target = str(cwd).replace('\\', '/').lower() == target.lower()
    if not is_target: assert status.hex() == old['statusHex'], (cwd, 'status changed')
    hashes = {}
    for rel, expected in old['files'].items():
        p = cwd / rel; actual = sha(p.read_bytes()) if p.is_file() else None
        assert actual == expected, (cwd, rel, 'pre-existing file changed')
        hashes[rel] = actual; checked += 1
    after.append(dict(path=str(cwd), head=head, statusHex=status.hex(), originalFiles=hashes))
assert command(['git', 'rev-parse', 'HEAD']).decode().strip() == FIXED
new_status = command(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'])
assert all(b'collector/acceptance-cli-20261103/' in row for row in new_status.split(b'\0') if row)
save('preservation.json', dict(worktrees=len(after), originalFilesChecked=checked, allOriginalFilesUnchanged=True,
     otherWorktreeHeadsAndStatusesUnchanged=True, targetHeadUnchangedBeforeEvidenceCommit=True,
     onlyNewVerificationDirectory=True, capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat()))
compressed('before.json.gz', (AUDIT / 'before.json').read_bytes())
compressed('after.json.gz', (json.dumps(after, ensure_ascii=False, indent=2) + '\n').encode())

# Independently check the entire earlier CLI-fix manifest against fixed Git blob bytes, not checkout filters.
manifest_base = 'design/idb-incomplete-stop/collector/diagnostic-fix/cli-error'
manifest_path = manifest_base + '/records/SHA256SUMS'
manifest = command(['git', 'cat-file', 'blob', FIXED + ':' + manifest_path])
entries = []
for line in manifest.decode().splitlines():
    digest, rel = line.split('  ', 1)
    path = posixpath.normpath(manifest_base + '/' + rel)
    assert path.startswith('design/idb-incomplete-stop/')
    entries.append((digest, path))
p = subprocess.run(['git', 'cat-file', '--batch'], cwd=REPO,
    input=''.join(FIXED + ':' + path + '\n' for _, path in entries).encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
assert p.returncode == 0; raw = p.stdout; offset = 0
for digest, path in entries:
    end = raw.index(b'\n', offset); size = int(raw[offset:end].split()[-1]); data = raw[end+1:end+size+1]; offset = end+size+2
    assert sha(data) == digest, path
save('prior-manifest-check.json', dict(fixed=FIXED, manifest=manifest_path, manifestSha256=sha(manifest),
     entriesChecked=len(entries), allGitBlobHashesMatch=True))

prepared = json.loads((RUN / 'prepared.json').read_bytes())
for item in prepared['files']:
    assert sha((RUN / item['root'] / item['path']).read_bytes()) == item['sha256']
archive('fixed-sources.tar.gz', RUN, ['prepared.json'] + [item['root'] + '/' + item['path'] for item in prepared['files']])
archive('dynamic-final.tar.gz', RUN / 'dynamic-final', files(RUN / 'dynamic-final'))
archive('dynamic-first-execution.tar.gz', RUN / 'dynamic', files(RUN / 'dynamic'))
archive('regression.tar.gz', RUN / 'regression', files(RUN / 'regression'))
archive('same-argv.tar.gz', RUN / 'same-argv', files(RUN / 'same-argv'))
for name in ['prepared.json', 'regression-check.json', 'output-comparisons.json', 'comparison-preflight.json']:
    shutil.copyfile(RUN / name, OUT / name)
for name in ['environment.json', 'summary.json', 'oracle.json']:
    shutil.copyfile(RUN / 'dynamic-final' / name, OUT / ('dynamic-' + name))
for label in ['old', 'new']:
    shutil.copyfile(RUN / 'dynamic-final' / label / 'contract-checks.tap', OUT / (label + '-16.tap'))
for group in ['regression96', 'regression69', 'regression18']:
    shutil.copyfile(RUN / 'regression' / group / 'tests.tap', OUT / (group + '.tap'))
    shutil.copyfile(RUN / 'regression' / (group + '.process.json'), OUT / (group + '.process.json'))
for path in AUDIT.glob('*.json'):
    if path.name != 'before.json': compressed('github-' + path.name + '.gz', path.read_bytes())
for path in ['start.py', 'comparator-initial.cjs']:
    if (AUDIT / path).is_file(): shutil.copyfile(AUDIT / path, OUT / path)
generated = RUN / 'authored-fixtures'
fixture_checks = []
for p in generated.iterdir():
    if p.is_file():
        expected = RUN / 'new/design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/fixtures' / p.name
        assert p.read_bytes() == expected.read_bytes(), p.name
        fixture_checks.append(dict(file=p.name, sha256=sha(p.read_bytes()), fixedFixtureBytesEqual=True))
save('fixture-authorship-check.json', fixture_checks)
save('scope.json', dict(P2DynamicAcceptance='PASS', P2Closure='YES', implementationChanged=False,
    fixedOld=prepared['old'], fixedNew=prepared['new'], base=prepared['base'],
    PRWhole='PARTIAL', mergeRecommendation='NO', draft=True,
    hypotheses=dict(H1='UNKNOWN', H2='UNKNOWN', H3='UNKNOWN', H4='PARTIAL'),
    conditionU='NOT_RUN', realExperiment='NOT_RUN', executionAuthorization='NOT_GRANTED',
    startCondition='BLOCKED', productionWorker='HOLD', realOSCloseEIO='NOT_TESTED', R2P3='UNRESOLVED_UNCHANGED'))
print(json.dumps(dict(records=str(OUT), originalFilesChecked=checked, worktrees=len(after), priorManifestEntries=len(entries))))
