import {ApiError} from './api.mjs';
export const MAX_WALLPAPER_BYTES = 2 * 1024 * 1024;
export const DEFAULT_APPEARANCE = Object.freeze({version:1,revision:'initial',theme:'mist',dim:24,blur:0,position:'center',showClock:true,engine:'bing',wallpaper:null});
export const ENGINES = Object.freeze({bing:{name:'必应',url:'https://www.bing.com/search?q='},google:{name:'Google',url:'https://www.google.com/search?q='},baidu:{name:'百度',url:'https://www.baidu.com/s?wd='}});
const fail = message => { throw new ApiError('APPEARANCE_INVALID',message); };
export function validateAppearance(data) {
  if (!data || data.version !== 1 || typeof data.revision !== 'string' || !['mist','dusk','night'].includes(data.theme) || !Number.isInteger(data.dim) || data.dim < 0 || data.dim > 75 || !Number.isInteger(data.blur) || data.blur < 0 || data.blur > 16 || !['center','top','bottom'].includes(data.position) || typeof data.showClock !== 'boolean' || !Object.hasOwn(ENGINES,data.engine)) fail('外观设置无效，原设置已保留');
  if (data.wallpaper !== null) {
    const w = data.wallpaper;
    if (!w || typeof w.name !== 'string' || w.name.length > 160 || typeof w.dataURL !== 'string' || w.dataURL.length > MAX_WALLPAPER_BYTES || !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(w.dataURL)) fail('请选择处理后不超过 2 MiB 的 WebP 背景');
    let bytes; try { bytes = atob(w.dataURL.slice(23)); } catch { fail('背景图片无法读取'); }
    if (bytes.slice(0,4) !== 'RIFF' || bytes.slice(8,12) !== 'WEBP') fail('背景图片格式不正确');
  }
  return data;
}
export function createAppearanceStore({storage,revision=()=>crypto.randomUUID()}) {
  return async message => {
    const saved = (await storage.get('appearance')).appearance;
    const data = saved == null ? {...DEFAULT_APPEARANCE} : validateAppearance(structuredClone(saved));
    if (message.type === 'appearance.get') return data;
    if (message.type !== 'appearance.update') fail('不支持的外观操作');
    if (message.revision !== data.revision) throw new ApiError('APPEARANCE_CHANGED','外观已在其他标签页更新，请核对后再次操作');
    if (!message.changes || !Object.keys(message.changes).length || Object.keys(message.changes).some(k=>!['theme','dim','blur','position','showClock','engine','wallpaper'].includes(k))) fail('外观设置无效');
    Object.assign(data,message.changes,{revision:revision()}); validateAppearance(data);
    try { await storage.set({appearance:data}); }
    catch { throw new ApiError('STORAGE_FULL','背景未保存，浏览器存储空间不足。请换一张较小的图片；原背景和收藏已保留'); }
    return data;
  };
}
