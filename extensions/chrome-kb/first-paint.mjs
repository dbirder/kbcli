const KEY='kb-first-paint-background';
// A tiny, local preview prevents a flat-color flash while the full wallpaper decodes.
// It is disposable presentation cache, never a replacement for chrome.storage.
export async function cacheFirstPaintBackground(image,data){
  try {
    const saved=JSON.parse(localStorage.getItem(KEY)||'null');
    if(saved?.revision===data.revision)return;
    const source=image.src;
    await image.decode();
    if(image.src!==source)return;
    const ratio=Math.min(1,160/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const context=canvas.getContext('2d');
    context.filter=getComputedStyle(image).filter.replace(/blur\([^)]*\)/g,`blur(${data.blur*ratio}px)`);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    context.filter='none';context.fillStyle=`rgba(3,14,23,${data.dim/100})`;context.fillRect(0,0,canvas.width,canvas.height);
    const preview=canvas.toDataURL('image/webp',.75);
    if(preview.length<32768)localStorage.setItem(KEY,JSON.stringify({revision:data.revision,image:preview,position:data.position}));
  }catch{/* Cache, decode and canvas failures must not affect saved appearance or startup. */}
}
