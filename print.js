"use strict";

(function(){
  const button=document.querySelector("[data-print-page]");
  if(!button)return;

  let originalTitle=document.title;

  function setPrintTitle(){
    const pageTitle=document.querySelector("#page-title")?.textContent?.trim()||"포켓몬 도감";
    const artistName=document.querySelector("#selected-artist-name")?.textContent?.trim();
    document.title=artistName&&artistName!=="—"?`${pageTitle}_${artistName}`:pageTitle;
  }

  function revealAllNationalCards(){
    const loadMore=document.querySelector("#load-more");
    if(!loadMore)return;
    let guard=0;
    while(!loadMore.hidden&&guard<100){
      loadMore.click();
      guard+=1;
    }
  }

  async function waitForImages(){
    const images=[...document.querySelectorAll("#card-grid img,#artist-card-grid img")];
    images.forEach(image=>image.loading="eager");
    const tasks=images.map(image=>{
      if(image.complete)return Promise.resolve();
      return new Promise(resolve=>{
        image.addEventListener("load",resolve,{once:true});
        image.addEventListener("error",resolve,{once:true});
      });
    });
    await Promise.race([
      Promise.all(tasks),
      new Promise(resolve=>setTimeout(resolve,2500)),
    ]);
  }

  button.addEventListener("click",async()=>{
    button.disabled=true;
    const previousLabel=button.textContent;
    button.textContent="인쇄 준비 중…";
    originalTitle=document.title;
    setPrintTitle();
    revealAllNationalCards();
    await waitForImages();
    document.documentElement.classList.add("is-printing");
    button.textContent=previousLabel;
    button.disabled=false;
    window.print();
  });

  window.addEventListener("afterprint",()=>{
    document.documentElement.classList.remove("is-printing");
    document.title=originalTitle;
  });
})();
