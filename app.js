'use strict';
const { $, $$, esc, ikona, obavijest, spremi, dropzona } = AB;
pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';

const dokumenti = new Map();   // id -> { ime, bajtovi, lib (PDFLib dokument, učitava se po potrebi) }
let stranice = [];             // { kljuc, dok, indeks, rot, odabrana, platno }
let brojac = 0;

async function ucitaj(datoteke) {
  const pdfovi = datoteke.filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!pdfovi.length) return obavijest('Odaberi PDF datoteke.');
  for (const f of pdfovi) {
    const bajtovi = new Uint8Array(await f.arrayBuffer());
    let pdf;
    try { pdf = await pdfjsLib.getDocument({ data: bajtovi.slice() }).promise; }
    catch (e) { obavijest(`„${f.name}” se ne može otvoriti${e.name === 'PasswordException' ? ' — zaštićen je lozinkom' : ''}.`); continue; }
    const id = 'd' + (++brojac);
    dokumenti.set(id, { ime: f.name, bajtovi, pdf });
    for (let i = 0; i < pdf.numPages; i++) stranice.push({ kljuc: id + '-' + i, dok: id, indeks: i, rot: 0, odabrana: false, platno: null });
  }
  if (stranice.length && $('#ime').value === 'spojeno.pdf' && dokumenti.size === 1) $('#ime').value = [...dokumenti.values()][0].ime.replace(/\.pdf$/i, '') + '-uređeno.pdf';
  nacrtaj();
  sliciceRedom();
}

// zarotirana sličica se smanji da stane u okvir
function rotirajSlicicu(s) {
  if (!s.platno) return;
  const w = s.platno.width, h = s.platno.height, okomito = s.rot % 180 !== 0;
  const k = okomito ? Math.min(w, h) / Math.max(w, h) : 1;
  s.platno.style.transform = `rotate(${s.rot}deg) scale(${k})`;
}

// sličice se crtaju jedna po jedna da stranica ostane brza i kod velikih PDF-ova
let crtanjeTece = false;
async function sliciceRedom() {
  if (crtanjeTece) return;
  crtanjeTece = true;
  for (const s of stranice) {
    if (s.platno) continue;
    const d = dokumenti.get(s.dok);
    if (!d) continue;
    try {
      const str = await d.pdf.getPage(s.indeks + 1);
      const vp0 = str.getViewport({ scale: 1 });
      const vp = str.getViewport({ scale: 220 / Math.max(vp0.width, vp0.height) });
      const c = document.createElement('canvas');
      c.width = vp.width; c.height = vp.height;
      await str.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      s.platno = c;
      const mjesto = $(`[data-k="${s.kljuc}"] .slicica`);
      if (mjesto) { mjesto.innerHTML = ''; mjesto.appendChild(c); rotirajSlicicu(s); }
    } catch { /* oštećena stranica — ostaje prazna sličica */ }
  }
  crtanjeTece = false;
}

function nacrtaj() {
  $('#radno').hidden = !stranice.length;
  $('#drop').hidden = !!stranice.length;
  const odabrane = stranice.filter(s => s.odabrana).length;
  $('#info').textContent = `${stranice.length} ${AB.mn(stranice.length, 'stranica', 'stranice', 'stranica')} iz ${dokumenti.size} ${AB.mn(dokumenti.size, 'datoteke', 'datoteke', 'datoteka')}` + (odabrane ? ` · odabrano ${odabrane}` : '');
  $('#izdvoji').disabled = !odabrane;
  $('#obrisiOdabrane').hidden = !odabrane;
  $('#odaberiSve').textContent = odabrane === stranice.length && odabrane ? 'Poništi odabir' : 'Odaberi sve';
  const kutija = $('#stranice');
  kutija.innerHTML = stranice.map((s, i) => `
    <div class="str${s.odabrana ? ' odabrana' : ''}" draggable="true" data-k="${s.kljuc}" data-i="${i}" title="Klikni za odabir, povuci za premještanje">
      <div class="slicica"></div>
      <div class="opis"><b>${i + 1}</b><span class="izvor" title="${esc(dokumenti.get(s.dok).ime)}">${esc(dokumenti.get(s.dok).ime)} · str. ${s.indeks + 1}</span></div>
      <div class="alatke">
        <button type="button" data-r="lijevo" title="Pomakni ulijevo" aria-label="Pomakni ulijevo">‹</button>
        <button type="button" data-r="rotL" title="Rotiraj ulijevo" aria-label="Rotiraj ulijevo">${ikona('rotiraj', 'zrcalo')}</button>
        <button type="button" data-r="rotD" title="Rotiraj udesno" aria-label="Rotiraj udesno">${ikona('rotiraj')}</button>
        <button type="button" data-r="brisi" class="brisi" title="Obriši stranicu" aria-label="Obriši stranicu">${ikona('smece')}</button>
        <button type="button" data-r="desno" title="Pomakni udesno" aria-label="Pomakni udesno">›</button>
      </div>
    </div>`).join('');
  for (const s of stranice) if (s.platno) {
    const m = $(`[data-k="${s.kljuc}"] .slicica`);
    m.appendChild(s.platno);
    rotirajSlicicu(s);
  }
}

// ---------- klikovi na stranicama ----------
$('#stranice').addEventListener('click', e => {
  const kartica = e.target.closest('.str');
  if (!kartica) return;
  const i = +kartica.dataset.i, s = stranice[i];
  const r = e.target.closest('[data-r]')?.dataset.r;
  if (!r) { s.odabrana = !s.odabrana; return nacrtaj(); }
  if (r === 'rotL' || r === 'rotD') {
    s.rot = (s.rot + (r === 'rotD' ? 90 : 270)) % 360;
    rotirajSlicicu(s);
    return;
  }
  if (r === 'brisi') stranice.splice(i, 1);
  if (r === 'lijevo' && i > 0) [stranice[i - 1], stranice[i]] = [stranice[i], stranice[i - 1]];
  if (r === 'desno' && i < stranice.length - 1) [stranice[i + 1], stranice[i]] = [stranice[i], stranice[i + 1]];
  pocistiDokumente();
  nacrtaj();
});

// ---------- povuci i ispusti ----------
let vuceSe = null;
$('#stranice').addEventListener('dragstart', e => {
  const k = e.target.closest('.str'); if (!k) return;
  vuceSe = +k.dataset.i; k.classList.add('vuce');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(vuceSe));
});
$('#stranice').addEventListener('dragover', e => {
  if (vuceSe === null) return;
  e.preventDefault();
  $$('.str.cilj').forEach(x => x.classList.remove('cilj'));
  e.target.closest('.str')?.classList.add('cilj');
});
$('#stranice').addEventListener('drop', e => {
  e.preventDefault();
  const k = e.target.closest('.str');
  if (k && vuceSe !== null) {
    const na = +k.dataset.i;
    const [s] = stranice.splice(vuceSe, 1);
    stranice.splice(na, 0, s);
  }
  vuceSe = null; nacrtaj();
});
$('#stranice').addEventListener('dragend', () => { vuceSe = null; $$('.str').forEach(x => x.classList.remove('vuce', 'cilj')); });

function pocistiDokumente() {
  const koriste = new Set(stranice.map(s => s.dok));
  for (const id of dokumenti.keys()) if (!koriste.has(id)) dokumenti.delete(id);
}

// ---------- izrada PDF-a ----------
async function libDok(id) {
  const d = dokumenti.get(id);
  if (!d.lib) d.lib = await PDFLib.PDFDocument.load(d.bajtovi, { ignoreEncryption: true });
  return d.lib;
}
async function napraviPdf(popis) {
  const van = await PDFLib.PDFDocument.create();
  for (const s of popis) {
    const [str] = await van.copyPages(await libDok(s.dok), [s.indeks]);
    str.setRotation(PDFLib.degrees((str.getRotation().angle + s.rot) % 360));
    van.addPage(str);
  }
  van.setProducer('app-bonic PDF alati');
  return van.save();
}
async function radnja(gumb, posao) {
  const tekst = gumb.innerHTML;
  gumb.disabled = true; gumb.textContent = 'Radim…';
  try { await posao(); }
  catch (e) { console.error(e); obavijest('Nije uspjelo: ' + e.message); }
  finally { gumb.disabled = false; gumb.innerHTML = tekst; nacrtaj(); }
}
const imeDat = s => (s.trim() || 'dokument.pdf').replace(/[\\/:*?"<>|]/g, '-').replace(/(\.pdf)?$/i, '.pdf');
const osnova = () => imeDat($('#ime').value).replace(/\.pdf$/i, '');

$('#spoji').onclick = e => radnja(e.currentTarget, async () => {
  spremi(new Blob([await napraviPdf(stranice)], { type: 'application/pdf' }), imeDat($('#ime').value));
  obavijest('PDF je spreman.');
});
$('#izdvoji').onclick = e => radnja(e.currentTarget, async () => {
  const odabrane = stranice.filter(s => s.odabrana);
  spremi(new Blob([await napraviPdf(odabrane)], { type: 'application/pdf' }), osnova() + '-odabrano.pdf');
});

function dijelovi() {
  const nacin = $('input[name="dijeli"]:checked').value, n = stranice.length;
  if (nacin === 'svaka') return stranice.map((s, i) => ({ ime: `str-${String(i + 1).padStart(3, '0')}`, popis: [s] }));
  if (nacin === 'n') {
    const k = Math.max(1, +$('#n').value || 1), van = [];
    for (let i = 0; i < n; i += k) van.push({ ime: `str-${i + 1}-${Math.min(i + k, n)}`, popis: stranice.slice(i, i + k) });
    return van;
  }
  const van = [];
  for (const dio of $('#rasponi').value.split(/[,;]/).map(x => x.trim()).filter(Boolean)) {
    const m = dio.match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!m) throw new Error(`„${dio}” nije ispravan raspon (primjer: 1-3, 5).`);
    const od = +m[1], doo = m[2] ? +m[2] : od;
    if (od < 1 || doo > n || od > doo) throw new Error(`Raspon „${dio}” izlazi izvan 1–${n}.`);
    van.push({ ime: od === doo ? `str-${od}` : `str-${od}-${doo}`, popis: stranice.slice(od - 1, doo) });
  }
  if (!van.length) throw new Error('Upiši barem jedan raspon.');
  return van;
}
$('#razdvoji').onclick = e => radnja(e.currentTarget, async () => {
  const d = dijelovi(), zip = new JSZip();
  for (const x of d) zip.file(`${osnova()}-${x.ime}.pdf`, await napraviPdf(x.popis));
  spremi(await zip.generateAsync({ type: 'blob' }), osnova() + '-razdvojeno.zip');
  obavijest(`Napravljeno ${d.length} PDF-ova.`);
});

$$('input[name="dijeli"]').forEach(r => r.addEventListener('change', () => {
  $('#poljeN').hidden = r.value !== 'n' || !r.checked;
  $('#poljeRasponi').hidden = r.value !== 'rasponi' || !r.checked;
}));

// ---------- ostali gumbi ----------
dropzona($('#drop'), ucitaj, { accept: 'application/pdf,.pdf' });
const dodatni = document.createElement('input');
dodatni.type = 'file'; dodatni.accept = 'application/pdf,.pdf'; dodatni.multiple = true;
dodatni.onchange = () => { ucitaj([...dodatni.files]); dodatni.value = ''; };
$('#dodaj').onclick = () => dodatni.click();
const rotirajSve = kut => { stranice.forEach(s => { s.rot = (s.rot + kut) % 360; }); nacrtaj(); };
$('#rotLijevo').onclick = () => rotirajSve(270);
$('#rotDesno').onclick = () => rotirajSve(90);
$('#odaberiSve').onclick = () => { const sve = stranice.every(s => s.odabrana); stranice.forEach(s => { s.odabrana = !sve; }); nacrtaj(); };
$('#obrisiOdabrane').onclick = () => { stranice = stranice.filter(s => !s.odabrana); pocistiDokumente(); nacrtaj(); };
$('#ocisti').onclick = () => { stranice = []; dokumenti.clear(); $('#ime').value = 'spojeno.pdf'; nacrtaj(); };
// ispuštanje PDF-a bilo gdje na stranicu dodaje ga na kraj
document.addEventListener('dragover', e => { if (vuceSe === null && e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
document.addEventListener('drop', e => { if (vuceSe === null && e.dataTransfer?.files?.length && !e.target.closest('#drop')) { e.preventDefault(); ucitaj([...e.dataTransfer.files]); } });
