// Test server only. Never included in the Chrome extension package.
import {createController} from '/controller.mjs';
import {errorValue} from '/api.mjs';
const changes=[], grants=new Set();
const storage={
  async get(key){return {[key]:JSON.parse(localStorage.getItem('kb-test-'+key)||'null')};},
  async set(values){for(const [key,value]of Object.entries(values)){localStorage.setItem('kb-test-'+key,JSON.stringify(value));for(const callback of changes)callback({[key]:{newValue:value}},'local');}},
  async remove(keys){for(const key of [keys].flat()){localStorage.removeItem('kb-test-'+key);for(const callback of changes)callback({[key]:{}},'local');}}
};
window.addEventListener('storage',event=>{if(event.key?.startsWith('kb-test-'))for(const callback of changes)callback({[event.key.slice(8)]:{newValue:JSON.parse(event.newValue||'null')}},'local');});
const permissions={async request({origins}){origins.forEach(o=>grants.add(o));return true;},async contains({origins}){return origins.every(o=>grants.has(o));},async remove({origins}){origins.forEach(o=>grants.delete(o));}};
const saved=(await storage.get('connection')).connection;
if(saved)grants.add(new URL(saved.server).protocol+'//'+new URL(saved.server).hostname+'/*');
const handle=createController({storage,permissions});
globalThis.chrome={runtime:{async sendMessage(message){try{return {ok:true,data:await handle(message)};}catch(error){return {ok:false,error:errorValue(error)};}}},permissions,storage:{onChanged:{addListener(callback){changes.push(callback);}}}};
await import('/app.mjs');
