// Determinism gate for DOS local-emulation netplay. Original fixtures only.
// Usage: node scripts/probe-dos-sync.js [report.json] [frames]
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {DosCore,DOS_BUILD} from '../web/src/dos.js';import {makeDosDemo} from './demo-dos.js';import {emptyDosInput} from '../web/src/dos-input.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytes=await readFile(new URL('../web/assets/dos-core.wasm',import.meta.url));
const a=await DosCore.create({wasmBinary:bytes}),b=await DosCore.create({wasmBinary:bytes});
function output(core){const m=core.module,w=m._rr_video_width(),h=m._rr_video_height(),n=m._rr_audio_count();return {video:hash(m.HEAPU8.slice(m._rr_video_ptr(),m._rr_video_ptr()+w*h*4)),audio:hash(m.HEAPU8.slice(m._rr_audio_ptr(),m._rr_audio_ptr()+n*2))};}
function sections(core){const m=core.module;return Array.from({length:m._rr_section_count()},(_,i)=>({name:m.UTF8ToString(m._rr_section_name(i)),start:m._rr_section_start(i),end:m._rr_section_end(i)}));}
function compare(left,right,parts){const differences=[];for(const part of parts){let count=0,samples=[];for(let i=part.start;i<part.end;i++)if(left[i]!==right[i]){count++;if(samples.length<8)samples.push({offset:i-part.start,left:left[i],right:right[i]});}if(count)differences.push({...part,differentBytes:count,samples});}return differences;}
const overclock=Number(process.argv[4])||100;
const frames=Math.max(120,Math.min(3600,Number(process.argv[3])||600)),checkpoints=[];
const inputs=frame=>[{...emptyDosInput(),keys:frame%120>=60&&frame%120<85?[275]:[]},{...emptyDosInput(),keys:frame%180>=90&&frame%180<115?[100]:[]}];
try{
 for(const c of [a,b])c.load(makeDosDemo(),'dos',{name:'demo.com',overclock});
 for(let frame=1;frame<=frames;frame++){
  a.run(0,0,true,inputs(frame));b.run(0,0,true,inputs(frame));
  if(frame===1||frame%60===0){const at=performance.now(),sa=a.save(),saveMs=performance.now()-at,sb=b.save(),parts=sections(a),oa=output(a),ob=output(b);
   const row={frame,bytes:sa.length,saveMs,identical:hash(sa)===hash(sb),videoIdentical:oa.video===ob.video,audioIdentical:oa.audio===ob.audio,differentSections:compare(sa,sb,parts)};checkpoints.push(row);console.log(JSON.stringify({frame,identical:row.identical,videoIdentical:row.videoIdentical,audioIdentical:row.audioIdentical,sections:row.differentSections.map(s=>[s.name,s.differentBytes])}));
  }
 }
 const state=a.save();for(let i=0;i<30;i++)a.run(0,0,true,inputs(i));const first=a.save(),firstOutput=output(a);a.restore(state);for(let i=0;i<30;i++)a.run(0,0,true,inputs(i));const second=a.save(),secondOutput=output(a);
 const replay={identical:hash(first)===hash(second),videoIdentical:firstOutput.video===secondOutput.video,audioIdentical:firstOutput.audio===secondOutput.audio,differentSections:compare(first,second,sections(a))};
 const report={build:DOS_BUILD,frames,overclock,fixture:'original DOS Duo',checkpoints,replay,lockstepGatePassed:checkpoints.every(c=>c.identical&&c.videoIdentical&&c.audioIdentical),rollbackGatePassed:replay.identical&&replay.videoIdentical&&replay.audioIdentical};
 if(process.argv[2])await writeFile(process.argv[2],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({lockstepGatePassed:report.lockstepGatePassed,rollbackGatePassed:report.rollbackGatePassed,replay}));
}finally{a.destroy();b.destroy();}
