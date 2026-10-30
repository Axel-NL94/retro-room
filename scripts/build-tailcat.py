#!/usr/bin/env python3
"""Build the pinned, unmodified Tailcat browser package and an offline source kit."""
import argparse, gzip, hashlib, io, json, os, re, shutil, subprocess, tarfile, tempfile
from pathlib import Path
PIN='52fbad323e9d352f1febb623e0975368e9a8cbdd'
ROOT=Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser();a.add_argument('--source',type=Path,required=True);a.add_argument('--go',type=Path,required=True);args=a.parse_args()
src=args.source.resolve();go=str(args.go.resolve());env=dict(os.environ,PATH=str(Path(go).parent)+':'+os.environ.get('PATH',''))
def run(*cmd,**opts):return subprocess.check_output(cmd,cwd=src,env=env,**opts)
assert run('git','rev-parse','HEAD',text=True).strip()==PIN,'Use the pinned Tailcat revision'
assert run(go,'version',text=True).split()[2]=='go1.27.3','Use Go 1.27.3'
# Use upstream's own Wasm feature-tag calculation. Temporary helper is never shipped.
helper=Path(tempfile.mkdtemp(prefix='rr-build-',dir=src/'cmd'))
try:
 (helper/'main.go').write_text('package main\nimport("fmt";"github.com/tailscale/tailcat/internal/buildtags")\nfunc main(){fmt.Print(buildtags.WasmTags())}\n')
 tags=run(go,'run','./cmd/'+helper.name,text=True).strip()
finally:shutil.rmtree(helper)
env.update(GOOS='js',GOARCH='wasm',CGO_ENABLED='0')
flags=['-tags',tags,'-trimpath','-buildvcs=false','-ldflags=-s -w']
assets=ROOT/'web/assets';assets.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as temp:
 wasm=Path(temp)/'tailcat.wasm';run(go,'build',*flags,'-o',str(wasm),'./web')
 data=wasm.read_bytes();(assets/'tailcat.wasm.gz').write_bytes(gzip.compress(data,compresslevel=9,mtime=0))
 goroot=Path(run(go,'env','GOROOT',text=True).strip())
 vendor=ROOT/'web/vendor/tailcat';vendor.mkdir(parents=True,exist_ok=True)
 shutil.copyfile(goroot/'lib/wasm/wasm_exec.js',vendor/'wasm_exec.js')
 raw=run(go,'list','-deps','-json','-tags',tags,'./web',text=True)
 dec=json.JSONDecoder();packages=[]
 while raw.strip():
  item,end=dec.raw_decode(raw.lstrip());raw=raw.lstrip()[end:];packages.append(item)
 modules={p['Module']['Path']:p['Module'] for p in packages if 'Module' in p}
 entries={};notices={}
 def add(name,p):entries[name]=p.read_bytes()
 # Preserve complete upstream sources, including its original license and build helper.
 for name in run('git','ls-files',text=True).splitlines():
  p=src/name
  if p.is_file():add('tailcat/'+name,p)
 # Exact sources/embedded assets for all packages linked into this js/wasm binary.
 for p in packages:
  m=p.get('Module')
  if not m or m['Path']=='github.com/tailscale/tailcat':continue
  for key in ['GoFiles','CgoFiles','SFiles','HFiles','CFiles','EmbedFiles','SysoFiles']:
   for name in p.get(key,[]):
    file=Path(p['Dir'])/name;rel=file.relative_to(m['Dir'])
    add('tailcat/vendor/'+m['Path']+'/'+str(rel),file)
 for path,m in modules.items():
  directory=Path(m['Dir'])
  for file in directory.rglob('*'):
   if not file.is_file() or '.git' in file.parts:continue
   if re.match(r'^(?:LICENSE|COPYING|NOTICE|PATENTS|AUTHORS|CONTRIBUTORS)(?:[._-].*)?$',file.name,re.I):
    relative=file.relative_to(directory)
    text=file.read_bytes().decode('utf-8',errors='replace')
    notices[path+' / '+str(relative)]=text
    if path!='github.com/tailscale/tailcat':add('tailcat/vendor/'+path+'/'+str(relative),file)
  if (directory/'go.mod').exists():add('dependency-manifests/'+path+'/go.mod',directory/'go.mod')
 for name in ['LICENSE','PATENTS','CONTRIBUTORS','AUTHORS']:
  if (goroot/name).is_file():
   notices['Go 1.27.3 / '+name]=(goroot/name).read_text();add('go-toolchain-notices/'+name,goroot/name)
 mod=json.loads(run(go,'mod','edit','-json',text=True));lines=[]
 for m in mod['Require']:
  path=m['Path'];lines.extend(['# '+path+' '+m['Version'],'## explicit'+('; go '+modules[path]['GoVersion'] if path in modules and modules[path].get('GoVersion') else '')])
  lines.extend(sorted(p['ImportPath'] for p in packages if p.get('Module',{}).get('Path')==path))
 entries['tailcat/vendor/modules.txt']=('\n'.join(lines)+'\n').encode()
 entries['tailcat/BUILD-TAGS.txt']=(tags+'\n').encode()
 entries['BUILD-SOURCE.txt']=b'Tailcat browser source kit. Go 1.27.3. Complete upstream plus the exact selected js/wasm dependency sources, embedded assets, and notices. From tailcat/: GOOS=js GOARCH=wasm CGO_ENABLED=0 go build -mod=vendor -tags "$(cat BUILD-TAGS.txt)" -trimpath -buildvcs=false -ldflags="-s -w" -o tailcat.wasm ./web\nNo network dependency downloads are required for this browser build. Other targets may require other upstream files. The Go toolchain is separately available at https://go.dev/dl/.\n'
 entries['retro-room/scripts/build-tailcat.py']=Path(__file__).read_bytes()
 # Prove that the archived source kit rebuilds the same binary offline.
 kit=Path(temp)/'kit'
 for name,content in entries.items():
  file=kit/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(content)
 env['GOPROXY']='off'
 rebuilt=Path(temp)/'rebuilt.wasm'
 subprocess.check_call([go,'build','-mod=vendor',*flags,'-o',str(rebuilt),'./web'],cwd=kit/'tailcat',env=env)
 data=rebuilt.read_bytes()
 (assets/'tailcat.wasm.gz').write_bytes(gzip.compress(data,compresslevel=9,mtime=0))
 # The canonical distributable is built with -mod=vendor, exactly like the kit.
 other=Path(temp)/'second-kit';shutil.copytree(kit,other)
 check=Path(temp)/'second.wasm'
 subprocess.check_call([go,'build','-mod=vendor',*flags,'-o',str(check),'./web'],cwd=other/'tailcat',env=env)
 assert check.read_bytes()==data,'Offline source kit must reproduce the exact Wasm binary'
 buf=io.BytesIO()
 with tarfile.open(fileobj=buf,mode='w',format=tarfile.PAX_FORMAT) as tar:
  for name,content in sorted(entries.items()):
   info=tarfile.TarInfo(name);info.size=len(content);info.mode=0o644;info.mtime=0;tar.addfile(info,io.BytesIO(content))
 archive=gzip.compress(buf.getvalue(),compresslevel=9,mtime=0);(assets/'tailcat-source.tar.gz').write_bytes(archive)
 notice='Tailcat browser distribution — pinned '+PIN+'\n\nAll upstream copyright and license comments are retained in the source kit.\nThe following complete license/notice files accompany the linked Go packages and runtime.\n\n'+'\n\n'.join('='*76+'\n'+name+'\n'+'='*76+'\n\n'+body for name,body in sorted(notices.items()))
 (ROOT/'web/TAILCAT-NOTICES.txt').write_text(notice)
 h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 meta={'project':'Tailcat','revision':PIN,'upstream':'https://github.com/tailscale/tailcat','go':'1.27.3','tags':tags,'wasmSha256':hashlib.sha256(data).hexdigest(),'wasmGzipSha256':h(assets/'tailcat.wasm.gz'),'runtimeSha256':h(vendor/'wasm_exec.js'),'sourceArchive':'tailcat-source.tar.gz','sourceSha256':h(assets/'tailcat-source.tar.gz'),'noticesSha256':h(ROOT/'web/TAILCAT-NOTICES.txt'),'modules':[{ 'path':m['Path'],'version':m.get('Version',PIN)} for m in modules.values()],'offlineRebuildVerified':True}
 (assets/'tailcat-build.json').write_text(json.dumps(meta,indent=2)+'\n')
 print('Tailcat Wasm:',len(data),'gzip:',(assets/'tailcat.wasm.gz').stat().st_size,'source kit:',len(archive),'notices:',len(notices),'Exact offline rebuild verified')
