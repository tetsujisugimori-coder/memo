"""Post-commit: permit only validateInto source + the new source-ms-fix directory."""
import pathlib, subprocess, json, hashlib
repo=pathlib.Path(__file__).resolve().parents[4]
fixed='8873b351b17e2a0e2a7a6367718ef37baadb8c99'
prefix='design/idb-incomplete-stop/collector/source-ms-fix/'
collect='design/idb-incomplete-stop/collector/collect.cjs'
def git(*args):return subprocess.run(['git',*args],cwd=repo,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
def tree(ref):
    rows={}
    for row in git('ls-tree','-rz',ref).split(b'\0'):
        if row:
            meta,name=row.split(b'\t',1); rows[name.decode()]=meta.decode()
    return rows
before,after=tree(fixed),tree('HEAD'); changed=[]
for path,meta in before.items():
    if after.get(path)!=meta:changed.append(path)
assert changed==[collect]
assert before[collect].split()[0]==after[collect].split()[0]
added=sorted(set(after)-set(before)); assert added and all(p.startswith(prefix) for p in added)
checks=[]
for line in git('cat-file','blob','HEAD:'+prefix+'records/SHA256SUMS').decode().splitlines():
    digest,name=line.split('  ',1); assert hashlib.sha256(git('cat-file','blob','HEAD:'+prefix+name)).hexdigest()==digest; checks.append(name)
old=git('cat-file','blob',fixed+':'+collect); new=git('cat-file','blob','HEAD:'+collect)
assert old[old.index(b'function parseData('):]==new[new.index(b'function parseData('):]
assert hashlib.sha256(new).hexdigest()=='d549f6fd4f60979bc3049d261539066a8db7fc84ae2449504de5ea7e2dbb561f'
print(json.dumps(dict(head=git('rev-parse','HEAD').decode().strip(),oldEntries=len(before),unchangedOldBlobAndMode=len(before)-1,
    changedFiles=changed,changedFileModePreserved=True,addedFiles=len(added),newManifestEntries=len(checks),allNewHashesMatchGitBlobs=True,parserAndCliBytesUnchanged=True)))
