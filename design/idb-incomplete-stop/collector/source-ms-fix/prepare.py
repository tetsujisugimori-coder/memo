"""Isolated exact-blob baseline; the candidate will replace only collect.cjs in a copy."""
import pathlib, subprocess, json, hashlib, sys
FIXED='8873b351b17e2a0e2a7a6367718ef37baadb8c99'
REPO=pathlib.Path(__file__).resolve().parents[4]
out=pathlib.Path(sys.argv[1]).resolve()
if out.exists(): raise RuntimeError('never overwrite an environment')
out.mkdir(parents=True)
def git(*args, data=None):
    return subprocess.run(['git',*args],cwd=REPO,input=data,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE).stdout
selected=[]
for row in git('ls-tree','-rz',FIXED,'design/idb-incomplete-stop/').split(b'\0'):
    if not row: continue
    meta, name=row.split(b'\t',1); mode, kind, blob=meta.decode().split(); name=name.decode()
    if '/records/' in name and not name.endswith(('records/ir-fix/inputs/before-judge.cjs','records/ir-fix/inputs/merge-orders.json')):continue
    if '/acceptance-cli-' in name: continue
    if kind=='blob' and (name.endswith(('.cjs','.json','.json.gz','.bin')) or '/fixtures/' in name):selected.append((name,blob,mode))
raw=git('cat-file','--batch',data=''.join(blob+'\n' for name,blob,mode in selected).encode()); offset=0; entries=[]
for name,blob,mode in selected:
    end=raw.index(b'\n',offset); size=int(raw[offset:end].split()[-1]); data=raw[end+1:end+size+1]; offset=end+size+2
    dest=out/'old'/name; dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(data)
    entries.append(dict(path=name,blob=blob,mode=mode,sha256=hashlib.sha256(data).hexdigest()))
(out/'fixed-source-index.json').write_bytes((json.dumps(dict(fixed=FIXED,files=entries),indent=2)+'\n').encode())
print(json.dumps(dict(output=str(out),files=len(entries),fixed=FIXED)))
