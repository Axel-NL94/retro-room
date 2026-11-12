// SPDX-License-Identifier: MIT
import {allowedPage,cartridgeId,downloadCartridge,toBase64} from './download.js';
const active = new Map(), recent = new Map();
const errors = new Set(['invalid-id','not-found','download-failed','too-large','invalid-cartridge']);
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !allowedPage(sender.url)) return;
  if (message?.type === 'ping') { respond({ok:true,protocol:1,version:'0.1.0'}); return; }
  if (typeof message?.request !== 'string' || !/^[a-f0-9-]{36}$/.test(message.request)) return;
  const tab = sender.tab.id;
  if (message.type === 'cancel') { if (active.get(tab)?.request === message.request) active.get(tab).controller.abort(); respond({ok:true}); return; }
  if (message.type !== 'get') return;
  let id; try { id = cartridgeId(message.id); } catch { respond({ok:false,error:'invalid-id'}); return; }
  if (active.has(tab) || active.size >= 2) { respond({ok:false,error:'busy'}); return; }
  const now = Date.now(), times = (recent.get(tab) || []).filter(time => now-time < 60000);
  if (times.length >= 12) { respond({ok:false,error:'rate-limit'}); return; }
  if (recent.size >= 128) recent.delete(recent.keys().next().value);
  times.push(now); recent.set(tab,times);
  const controller = new AbortController(), entry = {request:message.request,controller}; active.set(tab,entry);
  const timeout = setTimeout(() => controller.abort(),25000);
  downloadCartridge(id,{signal:controller.signal}).then(result => respond({ok:true,id:result.id,base64:toBase64(result.bytes)}))
    .catch(error => respond({ok:false,error:controller.signal.aborted ? 'cancelled' : errors.has(error.message) ? error.message : 'download-failed'}))
    .finally(() => { clearTimeout(timeout); if (active.get(tab) === entry) active.delete(tab); });
  return true;
});
chrome.tabs.onRemoved.addListener(tab => { active.get(tab)?.controller.abort(); recent.delete(tab); });
// Activate on an already-open game after installation, without reloading its VM.
chrome.action.onClicked.addListener(async tab => {
  if (!Number.isInteger(tab.id) || !allowedPage(tab.url)) return;
  try { await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}); } catch { /* Browser restricted the active tab. */ }
});
