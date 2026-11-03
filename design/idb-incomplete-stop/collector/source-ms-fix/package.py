"""Seal new R2 evidence without changing any previous evidence or manifest."""
import pathlib, subprocess, hashlib, json, sys, gzip, tarfile, io, posixpath, shutil, datetime, platform, importlib.util
HERE=pathlib.Path(__file__).resolve().parent
REPO=HERE.parents[3]
FIXED='8873b351b17e2a0e2a7a6367718ef37baadb8c99'
RUN,AUDIT=(pathlib.Path(x).resolve() for x in sys.argv[1:3])
OUT=HERE/'records'
if OUT.exists():raise RuntimeError('never overwrite evidence')
OUT.mkdir()
def sha(b):return hashlib.sha256(b).hexdigest()
def git(*args,data=None):
    return subprocess.run(['git',*args],cwd=REPO,input=data,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
def save(name,value): (OUT/name).write_bytes((json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode())
def gz(name,data): (OUT/name).write_bytes(gzip.compress(data,mtime=0))
def archive(name,base,paths=None):
    if paths is None:paths=[p.relative_to(base).as_posix() for p in base.rglob('*') if p.is_file()]
    stream=io.BytesIO()
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.PAX_FORMAT) as tar:
        for name_in in sorted(paths):
            assert '..' not in pathlib.PurePosixPath(name_in).parts
            data=(base/name_in).read_bytes(); entry=tarfile.TarInfo(name_in); entry.size=len(data); entry.mode=0o644; entry.mtime=0
            tar.addfile(entry,io.BytesIO(data))
    gz(name,stream.getvalue())

# The same read-only snapshot implementation used at task start. This is an audit input, not a validator oracle.
helper=AUDIT.parent/'idb-evidence-u1-audit/capture.py'
spec=importlib.util.spec_from_file_location('capture',helper); capture=importlib.util.module_from_spec(spec); spec.loader.exec_module(capture)
before=json.loads((AUDIT/'before.json').read_bytes()); after=capture.snapshot(); current={w['path']:w for w in after['worktrees']}
collect='design/idb-incomplete-stop/collector/collect.cjs'; changed=[]; count=0
for old in before['worktrees']:
    new=current[old['path']]; is_target=pathlib.Path(old['path']).resolve()==REPO.resolve()
    assert old['head']==new['head']
    if not is_target:assert old['statusHex']==new['statusHex']
    for path,digest in old['files'].items():
        count+=1; actual=new['files'].get(path)
        if digest!=actual:
            assert is_target and path==collect
            assert actual==sha((RUN/'new'/collect).read_bytes())
            changed.append(dict(path=path,before=digest,after=actual))
assert len(changed)==1
assert git('rev-parse','HEAD').decode().strip()==FIXED
status=git('status','--porcelain=v1','-z','--untracked-files=all')
for line in status.split(b'\0'):
    if line:assert b'collector/source-ms-fix/' in line or line[3:].decode()==collect
gz('before.json.gz',(AUDIT/'before.json').read_bytes()); gz('after.json.gz',(json.dumps(after,ensure_ascii=False,indent=2)+'\n').encode())
save('preservation.json',dict(worktrees=len(before['worktrees']),originalFilesChecked=count,onlyExpectedChange=changed,
    unchangedOriginalFiles=count-1,other61WorktreeHeadsAndStatusesUnchanged=True,existingUntrackedFilesPreserved=True))

manifest_checks=[]
for base in ['design/idb-incomplete-stop/collector/diagnostic-fix/cli-error','design/idb-incomplete-stop/collector/acceptance-cli-20261103']:
    manifest=git('cat-file','blob',FIXED+':'+base+'/records/SHA256SUMS'); entries=[]
    for line in manifest.decode().splitlines():
        digest,rel=line.split('  ',1); name=posixpath.normpath(base+'/'+rel)
        assert name.startswith('design/idb-incomplete-stop/'); entries.append((digest,name))
    raw=git('cat-file','--batch',data=''.join(FIXED+':'+name+'\n' for _,name in entries).encode()); offset=0
    for digest,name in entries:
        end=raw.index(b'\n',offset); size=int(raw[offset:end].split()[-1]); data=raw[end+1:end+size+1]; offset=end+size+2
        assert sha(data)==digest,name
    manifest_checks.append(dict(fixed=FIXED,path=base+'/records/SHA256SUMS',manifestSha256=sha(manifest),entries=len(entries),gitBlobsMatch=True))
save('prior-manifests.json',manifest_checks)
index=json.loads((RUN/'fixed-source-index.json').read_bytes())
for entry in index['files']:
    assert sha((RUN/'old'/entry['path']).read_bytes())==entry['sha256']
    if entry['path']!=collect:assert sha((RUN/'new'/entry['path']).read_bytes())==entry['sha256']
archive('fixed-and-candidate-sources.tar.gz',RUN,['fixed-source-index.json']+[phase+'/'+e['path'] for phase in ['old','new'] for e in index['files']])
for name in ['fixtures','red','green','regression','same-argv']:archive(name+'.tar.gz',RUN/name)
for name in ['red-before-edit.json','verification.json','output-differences.json','fixed-source-index.json']:shutil.copyfile(RUN/name,OUT/name)
for phase in ['red','green']:
    for name in ['tests.tap','process.json','environment.json']:shutil.copyfile(RUN/phase/name,OUT/(phase+'-'+name))
for phase in ['old','new']:
    for group in ['regression96','regression69','regression18','cli16']:
        shutil.copyfile(RUN/'regression'/phase/group/'tests.tap',OUT/(phase+'-'+group+'.tap'))
shutil.copyfile(RUN/'regression/processes.json',OUT/'regression-processes.json')
shutil.copyfile(RUN/'fixtures/expectations.json',OUT/'expectations.json')
for p in AUDIT.glob('*.json'):
    if p.name!='before.json':gz('github-'+p.name+'.gz',p.read_bytes())
save('environment.json',dict(os=platform.platform(),python=platform.python_version(),capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),
    fixedHead=FIXED,candidateCollectorSha256=sha((RUN/'new'/collect).read_bytes()),
    implementationChange='validateInto only; 4 added / 3 removed lines',inputAndResultSchemasChanged=False,originalTestsChanged=False,
    selfVerification='PASS',wholePR='PARTIAL',independentR2Review='PENDING',mergeRecommendation='NO',
    conditionU='NOT_RUN',realExperiment='NOT_RUN',executionAuthorization='NOT_GRANTED',startCondition='BLOCKED',productionWorker='HOLD',
    hypotheses=dict(H1='UNKNOWN',H2='UNKNOWN',H3='UNKNOWN',H4='PARTIAL')))
print(json.dumps(dict(originalFiles=count,unchanged=count-1,worktrees=len(before['worktrees']),priorManifestEntries=sum(m['entries'] for m in manifest_checks),records=str(OUT))))
