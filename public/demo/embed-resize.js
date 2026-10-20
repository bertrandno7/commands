/**
 * Auto-size a same-origin runnable demo when displayed inside Commands detail.
 * The parent drawer is the only scroll container. Full demos are unaffected.
 */
(function(){
  if(!document.documentElement.classList.contains("embedded-demo"))return;
  let lastHeight=0;
  let pending=false;
  function sendHeight(){
    pending=false;
    // Measure intrinsic content, not documentElement.scrollHeight.
    // The latter can equal the frame's current viewport height and cause
    // an endless iframe grows -> resize -> grows feedback loop.
    const page=document.querySelector(".page");
    if(!page)return;
    const height=Math.ceil(page.getBoundingClientRect().height);
    if(!Number.isFinite(height)||height<100)return;
    if(Math.abs(height-lastHeight)<=3)return;
    lastHeight=height;
    if(window.parent!==window){
      window.parent.postMessage({
        type:"commands:embed-height",
        height,
        path:location.pathname
      },location.origin);
    }
  }
  function schedule(){
    if(pending)return;
    pending=true;
    window.requestAnimationFrame(sendHeight);
  }
  document.addEventListener("DOMContentLoaded",()=>{
    schedule();
    if(typeof ResizeObserver!=="undefined"){
      const ro=new ResizeObserver(schedule);
      ro.observe(document.body);
      const content=document.querySelector(".page");
      if(content)ro.observe(content);
    }
  });
  window.addEventListener("load",schedule);
  window.addEventListener("resize",schedule);
})();
