import pathlib,json,struct,zlib,zipfile,subprocess,os,shutil
repo=pathlib.Path.cwd(); root=repo/'e2e-artifacts/track-a-validator-controls';root.mkdir(parents=True,exist_ok=True)
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
ids=['R01','R02','R03','R04','R05','R06','L01','L02','L03','L04','I01']
r={'sha':head,'engine':'webkit','platform':'linux','browser':'synthetic','cases':[{'id':i,'save':'PASS','preview':'PASS','errors':[],'import':'対象外：正式編集操作で直接検証' if i=='R01' else 'PASS'} for i in ids]}
p={**r,'cases':[{**c,'imageInspection':'PASS','imageRegionChecks':{'synthetic':True}} for c in r['cases']]}
def chunk(t,b):return struct.pack('>I',len(b))+t+b+struct.pack('>I',zlib.crc32(t+b)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\x00\x00\x00'))+chunk(b'IEND',b'')
base=root/'baseline';base.mkdir(exist_ok=True)
(base/'results.json').write_text(json.dumps(r));(base/'pdf-results.json').write_text(json.dumps(p))
for i in ids:
 for w in [1280,390]:(base/f'{i}-preview-{w}.png').write_bytes(png)
for i in range(21):
 with zipfile.ZipFile(base/f'context-{i}.zip','w') as z:z.writestr('trace.trace','{"type":"context-options"}\n{"type":"before"}\n')
results=[]
for name in ['baseline','wrong-head','import-fail','pdf-duplicate','invalid-png','empty-zip']:
 d=root/name
 if name!='baseline':shutil.copytree(base,d,dirs_exist_ok=True)
 if name in ['wrong-head','import-fail']:
  a=json.loads((d/'results.json').read_text())
  if name=='wrong-head':a['sha']='WRONG'
  else:a['cases'][1]['import']='FAIL'
  (d/'results.json').write_text(json.dumps(a))
 if name=='pdf-duplicate':
  a=json.loads((d/'pdf-results.json').read_text());a['cases'][1]['id']='R01';(d/'pdf-results.json').write_text(json.dumps(a))
 if name=='invalid-png':(d/'R01-preview-1280.png').write_text('not png')
 if name=='empty-zip':(d/'context-0.zip').write_bytes(b'')
 env={**os.environ,'REPORT_FIXED_OUT':str(d),'TRACK_A_TRACE':'on','NODE_PATH':str(repo/'node_modules')}
 run=subprocess.run(['node','scripts/fixed-report-evidence.cjs'],env=env,capture_output=True,text=True)
 (root/f'{name}.log').write_text(run.stdout+run.stderr)
 results.append({'case':name,'exit_code':run.returncode,'expected_reject':name!='baseline'})
print(json.dumps(results,indent=2));(root/'outcomes.json').write_text(json.dumps(results,indent=2))
assert all((x['exit_code']!=0)==x['expected_reject'] for x in results)
