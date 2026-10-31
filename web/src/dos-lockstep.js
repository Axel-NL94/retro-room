// Experimental DOS netplay: fixed input delay and waiting, never speculative
// frames or rollback. Only validated per-frame input and state hashes travel.
import {emptyDosInput,validateDosInput} from './dos-input.js';
import {defaultDosPolicy,validateDosPolicy,DosPolicyFilter} from './dos-policy.js';
export class DosLockstepSession {
  constructor({core,player,send,delay=6,hashEvery=120,policy=defaultDosPolicy(),getPolicy=()=>policy,onPolicy=()=>{},hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)).subarray(0,4),b=>b.toString(16).padStart(2,'0')).join('')}) {
    Object.assign(this,{core,player,send,delay,hashEvery,hash,getPolicy,onPolicy});this.policies=new Map();this.policyFilter=new DosPolicyFilter(policy);this.frame=0;this.waiting=false;this.rollbacks=0;this.inputs=[new Map(),new Map()];this.hashes=new Map();this.lastCheckpoint=null;this.closed=false;
    for(const map of this.inputs)for(let i=0;i<delay;i++)map.set(i,emptyDosInput());
    for(let i=0;i<delay;i++)this.policies.set(i,validateDosPolicy(policy));
  }
  receive(frame,input,policy){
    if(this.closed)return;
    if(!Number.isSafeInteger(frame)||frame<0||frame>this.frame+180)throw new Error('DOS-invoer ligt te ver vooruit. Verbind opnieuw.');
    if(frame<this.frame)return;
    const value=validateDosInput(input),map=this.inputs[1-this.player];
    if(map.has(frame)&&JSON.stringify(map.get(frame))!==JSON.stringify(value))throw new Error('Tegenstrijdige DOS-invoer ontvangen.');
    if(this.player===1){const next=validateDosPolicy(policy);if(this.policies.has(frame)&&JSON.stringify(this.policies.get(frame))!==JSON.stringify(next))throw new Error('Tegenstrijdige DOS-toetsverdeling.');this.policies.set(frame,next);}
    else if(policy!==undefined)throw new Error('Alleen de host mag DOS-toetsen verdelen.');
    map.set(frame,value);
  }
  tick(source){
    if(this.closed)return false;
    if(this.hashError)throw this.hashError;
    const target=this.frame+this.delay,mine=this.inputs[this.player];
    if(!mine.has(target)){
      const input=validateDosInput(typeof source==='function'?source():source);
      mine.set(target,input);
      const policy=this.player===0?validateDosPolicy(this.getPolicy()):undefined;
      if(policy)this.policies.set(target,policy);
      this.send({type:'dos-input',frame:target,dos:input,...(policy?{policy}:{})});
    }
    const states=this.inputs.map(map=>map.get(this.frame));this.waiting=states.some(s=>!s);
    if(this.waiting)return false;
    const policy=this.policies.get(this.frame),changed=policy.revision!==this.policyFilter.policy.revision;
    this.core.run(0,0,false,this.policyFilter.apply(states,policy));
    if(changed)this.onPolicy(policy);this.policies.delete(this.frame);
    for(const map of this.inputs)map.delete(this.frame);this.frame++;
    if(this.frame%this.hashEvery===0&&!this.hashPending){
      const frame=this.frame,state=this.core.save();
      this.hashPending=Promise.resolve(this.hash(state)).then(hash=>{if(!this.closed){this.hashes.set(frame,hash);this.lastCheckpoint={frame,hash};for(const key of this.hashes.keys())if(key<frame-600)this.hashes.delete(key);}}).catch(error=>{this.hashError=error;}).finally(()=>{this.hashPending=null;});
    }
    return true;
  }
  hashAt(frame){return this.hashes.get(frame)??null;}
  confirmedState(){return this.lastCheckpoint;}
  close(){this.closed=true;this.inputs.forEach(map=>map.clear());this.hashes.clear();this.policies.clear();}
}
