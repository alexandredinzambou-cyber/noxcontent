const fs = require('fs');

const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>FrenchStream API</title>
<style>
body{font-family:sans-serif;background:#1a1a2e;color:#eee;padding:20px;max-width:1200px;margin:0 auto}
h1{color:#e94560}
.card{background:#16213e;border:1px solid #0f3460;border-radius:12px;padding:20px;margin-bottom:20px}
input,select{width:100%;padding:10px;margin:5px 0 15px;border:1px solid #0f3460;border-radius:6px;background:#0f0f23;color:#eee}
button{background:#e94560;color:#fff;border:none;padding:12px 20px;border-radius:6px;cursor:pointer;font-weight:bold;width:100%}
.result{background:#0f0f23;border:1px solid #0f3460;border-radius:8px;padding:15px;margin:10px 0}
.stream{display:block;background:#0f3460;color:#00d9ff;padding:10px;border-radius:6px;margin:5px 0;word-break:break-all;text-decoration:none}
.stream:hover{background:#e94560}
.error{color:#ff6b6b}
.loading{color:#00d9ff;text-align:center;padding:20px}
</style>
</head>
<body>
<h1>FrenchStream API Tester</h1>
`;
const html2 = `
<div class="card"><h2>🔍 Recherche</h2><input id="q" placeholder="requête..."><select id="type"><option value="">Tous</option><option value="movie">Film</option><option value="series">Série</option></select><button onclick="search()">Rechercher</button><div id="res"></div></div>
<div class="card"><h2>🎬 Film</h2><input id="mid" placeholder="ID film"><button onclick="movie()">Streams</button><div id="mres"></div></div>
<div class="card"><h2>📺 Série</h2><input id="sid" placeholder="ID série"> <input id="ssn" type="number" value="1" min="1" style="width:80px"> <input id="sep" type="number" value="1" min="1" style="width:80px"><button onclick="series()">Streams</button><div id="sres"></div></div>
<div class="card"><h2>🔗 Résoudre URL</h2><input id="rurl" placeholder="URL embed..." style="width:70%"><select id="rplayer" style="width:30%" margin-left:5px><option value="premium">FSvid</option><option value="vidzy">Vidzy</option><option value="uqload">Uqload</option><option value="voe">Voe</option><option value="dood">Dood</option><option value="filmoon">Filmoon</option></select><button onclick="resolve()">Résoudre</button><div id="rres"></div></div>
<div class="card"><h2>📋 Métadonnées</h2><input id="murl" placeholder="URL page..."><button onclick="meta()">Récupérer</button><div id="mres"></div></div>
<div class="card"><h2>❤️ Santé</h2><button onclick="health()">Vérifier</button><div id="hres"></div></div>
<script>
const B="http://localhost:7001";
function L(i){document.getElementById(i).innerHTML="<div class=\\"loading\\">Chargement...</div>"}
function E(i,m){document.getElementById(i).innerHTML="<div class=\\"error\\">❌ "+m+"</div>"}
async function A(e,o={}){const r=await fetch(B+e,{headers:{"Content-Type":"application/json"},...o});if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}
function R(s,c,m){const d=document.getElementById(c);if(!s||!s.length){d.innerHTML="<div class=\\"error\\">Aucun stream</div>";return}let h=m?"<div class=\\"result\\"><strong>"+(m.name||"")+(m.year?" ("+m.year+")":"")+"</strong></div>":"";s.forEach(x=>{const t=x.isHls?"HLS":"MP4";h+="<div class=\\"result\\"><strong>"+x.playerName+" "+x.lang+" ("+t+")</strong><a class=\\"stream\\" href=\\""+x.url+"\\" target=\\"_blank\\">"+x.url+"</a></div>"});d.innerHTML=h}
function S(r,c){const d=document.getElementById(c);if(!r||!r.length){d.innerHTML="<div class=\\"error\\">Aucun résultat</div>";return}let h="";r.forEach(x=>{const m=x.type==="movie";h+="<div class=\\"result\\" onclick=\\"document.getElementById('"+(m?"mid":"sid")+"').value=((x.url.match(/\\/(\\d+)-/)||[])[1]||'')\\"><strong>"+x.title+"</strong> <span style=\\"color:"+(m?"#28a745":"#ffc107")+"\\">"+(m?"Film":"Série")+"</span></div>"});d.innerHTML=h}
async function search(){const q=document.getElementById("q").value.trim(),t=document.getElementById("type").value;if(!q)return alert("Requête?");L("res");try{const d=await A("/search?q="+encodeURIComponent(q)+(t?"&type="+t:""));S(d.results,"res")}catch(e){E("res",e.message)}}
async function movie(){const i=document.getElementById("mid").value.trim();if(!i)return alert("ID?");L("mres");try{const d=await A("/movie/"+i+"/streams");R(d.streams,"mres",d.meta)}catch(e){E("mres",e.message)}}
async function series(){const i=document.getElementById("sid").value.trim(),s=document.getElementById("ssn").value,e=document.getElementById("sep").value;if(!i)return alert("ID?");L("sres");try{const d=await A("/series/"+i+"/streams?season="+s+"&episode="+e);R(d.streams,"sres",d.meta)}catch(e){E("sres",e.message)}}
async function resolve(){const u=document.getElementById("rurl").value.trim(),p=document.getElementById("rplayer").value;if(!u)return alert("URL?");L("rres");try{const d=await A("/resolve",{method:"POST",body:JSON.stringify({url:u,player:p})});const x=d.resolved;document.getElementById("rres").innerHTML="<div class=\\"result\\"><strong>✅ "+d.player+" ("+(x.url.includes(".m3u8")?"HLS":"MP4")+")</strong><a class=\\"stream\\" href=\\""+x.url+"\\" target=\\"_blank\\">"+x.url+"</a>"+(x.headers?"<pre>"+JSON.stringify(x.headers,null,2)+"</pre>":"")+"</div>"}catch(e){E("rres",e.message)}}
async function meta(){const u=document.getElementById("murl").value.trim();if(!u)return alert("URL?");L("mres");try{const d=await A("/meta?url="+encodeURIComponent(u)),m=d.meta;document.getElementById("mres").innerHTML="<div class=\\"result\\"><strong>"+(m.name||"")+(m.year?" ("+m.year+")":"")+"</strong>"+(m.description?"<p>"+m.description.substring(0,200)+"...</p>":"")+(m.poster?"<img src=\\""+m.poster+"\\" style=\\"max-width:200px\\">":"")+"</div>"}catch(e){E("mres",e.message)}}
async function health(){L("hres");try{const d=await A("/health");document.getElementById("hres").innerHTML="<div class=\\"result\\"><strong>✅ API OK</strong> Base: "+d.baseUrl+"</div>"}catch(e){E("hres",e.message)}}
health();
</script>
</body>
</html>`;

fs.writeFileSync('public/index.html', html + html2);
console.log('Frontend created!');