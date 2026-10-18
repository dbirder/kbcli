import {createController} from './controller.mjs';
import {ApiError,errorValue} from './api.mjs';
let accessError = false;
const accessReady = (async () => { try { await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}); } catch { accessError = true; } })();
const handle = createController({storage: chrome.storage.local, permissions: chrome.permissions});
// Register synchronously so Chrome can deliver events after worker restart.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url?.split(/[?#]/,1)[0] !== chrome.runtime.getURL('newtab.html')) return false;
  void (async () => {
    let response;
    try { await accessReady; if (accessError) throw new ApiError('STORAGE_UNAVAILABLE','无法初始化插件存储，请重新加载扩展'); response = {ok:true,data:await handle(message)}; }
    catch (error) { response = {ok:false,error:errorValue(error)}; }
    try { respond(response); } catch { /* The requesting tab may have closed. Never replay its write. */ }
  })();
  return true;
});
chrome.action.onClicked.addListener(async () => { try { await chrome.tabs.create({url:chrome.runtime.getURL('newtab.html')}); } catch { console.warn('无法打开 KB 工作台，请手动新建标签页'); } });
