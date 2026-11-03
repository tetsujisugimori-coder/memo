import pathlib,json,importlib.util
p=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('capture',p.parent/'idb-evidence-u1-audit/capture.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
before=m.snapshot();(p/'before.json').write_bytes((json.dumps(before,ensure_ascii=False,indent=2)+'\n').encode())
for name,url in {'pr405':'pulls/405','reviews':'pulls/405/reviews?per_page=100','review5750954418':'pulls/405/reviews/5750954418','issue404':'issues/404','issue404-comments':'issues/404/comments?per_page=100','main':'branches/main','base':'branches/investigate/idb-time-delay-only'}.items():
 (p/(name+'.json')).write_bytes(m.run(['gh','api','--paginate','repos/tetsujisugimori-coder/memo/'+url]))
print('before snapshot:',len(before['worktrees']),'worktrees')
