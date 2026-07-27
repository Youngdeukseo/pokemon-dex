"use strict";

const DATA_URL="./data/artists.json?v=20260725";
const $=id=>document.getElementById(id);

let dataset=null;
let selectedArtist=null;
let statusFilter="all";
let searchQuery="";
let sortMode="order";
let activeArtistCard=null;

const rate=(owned,total)=>total?Math.round(owned/total*1000)/10:0;

function setSummary(){
  const cards=dataset.artists.flatMap(artist=>artist.cards);
  const owned=cards.filter(card=>card.owned).length;
  const total=cards.length;
  const completion=rate(owned,total);

  $("artist-owned").textContent=owned;
  $("artist-total").textContent=total;
  $("artist-missing").textContent=total-owned;
  $("artist-rate").textContent=`${completion}%`;
  $("artist-progress-ring").style.setProperty("--progress",completion);
  $("stat-artist-count").textContent=dataset.artists.length;
  $("stat-artist-total").textContent=total;
  $("stat-artist-rate").textContent=completion;
}

function populateArtists(){
  const select=$("artist-select");
  dataset.artists.forEach(artist=>{
    const option=document.createElement("option");
    option.value=artist.name;
    option.textContent=`${artist.name} · ${artist.cards.length}장`;
    select.append(option);
  });
  selectedArtist=dataset.artists[0];
  select.value=selectedArtist.name;
  select.addEventListener("change",()=>{
    selectedArtist=dataset.artists.find(artist=>artist.name===select.value)??dataset.artists[0];
    render();
  });
}

function cardMatches(card){
  const statusOk=statusFilter==="all"||(statusFilter==="owned")===card.owned;
  const q=searchQuery.trim().toLowerCase();
  const haystack=`${card.name} ${card.set} ${card.rarity} ${card.cardNumber}`.toLowerCase();
  return statusOk&&(!q||haystack.includes(q));
}

function sortCards(cards){
  return [...cards].sort((a,b)=>{
    if(sortMode==="name")return a.name.localeCompare(b.name,"ko");
    if(sortMode==="set")return a.set.localeCompare(b.set,"en",{numeric:true})||a.order-b.order;
    return a.order-b.order;
  });
}

function makeStatusBadge(card){
  const badge=document.createElement("span");
  badge.className=`status-badge ${card.owned?"is-owned":"is-missing"}`;
  badge.textContent=card.owned?"보유":"미보유";
  return badge;
}

function updateDialog(card){
  const imageWrap=$("artist-dialog-image-wrap");
  const image=$("artist-dialog-image");
  image.src=card.image;
  image.alt=`${card.name} 포켓몬 카드`;
  imageWrap.classList.toggle("is-missing",!card.owned);

  $("artist-dialog-number").textContent=card.cardNumber||card.set;
  const badge=$("artist-dialog-status");
  badge.textContent=card.owned?"보유":"미보유";
  badge.className=`status-badge ${card.owned?"is-owned":"is-missing"}`;
  $("artist-dialog-name").textContent=card.name;
  $("artist-dialog-artist").textContent=selectedArtist.name.toUpperCase();
  $("artist-dialog-artist-detail").textContent=selectedArtist.name;
  $("artist-dialog-set").textContent=card.set||"—";
  $("artist-dialog-rarity").textContent=card.rarity||"—";
  $("artist-dialog-card-number").textContent=card.cardNumber||"—";
  $("artist-dialog-ownership").textContent=card.owned?"보유 중":"아직 미보유";
}

function openDialog(card){
  const dialog=$("artist-dialog");
  activeArtistCard=card;
  updateDialog(card);
  if(typeof dialog.showModal==="function")dialog.showModal();
  else dialog.setAttribute("open","");
}

function closeDialog(){
  const dialog=$("artist-dialog");
  if(typeof dialog.close==="function")dialog.close();
  else dialog.removeAttribute("open");
}

function updateCompletionButton(button,card){
  const owned=Boolean(card.owned);
  button.classList.toggle("is-complete",owned);
  button.classList.remove("is-saving");
  button.disabled=false;
  button.setAttribute("aria-pressed",String(owned));
  button.setAttribute("aria-label",owned?`${card.name} 수집완료 취소`:`${card.name} 수집완료로 표시`);
  button.title=owned?"다시 누르면 미보유로 변경됩니다.":"로그인한 내 도감에 수집완료로 저장합니다.";
  button.textContent=owned?"✓ 수집완료":"수집완료";
}

async function toggleCompletion(card,button){
  const account=window.PokemonDexPageAccount;
  if(!account?.canEdit?.()){
    alert("Google 로그인 후 내 수집 상태를 저장할 수 있습니다.");
    return;
  }

  button.disabled=true;
  button.classList.add("is-saving");
  button.textContent="저장 중…";

  try{
    const saved=await account.saveOwned(card.accountKey,!card.owned);
    card.owned=saved.owned;
    setSummary();
    if(activeArtistCard===card)updateDialog(card);
    render();
  }catch(error){
    console.error(error);
    alert(error.message||"수집 상태를 저장하지 못했습니다.");
    updateCompletionButton(button,card);
  }
}

function makeCompletionButton(card){
  const button=document.createElement("button");
  button.type="button";
  button.className="collection-complete-button";
  updateCompletionButton(button,card);
  button.addEventListener("click",event=>{
    event.preventDefault();
    event.stopPropagation();
    void toggleCompletion(card,button);
  });
  return button;
}

function createCard(card){
  const article=document.createElement("article");
  article.className=`pokemon-card artist-card has-completion-action${card.owned?"":" is-missing"}`;

  const button=document.createElement("button");
  button.className="pokemon-card-button artist-card-button";
  button.type="button";
  button.setAttribute("aria-label",`${card.name} 상세 보기`);

  const imageWrap=document.createElement("span");
  imageWrap.className="card-image-wrap";

  const image=document.createElement("img");
  image.className="card-image";
  image.src=card.image;
  image.alt=`${card.name} 포켓몬 카드`;
  image.loading="lazy";
  image.addEventListener("error",()=>article.classList.add("has-image-error"));

  const missing=document.createElement("span");
  missing.className="missing-overlay";
  missing.textContent="미보유";

  const fallback=document.createElement("span");
  fallback.className="image-fallback";
  fallback.setAttribute("aria-hidden","true");
  fallback.innerHTML='<span class="fallback-ball"><span></span></span>이미지를 불러오지 못했습니다';

  imageWrap.append(image,missing,fallback);

  const body=document.createElement("span");
  body.className="card-body";

  const top=document.createElement("span");
  top.className="card-topline";
  const number=document.createElement("span");
  number.className="number-badge";
  number.textContent=card.set||`#${card.order}`;
  top.append(number,makeStatusBadge(card));

  const name=document.createElement("strong");
  name.className="card-name-ko";
  name.textContent=card.name;

  const artist=document.createElement("span");
  artist.className="card-name-en";
  artist.textContent=selectedArtist.name;

  const meta=document.createElement("span");
  meta.className="card-meta";
  const set=document.createElement("span");
  set.className="card-set";
  set.textContent=[card.set,card.rarity].filter(Boolean).join(" · ");
  const cardNumber=document.createElement("span");
  cardNumber.className="card-number";
  cardNumber.textContent=card.cardNumber||"";
  meta.append(set,cardNumber);

  body.append(top,name,artist,meta);
  button.append(imageWrap,body);
  button.addEventListener("click",()=>openDialog(card));
  article.append(button,makeCompletionButton(card));
  return article;
}

function render(){
  const cards=selectedArtist.cards;
  const owned=cards.filter(card=>card.owned).length;
  const completion=rate(owned,cards.length);
  $("selected-artist-name").textContent=selectedArtist.name;
  $("selected-owned").textContent=owned;
  $("selected-total").textContent=cards.length;
  $("selected-rate").textContent=completion;

  const shown=sortCards(cards.filter(cardMatches));
  const grid=$("artist-card-grid");
  grid.replaceChildren(...shown.map(createCard));
  grid.setAttribute("aria-busy","false");
  $("artist-result-count").textContent=shown.length;
  $("artist-empty").hidden=shown.length!==0;
}

function initControls(){
  $("artist-search").addEventListener("input",event=>{
    searchQuery=event.target.value;
    render();
  });

  $("artist-status-filters").addEventListener("click",event=>{
    const button=event.target.closest("button");
    if(!button)return;
    statusFilter=button.dataset.status;
    event.currentTarget.querySelectorAll("button").forEach(item=>item.classList.toggle("is-active",item===button));
    render();
  });

  $("artist-sort").addEventListener("change",event=>{
    sortMode=event.target.value;
    render();
  });

  $("artist-dialog-close").addEventListener("click",closeDialog);
  $("artist-dialog").addEventListener("click",event=>{
    if(event.target===event.currentTarget)closeDialog();
  });
}

async function init(){
  try{
    const response=await fetch(DATA_URL,{cache:"no-store"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    dataset=await response.json();
    const account=window.PokemonDexPageAccount;
    if(account){
      await account.ready;
      account.applyGroups(dataset.artists);
    }
    setSummary();
    populateArtists();
    initControls();
    render();
  }catch(error){
    console.error(error);
    $("artist-card-grid").setAttribute("aria-busy","false");
    $("artist-error").hidden=false;
  }
}

init();
