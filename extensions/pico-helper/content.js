// SPDX-License-Identifier: MIT
(() => {
  if (window !== window.top || location.origin !== 'https://axel-nl94.github.io' || !location.pathname.startsWith('/retro-room/') || window.__retroRoomPicoHelper) return;
  window.__retroRoomPicoHelper = true;
  const channel = 'retroroom-pico-helper-1'; let active = null;
  window.addEventListener('message',async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== channel ||
        !['ping','get','cancel'].includes(message.type) || typeof message.request !== 'string' || !/^[a-f0-9-]{36}$/.test(message.request)) return;
    if (message.type === 'get' && (typeof message.id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(message.id))) return;
    if (message.type === 'get' && active) return;
    if (message.type === 'cancel' && active !== message.request) return;
    if (message.type === 'get') active = message.request;
    const reply = result => window.postMessage({channel,type:'reply',request:message.request,result},location.origin);
    try {
      const result = await chrome.runtime.sendMessage({type:message.type,request:message.request,...(message.type === 'get' ? {id:message.id} : {})});
      if (message.type !== 'cancel') reply(result || {ok:false,error:'unavailable'});
    } catch { if (message.type !== 'cancel') reply({ok:false,error:'unavailable'}); }
    finally { if (message.type === 'get' && active === message.request) active = null; }
  });
})();
