"use strict";

const SPRITE_COLUMNS = 10;
const SPRITE_ROWS = 7;

const packs = [
  ["S","소드","s1W",0],["S","실드","s1H",0],["S","VMAX라이징","s1a",0],["S","반역크래시","s2",0],["S","폭염워커","s2a",0],["S","무한존","s3",0],["S","전설의 고동","s3a",0],["S","앙천의 볼트태클","s4",0],["S","샤이니스타V","s4a",0],["S","일격마스터","s5I",0],["S","연격마스터","s5R",0],["S","쌍벽의 파이터","s5a",0],["S","백은의 랜스","s6H",0],["S","칠흑의 가이스트","s6K",0],["S","이브이 히어로즈","s6a",0],["S","마천퍼펙트","s7D",0],["S","창공스트림","s7R",0],["S","퓨전아츠","s8",0],["S","25th","s8a",0],["S","VMAX 클라이맥스","s8b",0],["S","스타버스","s9",0],["S","배틀리전","s9a",0],["S","스페이스저글러","s10P",0],["S","타임게이저","s10D",0],["S","다크판타스마","s10a",0],["S","Pokémon GO","s10b",0],["S","로스트어비스","s11",0],["S","백열의 아르카나","s11a",0],["S","패러다임트리거","s12",0],["S","VSTAR유니버스","s12a",0],
  ["SV","스칼렛ex","sv1S",1],["SV","바이올렛ex","sv1V",0],["SV","트리플렛비트","sv1a",1],["SV","클레이버스트","sv2D",0],["SV","스노해저드","sv2P",0],["SV","포켓몬카드 151","sv2a",0],["SV","흑염의 지배자","sv3",1],["SV","레이징서프","sv3a",1],["SV","고대의 포효","sv4K",0],["SV","미래의 일섬","sv4M",0],["SV","샤이니트레저ex","sv4a",0],["SV","와일드포스","sv5K",1],["SV","사이버저지","sv5M",0],["SV","크림슨헤이즈","sv5a",1],["SV","변환의 가면","sv6",0],["SV","나이트원더러","sv6a",1],["SV","스텔라미라클","sv7",0],["SV","낙원드래고나","sv7a",1],["SV","초전브레이커","sv8",1],["SV","테라스탈페스ex","sv8a",0],["SV","배틀파트너즈","sv9",1],["SV","열풍의 아레나","sv9a",0],["SV","로켓단의 영광","sv10",1],["SV","블랙볼트","sv11B",0],["SV","화이트플레어","sv11W",0],
  ["M","메가심포니아","m1S",0],["M","메가브레이브","m1L",0],["M","인페르노X","m2",1],["M","MEGA드림ex","m2a",0],["M","니힐제로","m3",0],["M","닌자스피너","m4",1],["M","어비스아이","m5",1]
].map(([era,name,code,owned],i)=>({era,name,code,owned:Boolean(owned),i}));

const palettes={S:["#3759b6","#8a5bd4"],SV:["#d94c60","#6366c7"],M:["#24314f","#19a690"]};
let era="all",status="all",query="";
const $=id=>document.getElementById(id);
const pct=(n,d)=>Math.round(n/d*1000)/10;

function drawSummary(){
  const owned=packs.filter(p=>p.owned).length,total=packs.length,rate=pct(owned,total);
  $("pack-owned").textContent=owned;$("pack-total").textContent=total;$("pack-missing").textContent=total-owned;$("pack-rate").textContent=`${rate}%`;
  $("stat-pack-owned").textContent=owned;$("stat-pack-missing").textContent=total-owned;$("stat-pack-rate").textContent=rate;
  $("pack-progress-ring").style.setProperty("--progress",rate);
}

function spritePosition(index){
  const col=index%SPRITE_COLUMNS,row=Math.floor(index/SPRITE_COLUMNS);
  return {
    x:SPRITE_COLUMNS===1?0:(col/(SPRITE_COLUMNS-1))*100,
    y:SPRITE_ROWS===1?0:(row/(SPRITE_ROWS-1))*100
  };
}

function createCard(p){
  const el=document.createElement("article");
  el.className=`pack-card${p.owned?"":" is-missing"}`;
  el.style.setProperty("--pack-a",palettes[p.era][0]);
  el.style.setProperty("--pack-b",palettes[p.era][1]);

  const art=document.createElement("div");
  art.className="pack-art";
  const image=document.createElement("span");
  image.className="pack-image";
  image.setAttribute("role","img");
  image.setAttribute("aria-label",`${p.name} 팩 이미지`);
  const pos=spritePosition(p.i);
  image.style.setProperty("--sprite-x",`${pos.x}%`);
  image.style.setProperty("--sprite-y",`${pos.y}%`);
  art.append(image);

  const body=document.createElement("div");
  body.className="pack-card-body";
  const top=document.createElement("div");
  top.className="pack-card-top";
  const code=document.createElement("span");
  code.className="pack-code";code.textContent=p.code;
  const state=document.createElement("span");
  state.className="pack-status";state.textContent=p.owned?"수집완료":"미수집";
  top.append(code,state);
  const name=document.createElement("strong");
  name.className="pack-name";name.textContent=p.name;
  body.append(top,name);
  el.append(art,body);
  return el;
}

function render(){
  const q=query.trim().toLowerCase();
  const shown=packs.filter(p=>(era==="all"||p.era===era)&&(status==="all"||(status==="owned")===p.owned)&&(!q||`${p.name} ${p.code}`.toLowerCase().includes(q)));
  const host=$("pack-groups");host.replaceChildren();
  ["S","SV","M"].forEach(key=>{
    const items=shown.filter(p=>p.era===key);if(!items.length)return;
    const section=document.createElement("section");section.className="pack-series";
    const heading=document.createElement("div");heading.className="pack-series-heading";
    const title=document.createElement("h3");title.textContent=`${key} 시리즈`;
    const summary=document.createElement("p");summary.textContent=`${items.filter(p=>p.owned).length} / ${items.length}팩 수집완료`;
    heading.append(title,summary);
    const grid=document.createElement("div");grid.className="pack-grid";
    items.forEach(p=>grid.append(createCard(p)));
    section.append(heading,grid);host.append(section);
  });
  $("pack-result-count").textContent=shown.length;$("pack-empty").hidden=shown.length!==0;
}

function initFilters(){
  const host=$("era-filters");
  [["all","전체"],["S","S"],["SV","SV"],["M","M"]].forEach(([value,label])=>{
    const b=document.createElement("button");b.type="button";b.textContent=label;b.dataset.era=value;b.className=value==="all"?"is-active":"";
    b.addEventListener("click",()=>{era=value;host.querySelectorAll("button").forEach(x=>x.classList.toggle("is-active",x===b));render()});host.append(b);
  });
  $("pack-status-filters").addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;status=b.dataset.status;e.currentTarget.querySelectorAll("button").forEach(x=>x.classList.toggle("is-active",x===b));render()});
  $("pack-search").addEventListener("input",e=>{query=e.target.value;render()});
}

drawSummary();initFilters();render();