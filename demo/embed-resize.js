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
    const body=document.body;
    if(!body)return;
    const height=Math.ceil(Math.max(
      body.getBoundingClientRect().height,
      body.scrollHeight,
      document.documentElement.scrollHeight
    ));
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
