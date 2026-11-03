import subprocess, json, hashlib, pathlib, datetime
root=pathlib.Path(__file__).resolve().parents[2]
out=pathlib.Path(__file__).resolve().parent
def run(args,cwd=root):
 if args[0]=='git': args=['git','-c','safe.directory='+str(cwd).replace('\\','/'),*args[1:]]
 p=subprocess.run(args,cwd=cwd,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 if p.returncode: raise RuntimeError(p.stderr.decode('utf-8','replace'))
 return p.stdout
def snapshot():
 rows=[]
 for block in run(['git','worktree','list','--porcelain','-z']).split(b'\0\0'):
  parts=block.split(b'\0'); w=next((p[9:].decode() for p in parts if p.startswith(b'worktree ')),None)
  if not w: continue
  status=run(['git','status','--porcelain=v1','-z','--untracked-files=all'],w)
  names=set(run(['git','ls-files','--modified','--others','--exclude-standard','-z'],w).split(b'\0'))-{b''}
  # Every tracked research/design/review file plus all existing changed/untracked files.
  if any(s in w for s in ['idb-','mcp-t7','mcp-worker','メモ帳']):
   names.update(n for n in run(['git','ls-files','-z'],w).split(b'\0') if n.startswith((b'experiments/',b'design/',b'reviews/')))
  files={}
  for n in sorted(names):
   path=pathlib.Path(w)/n.decode('utf-8'); files[n.decode('utf-8')]=hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
  rows.append(dict(path=w,head=run(['git','rev-parse','HEAD'],w).decode().strip(),statusHex=status.hex(),files=files))
 return dict(capturedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),worktrees=rows)
if __name__=='__main__':
 import sys
 if sys.argv[1]=='before':
  (out/'before.json').write_text(json.dumps(snapshot(),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  repo='repos/tetsujisugimori-coder/memo'
  endpoints={'main':f'{repo}/branches/main','branches':f'{repo}/branches?per_page=100','issue402':f'{repo}/issues/402','issue402-comments':f'{repo}/issues/402/comments?per_page=100'}
  for n in [399,401,403]:
   for suffix,endpoint in [('',f'pulls/{n}'),('-comments',f'issues/{n}/comments?per_page=100'),('-inline',f'pulls/{n}/comments?per_page=100'),('-reviews',f'pulls/{n}/reviews?per_page=100')]: endpoints[f'pr{n}{suffix}']=f'{repo}/{endpoint}'
  for name,endpoint in endpoints.items():
   data=run(['gh','api','--paginate',endpoint]); (out/(name+'.json')).write_bytes(data)
  print('captured',len(endpoints),'GitHub snapshots and',len(snapshot()['worktrees']),'worktrees')
 else:
  before=json.loads((out/'before.json').read_text(encoding='utf-8')); after=snapshot(); by={w['path']:w for w in after['worktrees']}; failures=[]; count=0
  for w in before['worktrees']:
   current=by[w['path']]
   for k in ['head','statusHex']:
    if w[k]!=current[k]: failures.append([w['path'],k])
   for name,h in w['files'].items():
    count+=1
    if current['files'].get(name)!=h: failures.append([w['path'],name])
  result=dict(filesChecked=count,originalWorktrees=len(before['worktrees']),failures=failures,after=after)
  (out/'after.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8'); print(json.dumps({k:v for k,v in result.items() if k!='after'})); assert not failures
