"""Export only fixed offline sources/tests, using Git blob bytes (no checkout filters)."""
import pathlib,subprocess,json,hashlib,sys
OLD='5d16dd0cc4d18186ec59947c2073c409b2f8c34b'
NEW='e4a5d414689f23e1b33660bce3e006c46fb4e37f'
PREFIX='design/idb-incomplete-stop/'
repo=pathlib.Path(__file__).resolve().parents[4]
output=pathlib.Path(sys.argv[1]).resolve()
if output.exists():raise RuntimeError('refusing to overwrite an execution environment')
output.mkdir(parents=True)
def git(*args,data=None):
 p=subprocess.run(['git',*args],cwd=repo,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode:raise RuntimeError(p.stderr.decode('utf-8','replace'))
 return p.stdout
core={'judge.cjs','judge.test.cjs','conditions.test.cjs','merge-order.test.cjs','records/ir-fix/inputs/before-judge.cjs','records/ir-fix/inputs/merge-orders.json'}
collector={'collect.cjs','input.schema.json','result.schema.json','collect.test.cjs','verify.cjs'}
def needed(name):
 if name in core:return True
 if not name.startswith('collector/'):return False
 rel=name[len('collector/'):]
 if rel in collector or rel.startswith('fixtures/'):return True
 for section in ['independent/','diagnostic-fix/','diagnostic-fix/cli-error/']:
  if rel.startswith(section):
   leaf=rel[len(section):]
   if leaf.startswith('fixtures/') or ('/' not in leaf and leaf.endswith('.cjs')):return True
 return False
rows=[]
for label,ref in [('old',OLD),('new',NEW)]:
 selected=[]
 for entry in git('ls-tree','-rz',ref,PREFIX).split(b'\0'):
  if not entry:continue
  meta,path=entry.split(b'\t',1);mode,kind,blob=meta.decode().split();name=path.decode();rel=name[len(PREFIX):]
  choose=rel in {'judge.cjs','collector/collect.cjs','collector/input.schema.json','collector/result.schema.json'} if label=='old' else needed(rel)
  if choose:
   assert kind=='blob' and mode=='100644' and '..' not in pathlib.PurePosixPath(name).parts
   selected.append((name,blob,mode))
 raw=git('cat-file','--batch',data=''.join(blob+'\n' for name,blob,mode in selected).encode());offset=0
 for name,blob,mode in selected:
  end=raw.index(b'\n',offset);size=int(raw[offset:end].split()[-1]);data=raw[end+1:end+size+1];offset=end+size+2
  target=output/label/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
  rows.append(dict(root=label,ref=ref,path=name,blob=blob,mode=mode,sha256=hashlib.sha256(data).hexdigest()))
index=dict(old=OLD,new=NEW,base='a72e0657d07632926d2ace9bcd7836cfbc41ac13',files=rows)
(output/'prepared.json').write_bytes((json.dumps(index,indent=2)+'\n').encode())
print(json.dumps(dict(oldFiles=sum(x['root']=='old' for x in rows),newFiles=sum(x['root']=='new' for x in rows),output=str(output))))
