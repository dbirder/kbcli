// Read-only production transport check; supply credentials through the container environment.
import assert from 'node:assert/strict';
import {createController} from '../../extensions/chrome-kb/controller.mjs';
const values={};
const storage={async get(key){return {[key]:values[key]};},async set(value){Object.assign(values,value);},async remove(keys){for(const key of [keys].flat())delete values[key];}};
const server=process.env.KBCLI_VERIFY_SERVER||'http://kbcli:8765';
assert.ok(process.env.KBCLI_USER_TOKEN,'Supply an owner token through env_file');
const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');
  const path=new URL(url);assert.equal(path.origin,new URL(server).origin);
  assert.ok(['/api/status','/api/tasks','/api/autosync'].includes(path.pathname));
  return fetch(url,options);
};
const controller=createController({storage,permissions:{async contains(){return true;}},fetcher});
await controller({type:'connect',server,token:process.env.KBCLI_USER_TOKEN});
const state=await controller({type:'snapshot'});
assert.equal(state.writable,true);assert.equal(state.resources.status.data.role,'human');
assert.equal(state.resources.status.data.schema.errors,0);
assert.ok(!JSON.stringify(state).includes(process.env.KBCLI_USER_TOKEN));
console.log(JSON.stringify({ok:true,version:state.resources.status.data.version,records:state.resources.status.data.content.records,tasks:state.resources.tasks.data.tasks.length,sync:state.resources.autosync.data.state,readonly:true}));
