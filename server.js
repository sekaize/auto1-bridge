/**
 * Auto1 — Pont dépôt photos marchand (hébergement gratuit)
 * Parcours guidé (une étape = une prise, comme le guide photos), vidéo moteur,
 * scan du mandat en PDF. Le marchand ne passe à l'étape suivante qu'une fois la
 * prise faite. Tout est envoyé d'un coup ; le script Apps Script auto1 récupère
 * les fichiers et les range dans le Drive par lead.
 *
 * ENV : LINK_SECRET, PULL_KEY, ADMIN_KEY, MAX_MB
 */

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { LINK_SECRET, PULL_KEY, ADMIN_KEY, MAX_MB } = process.env;
const MAX_BYTES = (parseInt(MAX_MB || '40', 10)) * 1024 * 1024;

const STORE = path.join(os.tmpdir(), 'auto1bridge');
try { fs.mkdirSync(STORE, { recursive: true }); } catch (e) {}

const app = express();
app.set('trust proxy', true);
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function baseUrl(req) {
  var proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0];
  return proto + '://' + req.get('host');
}
function tokenFor(lead) {
  return crypto.createHmac('sha256', LINK_SECRET || '').update(String(lead).toUpperCase()).digest('hex').slice(0, 20);
}
function tokenOk(lead, t) {
  if (!lead || !t) return false;
  const a = Buffer.from(tokenFor(lead)), b = Buffer.from(String(t));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function cleanLead(s) {
  return String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}
function pullOk(req) { return PULL_KEY && (req.query.key === PULL_KEY || req.get('X-Pull-Key') === PULL_KEY); }

// ---- Page marchand (parcours guidé) ----
function pageHtml(lead, t) {
  const L = cleanLead(lead);
  return `<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto1 — Photos du véhicule</title>
<style>
 :root{--o:#ff7a1a;--b:#1b2432;--g:#5b6676;--blue:#123a8b}*{box-sizing:border-box}
 body{margin:0;font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:var(--b)}
 .wrap{max-width:560px;margin:0 auto;padding:16px 14px 96px}
 .head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
 .head b{color:var(--blue);font-size:17px}
 .lead{background:#fff3e8;color:#b45700;border:1px solid #ffd8b0;border-radius:8px;padding:2px 10px;font-weight:800;font-size:13px}
 .prog{height:9px;background:#e6eaf2;border-radius:6px;overflow:hidden;margin:6px 0 14px}
 .prog>i{display:block;height:100%;background:var(--o);width:0;transition:width .25s}
 .card{background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:20px;box-shadow:0 8px 30px rgba(20,30,60,.06)}
 .step{color:var(--g);font-size:12.5px;font-weight:800;text-transform:uppercase;letter-spacing:.5px}
 h1{font-size:21px;margin:4px 0 2px}.hint{color:var(--g);margin:0 0 14px}
 .shot{width:100%;aspect-ratio:4/3;border:2px dashed #c7d0e0;border-radius:14px;background:#fbfcfe;display:flex;align-items:center;justify-content:center;color:var(--g);text-align:center;overflow:hidden;font-size:15px}
 .shot img,.shot video{width:100%;height:100%;object-fit:cover}
 .big{width:100%;margin-top:14px;padding:16px;background:var(--o);color:#fff;border:none;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer}
 .ghost{width:100%;margin-top:10px;padding:12px;background:#eef4ff;border:1px solid #2f7bff;color:#1c5fd0;border-radius:12px;font-weight:700;cursor:pointer}
 .nav{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #e6eaf2;display:flex;gap:10px;padding:12px 14px}
 .nav .inner{display:flex;gap:10px;max-width:560px;margin:0 auto;width:100%}
 .nav button{flex:1;padding:15px;border-radius:12px;border:none;font-size:16px;font-weight:800;cursor:pointer}
 #prev{background:#f2f4f8;color:#3a4453;border:1px solid #d9dfe9;flex:.6}
 #next{background:#0f8a51;color:#fff}#next:disabled{background:#aecdbc}
 .status{text-align:center;margin-top:12px;min-height:20px;font-weight:800}
 .ok{color:#0f8a51}.err{color:#c0121e}
 input[type=file]{display:none}
 .bar{height:8px;background:#e6eaf2;border-radius:6px;overflow:hidden;margin-top:12px;display:none}.bar>i{display:block;height:100%;width:0;background:var(--o)}
</style></head><body><div class="wrap">
 <div class="head"><b>AUTO1 · Photos du véhicule</b><span class="lead">${L}</span></div>
 <div class="prog"><i id="pg"></i></div>
 <div class="card" id="card"></div>
 <div class="bar" id="bar"><i></i></div>
 <div class="status" id="stmsg"></div>
</div>
<div class="nav"><div class="inner"><button id="prev">◀</button><button id="next" disabled>Suivant ▶</button></div></div>

<div id="rec" style="display:none;position:fixed;inset:0;background:#000;z-index:9999">
 <video id="recVid" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000"></video>
 <div id="recInfo" style="position:absolute;top:0;left:0;right:0;text-align:center;color:#fff;background:rgba(0,0,0,.65);padding:10px;font-weight:700;z-index:2">Prêt — appuie sur Démarrer</div>
 <div style="position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;padding:16px 14px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.9) 35%);z-index:2">
  <button type="button" id="recCancel" style="flex:1;padding:16px;border:none;border-radius:12px;background:#444;color:#fff;font-weight:700;font-size:16px">Annuler</button>
  <button type="button" id="recToggle" style="flex:2;padding:16px;border:none;border-radius:12px;background:#e11d2a;color:#fff;font-weight:800;font-size:16px">● Démarrer</button>
 </div>
</div>
<div id="scan" style="display:none;position:fixed;inset:0;background:#000;z-index:9999">
 <video id="scanVid" autoplay playsinline muted style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000"></video>
 <div id="scanThumbs" style="position:absolute;left:0;right:0;bottom:92px;display:flex;gap:6px;overflow-x:auto;padding:6px 8px;background:rgba(0,0,0,.55);z-index:2"></div>
 <div style="position:absolute;left:0;right:0;bottom:0;display:flex;gap:8px;padding:16px 14px calc(16px + env(safe-area-inset-bottom));background:linear-gradient(transparent,rgba(0,0,0,.9) 35%);z-index:2">
  <button type="button" id="scanCancel" style="flex:1;padding:16px;border:none;border-radius:12px;background:#444;color:#fff;font-weight:700;font-size:15px">Annuler</button>
  <button type="button" id="scanCap" style="flex:2;padding:16px;border:none;border-radius:12px;background:#ff7a1a;color:#fff;font-weight:800;font-size:15px">📸 Capturer</button>
  <button type="button" id="scanDone" style="flex:1.4;padding:16px;border:none;border-radius:12px;background:#0f8a51;color:#fff;font-weight:800;font-size:15px">✅ Terminer</button>
 </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<input type="file" accept="image/*" capture="environment" id="capin">
<input type="file" accept="video/*" capture="environment" id="vidin">
<input type="file" accept="application/pdf,.pdf" id="pdfin">
<script>
 var LEAD=${JSON.stringify(L)}, T=${JSON.stringify(String(t || ''))}, MAXB=${MAX_BYTES};
 var STEPS=[
  {t:"Photo de devant du véhicule",h:"Placez-vous face à l'avant",type:"photo",name:"01_devant"},
  {t:"Photo de côté avant droit",h:"En diagonale, coin avant droit",type:"photo",name:"02_avant_droit"},
  {t:"Photo latérale droite",h:"De profil, côté droit complet",type:"photo",name:"03_lateral_droit"},
  {t:"Photo arrière droit",h:"En diagonale, coin arrière droit",type:"photo",name:"04_arriere_droit"},
  {t:"Photo de l'arrière du véhicule",h:"Placez-vous face à l'arrière",type:"photo",name:"05_arriere"},
  {t:"Photo arrière gauche",h:"En diagonale, coin arrière gauche",type:"photo",name:"06_arriere_gauche"},
  {t:"Photo latérale gauche",h:"De profil, côté gauche complet",type:"photo",name:"07_lateral_gauche"},
  {t:"Photo de côté avant gauche",h:"En diagonale, coin avant gauche",type:"photo",name:"08_avant_gauche"},
  {t:"Intérieur côté passager",h:"Porte passager ouverte",type:"photo",name:"09_int_passager"},
  {t:"Intérieur côté conducteur",h:"Porte conducteur ouverte",type:"photo",name:"10_int_conducteur"},
  {t:"Arrière côté passager",h:"Banquette arrière, côté passager",type:"photo",name:"11_arr_passager"},
  {t:"Arrière côté conducteur",h:"Banquette arrière, côté conducteur",type:"photo",name:"12_arr_conducteur"},
  {t:"Photo du coffre",h:"Coffre ouvert et vide",type:"photo",name:"13_coffre"},
  {t:"Photo du tableau de bord entier",h:"Depuis la banquette arrière",type:"photo",name:"14_tableau_bord"},
  {t:"Photo du compteur (moteur démarré)",h:"Moteur démarré, compteur bien lisible",type:"photo",name:"15_compteur"},
  {t:"Vidéo du moteur tournant",h:"Capot ouvert, moteur démarré, 10 à 20 s",type:"video",name:"16_video_moteur"},
  {t:"Mandat signé et tamponné",h:"Scannez-le en PDF (ou importez le PDF)",type:"mandat",name:"Mandat"}
 ];
 var picked={}, cur=0;
 var card=document.getElementById('card'), pg=document.getElementById('pg'), stmsg=document.getElementById('stmsg');
 var prev=document.getElementById('prev'), next=document.getElementById('next');
 var capin=document.getElementById('capin'), pdfin=document.getElementById('pdfin'), vidin=document.getElementById('vidin');

 function extOf(f){ var n=(f.name||''); var d=n.lastIndexOf('.'); if(d>0) return n.slice(d); if((f.type||'').indexOf('mp4')>=0) return '.mp4'; if((f.type||'').indexOf('webm')>=0) return '.webm'; if((f.type||'').indexOf('png')>=0) return '.png'; if((f.type||'').indexOf('pdf')>=0) return '.pdf'; return '.jpg'; }
 function storeStep(f){
  if(f.size>MAXB){ stmsg.className='status err'; stmsg.textContent='Fichier trop lourd ('+(f.size/1048576).toFixed(0)+' Mo).'; return; }
  var s=STEPS[cur];
  var fname = s.name + (s.type==='mandat' ? ('_'+LEAD+'.pdf') : (s.type==='photo' ? '.jpg' : extOf(f)));
  picked[cur]=new File([f], fname, {type:f.type||'application/octet-stream'});
  stmsg.className='status ok'; stmsg.textContent='✓ Enregistré';
  render();
 }
 function previewHtml(i){ var f=picked[i]; var u=URL.createObjectURL(f);
  if((f.type||'').indexOf('video')===0) return '<video src="'+u+'" muted playsinline></video>';
  if((f.type||'').indexOf('pdf')>=0) return '<div style="color:#0f8a51;font-weight:800;padding:12px">📄 Mandat PDF ajouté ✓</div>';
  return '<img src="'+u+'">'; }
 function placeholder(s){ return s.type==='video'?'🎥<br>Appuyez sur « Filmer »':(s.type==='mandat'?'📄<br>Scannez le mandat en PDF':'📷<br>Appuyez sur « Prendre la photo »'); }

 function render(){
  var s=STEPS[cur];
  pg.style.width=Math.round(cur/STEPS.length*100)+'%';
  var shot = picked[cur]?previewHtml(cur):placeholder(s);
  var btn='';
  if(s.type==='photo') btn='<button class="big" id="cap">📷 '+(picked[cur]?'Reprendre la photo':'Prendre la photo')+'</button>';
  else if(s.type==='video') btn='<button class="big" id="cap">🎥 '+(picked[cur]?'Refilmer':'Filmer (10-20s)')+'</button>';
  else btn='<button class="big" id="cap">📄 '+(picked[cur]?'Re-scanner':'Scanner le mandat')+'</button><button class="ghost" id="imp">…ou importer le mandat en PDF</button>';
  card.innerHTML='<div class="step">Étape '+(cur+1)+' / '+STEPS.length+'</div><h1>'+s.t+'</h1><p class="hint">'+s.h+'</p><div class="shot">'+shot+'</div>'+btn;
  var cap=document.getElementById('cap');
  if(s.type==='photo') cap.onclick=function(){ capin.click(); };
  else if(s.type==='video') cap.onclick=openRec;
  else cap.onclick=openScan;
  var imp=document.getElementById('imp'); if(imp) imp.onclick=function(){ pdfin.click(); };
  prev.style.visibility=cur===0?'hidden':'visible';
  next.disabled=!picked[cur];
  next.textContent = cur===STEPS.length-1 ? '✅ Tout envoyer' : 'Suivant ▶';
  stmsg.textContent='';
 }
 capin.onchange=function(e){ if(e.target.files[0]) storeStep(e.target.files[0]); e.target.value=''; };
 vidin.onchange=function(e){ if(e.target.files[0]) storeStep(e.target.files[0]); e.target.value=''; };
 pdfin.onchange=function(e){ if(e.target.files[0]) storeStep(e.target.files[0]); e.target.value=''; };
 prev.onclick=function(){ if(cur>0){cur--;render();} };
 next.onclick=function(){ if(cur<STEPS.length-1){ cur++; render(); } else sendAll(); };

 // ---- Enregistrement vidéo ----
 var recStream=null, mr=null, chunks=[], recTimer=null, recT0=0, MAXSEC=90;
 var recEl=document.getElementById('rec'), recVid=document.getElementById('recVid'), recInfo=document.getElementById('recInfo'), recToggle=document.getElementById('recToggle');
 function recMime(){var o=['video/mp4;codecs=h264','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];for(var i=0;i<o.length;i++){try{if(window.MediaRecorder&&MediaRecorder.isTypeSupported(o[i]))return o[i];}catch(e){}}return '';}
 function stopRecCam(){ if(recTimer){clearInterval(recTimer);recTimer=null;} if(recStream){recStream.getTracks().forEach(function(t){t.stop();});recStream=null;} recEl.style.display='none'; mr=null; }
 function openRec(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia||!window.MediaRecorder){ vidin.click(); return; }
  chunks=[];recInfo.textContent='Prêt — appuie sur Démarrer';recToggle.textContent='● Démarrer';recToggle.style.background='#e11d2a';
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:true}).then(function(s){recStream=s;recVid.srcObject=s;recEl.style.display='block';}).catch(function(){ vidin.click(); });
 }
 document.getElementById('recCancel').onclick=function(){ if(mr&&mr.state&&mr.state!=='inactive'){try{mr.stop();}catch(e){}} chunks=[]; stopRecCam(); };
 recToggle.onclick=function(){
  if(!mr||mr.state==='inactive'){
   var mime=recMime();
   try{ mr=mime?new MediaRecorder(recStream,{mimeType:mime,videoBitsPerSecond:2500000}):new MediaRecorder(recStream,{videoBitsPerSecond:2500000}); }catch(e){ try{mr=new MediaRecorder(recStream);}catch(e2){stmsg.className='status err';stmsg.textContent='Enregistrement impossible ici.';stopRecCam();return;} }
   chunks=[];
   mr.ondataavailable=function(e){ if(e.data&&e.data.size)chunks.push(e.data); };
   mr.onstop=function(){
    var type=(mr&&mr.mimeType)||mime||'video/webm';
    var blob=new Blob(chunks,{type:type});
    if(blob.size>MAXB){ stmsg.className='status err'; stmsg.textContent='Vidéo trop lourde ('+(blob.size/1048576).toFixed(0)+' Mo). Filme plus court.'; stopRecCam(); return; }
    stopRecCam(); storeStep(blob);
   };
   try{ mr.start(); }catch(e){ stmsg.className='status err';stmsg.textContent='Démarrage impossible.';stopRecCam();return; }
   recT0=Date.now(); recToggle.textContent='■ Arrêter'; recToggle.style.background='#333';
   recTimer=setInterval(function(){ var sec=Math.floor((Date.now()-recT0)/1000); recInfo.textContent='● Enregistrement… '+sec+'s / '+MAXSEC+'s max'; if(sec>=MAXSEC){try{mr.stop();}catch(e){}} },250);
  } else { try{mr.stop();}catch(e){} }
 };

 // ---- Scanner mandat -> PDF ----
 var scanImgs=[], sStream=null;
 var scanEl=document.getElementById('scan'), scanVid=document.getElementById('scanVid'), scanThumbs=document.getElementById('scanThumbs');
 function stopScan(){ if(sStream){sStream.getTracks().forEach(function(t){t.stop();});sStream=null;} scanEl.style.display='none'; }
 function openScan(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){stmsg.className='status err';stmsg.textContent='Scanner non supporté — importe un PDF.';return;}
  scanImgs=[];scanThumbs.innerHTML='';
  navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false}).then(function(s){sStream=s;scanVid.srcObject=s;scanEl.style.display='block';}).catch(function(){stmsg.className='status err';stmsg.textContent='Caméra refusée — importe le mandat en PDF.';});
 }
 document.getElementById('scanCancel').onclick=stopScan;
 document.getElementById('scanCap').onclick=function(){
  if(!scanVid.videoWidth)return;
  var c=document.createElement('canvas');c.width=scanVid.videoWidth;c.height=scanVid.videoHeight;c.getContext('2d').drawImage(scanVid,0,0);
  var url=c.toDataURL('image/jpeg',0.8);scanImgs.push({url:url,w:c.width,h:c.height});
  var im=document.createElement('img');im.src=url;im.style.height='56px';im.style.borderRadius='6px';im.style.border='2px solid #ff7a1a';scanThumbs.appendChild(im);scanThumbs.scrollLeft=scanThumbs.scrollWidth;
 };
 document.getElementById('scanDone').onclick=function(){
  if(!scanImgs.length){stopScan();return;}
  if(!(window.jspdf&&window.jspdf.jsPDF)){stmsg.className='status err';stmsg.textContent='Librairie PDF non chargée — réessaie.';return;}
  var jsPDF=window.jspdf.jsPDF;var pdf=new jsPDF({unit:'pt',format:'a4'});
  var pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();
  scanImgs.forEach(function(it,i){ if(i>0)pdf.addPage(); var r=Math.min(pw/it.w,ph/it.h);var w=it.w*r,h=it.h*r; pdf.addImage(it.url,'JPEG',(pw-w)/2,(ph-h)/2,w,h); });
  var blob=pdf.output('blob'); stopScan(); storeStep(blob);
 };

 // ---- Envoi final ----
 function sendAll(){
  var count=Object.keys(picked).length;
  next.disabled=true; stmsg.className='status'; stmsg.textContent='Envoi en cours…';
  var bar=document.getElementById('bar');bar.style.display='block';var barI=bar.querySelector('i');
  var fd=new FormData(); fd.append('lead',LEAD); fd.append('t',T);
  for(var k in picked){ fd.append('photos', picked[k], picked[k].name); }
  var xhr=new XMLHttpRequest(); xhr.open('POST','upload');
  xhr.upload.onprogress=function(e){ if(e.lengthComputable) barI.style.width=Math.round(e.loaded/e.total*100)+'%'; };
  xhr.onload=function(){ var r;try{r=JSON.parse(xhr.responseText);}catch(_){r={};}
   if(xhr.status===200&&r.ok){ document.querySelector('.wrap').innerHTML='<div class="card" style="text-align:center"><div style="font-size:44px">✅</div><h1>Merci !</h1><p class="hint">'+r.saved+' fichier(s) bien envoyé(s) pour le dossier '+LEAD+'. Vous pouvez fermer cette page.</p></div>'; document.querySelector('.nav').style.display='none'; }
   else { stmsg.className='status err'; stmsg.textContent='❌ '+(r.error||'Échec de l\\'envoi. Réessayez.'); next.disabled=false; bar.style.display='none'; }
  };
  xhr.onerror=function(){ stmsg.className='status err'; stmsg.textContent='❌ Problème réseau. Réessayez.'; next.disabled=false; bar.style.display='none'; };
  xhr.send(fd);
 }

 render();
</script></body></html>`;
}

// ---- Routes marchand ----
app.get('/', (req, res) => res.send('Auto1 bridge OK'));

app.get('/u', (req, res) => {
  const lead = cleanLead(req.query.lead);
  if (!lead || !tokenOk(lead, req.query.t)) {
    return res.status(403).send('<p style="font:16px sans-serif;padding:24px">Lien invalide ou expiré. Contactez votre interlocuteur Auto1.</p>');
  }
  res.set('Content-Type', 'text/html; charset=utf-8').send(pageHtml(lead, req.query.t));
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 40 } });
app.post('/upload', upload.array('photos', 40), (req, res) => {
  try {
    const lead = cleanLead(req.body.lead);
    if (!lead || !tokenOk(lead, req.body.t)) return res.status(403).json({ ok: false, error: 'Lien invalide.' });
    if (!req.files || !req.files.length) return res.status(400).json({ ok: false, error: 'Aucun fichier.' });
    let saved = 0;
    for (const f of req.files) {
      const id = crypto.randomBytes(9).toString('hex');
      fs.writeFileSync(path.join(STORE, id + '.bin'), f.buffer);
      fs.writeFileSync(path.join(STORE, id + '.json'), JSON.stringify({
        id, lead, name: f.originalname || ('photo_' + id), mime: f.mimetype || 'application/octet-stream',
        size: f.size, ts: Date.now()
      }));
      saved++;
    }
    res.json({ ok: true, saved });
  } catch (e) { res.status(500).json({ ok: false, error: 'Erreur serveur.' }); }
});

// ---- API récupération (Apps Script auto1) ----
app.get('/pending', (req, res) => {
  if (!pullOk(req)) return res.status(403).json({ error: 'clé invalide' });
  const out = [];
  for (const fn of fs.readdirSync(STORE)) {
    if (!fn.endsWith('.json')) continue;
    try { out.push(JSON.parse(fs.readFileSync(path.join(STORE, fn), 'utf8'))); } catch (e) {}
  }
  out.sort((a, b) => a.ts - b.ts);
  res.json({ files: out.slice(0, 50) });
});

app.get('/file/:id', (req, res) => {
  if (!pullOk(req)) return res.status(403).send('clé invalide');
  const id = String(req.params.id).replace(/[^a-f0-9]/g, '');
  const bin = path.join(STORE, id + '.bin');
  if (!id || !fs.existsSync(bin)) return res.status(404).send('introuvable');
  res.set('Content-Type', 'application/octet-stream').send(fs.readFileSync(bin));
});

app.post('/done', (req, res) => {
  if (!pullOk(req)) return res.status(403).json({ error: 'clé invalide' });
  const ids = (req.body && req.body.ids) || [];
  let removed = 0;
  for (const raw of ids) {
    const id = String(raw).replace(/[^a-f0-9]/g, '');
    if (!id) continue;
    for (const ext of ['.bin', '.json']) { try { fs.unlinkSync(path.join(STORE, id + ext)); removed++; } catch (e) {} }
  }
  res.json({ ok: true, removed });
});

// ---- Générateur de lien marchand ----
app.get('/link', (req, res) => {
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY) return res.status(403).send('Clé admin invalide.');
  const lead = cleanLead(req.query.lead);
  const key = (req.query.key || '').replace(/"/g, '');
  const base = baseUrl(req);
  if (!lead) {
    return res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Auto1 — Générer un lien</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#1b2432;margin:0}.w{max-width:520px;margin:40px auto;padding:0 16px}.c{background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:24px}h1{font-size:20px;margin:0 0 14px}input{width:100%;padding:13px;border:1px solid #d3dae6;border-radius:10px;font-size:16px;text-transform:uppercase}button{width:100%;margin-top:12px;padding:14px;background:#ff7a1a;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:800;cursor:pointer}</style></head>
<body><div class="w"><div class="c"><h1>Générer un lien marchand</h1><form method="get" action="/link"><input name="lead" placeholder="Lead (ex : UN04099)" autofocus autocapitalize="characters"><input type="hidden" name="key" value="${key}"><button>Générer le lien</button></form></div></div></body></html>`);
  }
  const url = base + '/u?lead=' + lead + '&t=' + tokenFor(lead);
  if (req.query.format === 'json') return res.json({ lead, url });
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lien ${lead}</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#1b2432;margin:0}.w{max-width:620px;margin:40px auto;padding:0 16px}.c{background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:24px}h1{font-size:19px;margin:0 0 4px}.lead{display:inline-block;background:#fff3e8;color:#b45700;border:1px solid #ffd8b0;border-radius:8px;padding:2px 10px;font-weight:800;margin-bottom:14px}.link{display:block;background:#f5f7fb;border:1px solid #e2e7f0;border-radius:10px;padding:14px;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px}button{margin-top:12px;padding:14px 18px;background:#ff7a1a;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:800;cursor:pointer}a.open{display:inline-block;margin-top:12px;margin-left:8px;padding:14px 18px;background:#eef4ff;border:1px solid #2f7bff;color:#1c5fd0;border-radius:10px;font-weight:700;text-decoration:none}.ok{color:#0f8a51;font-weight:700;margin-top:10px;min-height:20px}.n{color:#5b6676;font-size:14px;margin-top:14px}</style></head>
<body><div class="w"><div class="c"><h1>Lien pour le marchand</h1><span class="lead">Dossier ${lead}</span>
<span class="link" id="lk">${url}</span>
<button onclick="navigator.clipboard.writeText(document.getElementById('lk').textContent).then(function(){document.getElementById('m').textContent='✅ Lien copié — colle-le dans ton mail.';})">📋 Copier le lien</button>
<a class="open" href="${url}" target="_blank">Ouvrir</a>
<div class="ok" id="m"></div>
<div class="n">Colle ce lien dans ton mail. Le marchand suit le parcours guidé (15 photos + vidéo + mandat) et tout arrive dans le Drive, dossier ${lead}.</div>
<div class="n"><a href="/link?key=${key}">← générer un autre lien</a></div></div></div></body></html>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bridge en écoute sur ' + port));
