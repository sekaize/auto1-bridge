/**
 * Auto1 — Pont dépôt photos marchand (hébergement gratuit)
 * -------------------------------------------------------
 * Le marchand ouvre son lien (avec le LEAD), dépose ses photos. Le serveur les
 * garde quelques minutes seulement. C'est ton script Apps Script auto1 qui vient
 * ensuite les récupérer (API /pending + /file) et les range dans le Drive auto1,
 * puis appelle /done pour que le serveur les efface.
 *
 * => Aucun Google Cloud, aucune clé de compte de service, aucun coût.
 *
 * Variables d'environnement (sur l'hébergeur) :
 *   LINK_SECRET  -> secret pour signer/vérifier les liens marchand (invente une longue chaîne)
 *   PULL_KEY     -> secret que ton Apps Script présentera pour récupérer les fichiers
 *   ADMIN_KEY    -> secret pour le générateur de liens /link
 *   MAX_MB       -> (optionnel) taille max par fichier, défaut 40
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
app.set('trust proxy', true); // Render/Proxy : req.protocol renvoie https
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function baseUrl(req) {
  var proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0];
  return proto + '://' + req.get('host');
}

// ---- Jetons ----
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

// ---- Page marchand ----
function pageHtml(lead, t) {
  const L = cleanLead(lead);
  return `<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto1 — Envoi des photos</title>
<style>
  :root{--o:#ff7a1a;--b:#1b2432;--g:#5b6676}*{box-sizing:border-box}
  body{margin:0;font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:var(--b)}
  .wrap{max-width:560px;margin:0 auto;padding:20px 16px 60px}
  .card{background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:20px;box-shadow:0 8px 30px rgba(20,30,60,.06)}
  h1{font-size:20px;margin:0 0 4px}
  .lead{display:inline-block;background:#fff3e8;color:#b45700;border:1px solid #ffd8b0;border-radius:8px;padding:3px 10px;font-weight:800;letter-spacing:.5px;margin:6px 0 14px}
  p{color:var(--g);margin:8px 0}
  .drop{border:2px dashed #c7d0e0;border-radius:14px;padding:22px;text-align:center;color:var(--g);background:#fbfcfe}
  .btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
  .pick{flex:1;min-width:150px;display:block;text-align:center;background:#eef4ff;border:1px solid #2f7bff;color:#1c5fd0;border-radius:12px;padding:14px;font-weight:700;cursor:pointer;font:inherit;font-weight:700}
  input[type=file]{display:none}
  #list{margin:14px 0 0;display:flex;flex-direction:column;gap:8px}
  .f{display:flex;align-items:center;gap:10px;background:#f5f7fb;border:1px solid #e6eaf2;border-radius:10px;padding:8px 10px;font-size:14px}
  .f .n{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .send{width:100%;margin-top:18px;padding:16px;background:var(--o);color:#fff;border:none;border-radius:12px;font-size:17px;font-weight:800;cursor:pointer}
  .send:disabled{opacity:.5}
  .status{margin-top:14px;font-weight:700;text-align:center;min-height:22px}
  .ok{color:#0f8a51}.err{color:#c0121e}
  .bar{height:8px;background:#e6eaf2;border-radius:6px;overflow:hidden;margin-top:12px;display:none}
  .bar>i{display:block;height:100%;width:0;background:var(--o);transition:width .2s}
</style></head><body><div class="wrap"><div class="card">
  <h1>Envoi des photos du véhicule</h1>
  <div class="lead">Dossier ${L}</div>
  <p>Merci d'ajouter <b>toutes les photos et vidéos du véhicule</b> ainsi que votre <b>mandat signé et tamponné, scanné en PDF</b>, puis d'appuyer sur <b>Envoyer</b>. Vous pouvez tout envoyer en une seule fois.</p>
  <div class="drop" id="drop">Glissez vos fichiers ici, ou :</div>
  <div class="btns">
    <label class="pick">📷 Prendre une photo<input type="file" accept="image/*" capture="environment" id="cam" multiple></label>
    <label class="pick">🖼️ Photos / PDF / vidéo<input type="file" accept="image/*,application/pdf,video/*" id="fil" multiple></label>
    <button type="button" class="pick" id="scanBtn">📄 Scanner le mandat</button>
  </div>
  <div style="margin-top:8px;font-size:13.5px"><label style="color:#2f7bff;cursor:pointer">…ou importer le mandat déjà en PDF<input type="file" accept="application/pdf,.pdf" id="man" multiple style="display:none"></label></div>
  <div id="list"></div>
  <div class="bar" id="bar"><i></i></div>
  <button class="send" id="send" disabled>Envoyer</button>
  <div class="status" id="st"></div>
</div></div>
<div id="scan" style="display:none;position:fixed;inset:0;background:#000;z-index:9999;flex-direction:column">
  <video id="scanVid" autoplay playsinline muted style="flex:1;width:100%;object-fit:contain;background:#000"></video>
  <div id="scanThumbs" style="display:flex;gap:6px;overflow-x:auto;padding:6px 8px;background:#111;min-height:0"></div>
  <div style="display:flex;gap:8px;padding:12px;background:#111">
    <button type="button" id="scanCancel" style="flex:1;padding:15px;border:none;border-radius:10px;background:#333;color:#fff;font-weight:700;font-size:15px">Annuler</button>
    <button type="button" id="scanCap" style="flex:2;padding:15px;border:none;border-radius:10px;background:#ff7a1a;color:#fff;font-weight:800;font-size:15px">📸 Capturer</button>
    <button type="button" id="scanDone" style="flex:1.4;padding:15px;border:none;border-radius:10px;background:#0f8a51;color:#fff;font-weight:800;font-size:15px">✅ Terminer</button>
  </div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
<script>
  var LEAD=${JSON.stringify(L)}, T=${JSON.stringify(String(t || ''))}, MAXB=${MAX_BYTES}, files=[];
  var list=document.getElementById('list'), send=document.getElementById('send'), st=document.getElementById('st');
  function human(n){return n>1048576?(n/1048576).toFixed(1)+' Mo':Math.round(n/1024)+' Ko';}
  function render(){list.innerHTML='';files.forEach(function(f,i){var d=document.createElement('div');d.className='f';
    d.innerHTML='<span>📎</span><span class="n"></span><span>'+human(f.size)+'</span><span data-i="'+i+'" style="cursor:pointer;color:#c0121e;font-weight:800">✕</span>';
    d.querySelector('.n').textContent=f.name;list.appendChild(d);});
    send.disabled=files.length===0;send.textContent='Envoyer'+(files.length?' ('+files.length+')':'');}
  list.addEventListener('click',function(e){var i=e.target.getAttribute('data-i');if(i!==null){files.splice(+i,1);render();}});
  function add(fl){for(var i=0;i<fl.length;i++){var f=fl[i];if(f.size>MAXB){st.className='status err';st.textContent='« '+f.name+' » dépasse la taille maximale.';continue;}files.push(f);}render();}
  document.getElementById('cam').addEventListener('change',function(e){add(e.target.files);e.target.value='';});
  document.getElementById('fil').addEventListener('change',function(e){add(e.target.files);e.target.value='';});
  document.getElementById('man').addEventListener('change',function(e){add(e.target.files);e.target.value='';});
  // ---- Scanner de mandat -> PDF ----
  var scanImgs=[], stream=null;
  var scanEl=document.getElementById('scan'), vid=document.getElementById('scanVid'), thumbs=document.getElementById('scanThumbs');
  function stopScan(){ if(stream){stream.getTracks().forEach(function(t){t.stop();});stream=null;} scanEl.style.display='none'; }
  document.getElementById('scanBtn').addEventListener('click',function(){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){st.className='status err';st.textContent='Scanner non supporté ici — utilise « importer le mandat en PDF ».';return;}
    scanImgs=[];thumbs.innerHTML='';
    navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false}).then(function(s){
      stream=s;vid.srcObject=s;scanEl.style.display='flex';
    }).catch(function(){st.className='status err';st.textContent='Caméra refusée. Autorise la caméra, ou importe un PDF.';});
  });
  document.getElementById('scanCancel').addEventListener('click',stopScan);
  document.getElementById('scanCap').addEventListener('click',function(){
    if(!vid.videoWidth)return;
    var c=document.createElement('canvas');c.width=vid.videoWidth;c.height=vid.videoHeight;
    c.getContext('2d').drawImage(vid,0,0);
    var url=c.toDataURL('image/jpeg',0.8);
    scanImgs.push({url:url,w:c.width,h:c.height});
    var im=document.createElement('img');im.src=url;im.style.height='56px';im.style.borderRadius='6px';im.style.border='2px solid #ff7a1a';thumbs.appendChild(im);
    thumbs.scrollLeft=thumbs.scrollWidth;
  });
  document.getElementById('scanDone').addEventListener('click',function(){
    if(!scanImgs.length){stopScan();return;}
    if(!(window.jspdf&&window.jspdf.jsPDF)){st.className='status err';st.textContent='Librairie PDF non chargée — réessaie dans un instant.';return;}
    var jsPDF=window.jspdf.jsPDF;var pdf=new jsPDF({unit:'pt',format:'a4'});
    var pw=pdf.internal.pageSize.getWidth(),ph=pdf.internal.pageSize.getHeight();
    scanImgs.forEach(function(it,i){
      if(i>0)pdf.addPage();
      var r=Math.min(pw/it.w,ph/it.h);var w=it.w*r,h=it.h*r;
      pdf.addImage(it.url,'JPEG',(pw-w)/2,(ph-h)/2,w,h);
    });
    var blob=pdf.output('blob');
    var f=new File([blob],'Mandat_'+LEAD+'.pdf',{type:'application/pdf'});
    add([f]);
    st.className='status ok';st.textContent='📄 Mandat scanné ('+scanImgs.length+' page(s)) ajouté.';
    stopScan();
  });
  var drop=document.getElementById('drop');
  ['dragover','dragenter'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.style.background='#eef4ff';});});
  ['dragleave','drop'].forEach(function(ev){drop.addEventListener(ev,function(e){e.preventDefault();drop.style.background='#fbfcfe';});});
  drop.addEventListener('drop',function(e){add(e.dataTransfer.files);});
  send.addEventListener('click',function(){
    if(!files.length)return;send.disabled=true;st.className='status';st.textContent='Envoi en cours…';
    var bar=document.getElementById('bar');bar.style.display='block';var barI=bar.querySelector('i');
    var fd=new FormData();fd.append('lead',LEAD);fd.append('t',T);
    files.forEach(function(f){fd.append('photos',f,f.name);});
    var xhr=new XMLHttpRequest();xhr.open('POST','upload');
    xhr.upload.onprogress=function(e){if(e.lengthComputable)barI.style.width=Math.round(e.loaded/e.total*100)+'%';};
    xhr.onload=function(){var r;try{r=JSON.parse(xhr.responseText);}catch(_){r={};}
      if(xhr.status===200&&r.ok){st.className='status ok';st.textContent='✅ Merci ! '+r.saved+' fichier(s) bien envoyé(s).';list.innerHTML='';files=[];send.textContent='Envoyé ✓';}
      else{st.className='status err';st.textContent='❌ '+(r.error||'Échec. Réessayez.');send.disabled=false;}
      bar.style.display='none';barI.style.width='0';};
    xhr.onerror=function(){st.className='status err';st.textContent='❌ Problème réseau. Réessayez.';send.disabled=false;bar.style.display='none';};
    xhr.send(fd);});
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

// ---- API récupération (pour ton Apps Script auto1) ----
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
// JSON si &format=json, sinon une jolie page avec le lien + bouton Copier.
app.get('/link', (req, res) => {
  if (ADMIN_KEY && req.query.key !== ADMIN_KEY) return res.status(403).send('Clé admin invalide.');
  const lead = cleanLead(req.query.lead);
  const key = req.query.key || '';
  const base = baseUrl(req);
  if (!lead) {
    // pas de lead -> mini formulaire pour en saisir un
    return res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Auto1 — Générer un lien</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#1b2432;margin:0}
.w{max-width:520px;margin:40px auto;padding:0 16px}.c{background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:24px}
h1{font-size:20px;margin:0 0 14px}input{width:100%;padding:13px;border:1px solid #d3dae6;border-radius:10px;font-size:16px;text-transform:uppercase}
button{width:100%;margin-top:12px;padding:14px;background:#ff7a1a;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:800;cursor:pointer}</style></head>
<body><div class="w"><div class="c"><h1>Générer un lien marchand</h1>
<form method="get" action="/link"><input name="lead" placeholder="Lead (ex : UN04099)" autofocus autocapitalize="characters">
<input type="hidden" name="key" value="${key.replace(/"/g,'')}"><button>Générer le lien</button></form></div></div></body></html>`);
  }
  const url = base + '/u?lead=' + lead + '&t=' + tokenFor(lead);
  if (req.query.format === 'json') return res.json({ lead, url });
  res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lien ${lead}</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#1b2432;margin:0}
.w{max-width:620px;margin:40px auto;padding:0 16px}.c{background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:24px}
h1{font-size:19px;margin:0 0 4px}.lead{display:inline-block;background:#fff3e8;color:#b45700;border:1px solid #ffd8b0;border-radius:8px;padding:2px 10px;font-weight:800;margin-bottom:14px}
.link{display:block;background:#f5f7fb;border:1px solid #e2e7f0;border-radius:10px;padding:14px;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px}
button{margin-top:12px;padding:14px 18px;background:#ff7a1a;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:800;cursor:pointer}
a.open{display:inline-block;margin-top:12px;margin-left:8px;padding:14px 18px;background:#eef4ff;border:1px solid #2f7bff;color:#1c5fd0;border-radius:10px;font-weight:700;text-decoration:none}
.ok{color:#0f8a51;font-weight:700;margin-top:10px;min-height:20px}.n{color:#5b6676;font-size:14px;margin-top:14px}</style></head>
<body><div class="w"><div class="c">
<h1>Lien pour le marchand</h1><span class="lead">Dossier ${lead}</span>
<span class="link" id="lk">${url}</span>
<button onclick="navigator.clipboard.writeText(document.getElementById('lk').textContent).then(function(){document.getElementById('m').textContent='✅ Lien copié — colle-le dans ton mail.';})">📋 Copier le lien</button>
<a class="open" href="${url}" target="_blank">Ouvrir</a>
<div class="ok" id="m"></div>
<div class="n">Colle ce lien dans ton mail de procédure. Le marchand l'ouvre, ajoute ses photos, appuie sur Envoyer → elles arrivent dans le Drive, dossier ${lead}.</div>
<div class="n"><a href="/link?key=${key.replace(/"/g,'')}">← générer un autre lien</a></div>
</div></div></body></html>`);
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Bridge en écoute sur ' + port));
