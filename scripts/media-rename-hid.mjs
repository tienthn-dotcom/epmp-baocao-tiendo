/**
 * ĐỔI TÊN THƯ MỤC DỰ ÁN trong cây Media sang dạng NEO THEO ID CỨNG:
 *      "<tên dự án>"  →  "<tên dự án> [P0025]"
 * Vì sao: tên dự án đổi được / bị cắt khi dài / nhiều dự án tên na ná → neo theo tên thì 2 dự án khác
 * nhau dễ dùng chung kho media. ID cứng (cột IDCUNG) gán 1 lần, không đổi, không tái dùng.
 *
 * CHỈ ĐỔI TÊN — không dời, không xoá file nào (id thư mục giữ nguyên → link cũ vẫn sống).
 * Bản đồ <tên dự án> → <ID cứng> lấy từ KV install list (đọc qua file map JSON truyền vào).
 *
 *   node scripts/media-rename-hid.mjs map.json          (DRY)
 *   node scripts/media-rename-hid.mjs map.json --go     (làm thật)
 * map.json = [{ "name": "Mini Hotel PQ (B1-B5) Phòng", "hid": "P0025" }, ...]
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env","utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2];}
const GO=process.argv.includes("--go");
const MAPFILE=process.argv.find(a=>a.endsWith(".json"));
if(!MAPFILE){ console.log("Thiếu map.json — xem chú thích đầu file."); process.exit(1); }
const MAP=JSON.parse(readFileSync(MAPFILE,"utf8"));
const ROOT="1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO", S="supportsAllDrives=true&includeItemsFromAllDrives=true", F="application/vnd.google-apps.folder";
const mediaSafe=s=>(s||"").trim().replace(/[\/:*?"<>|]+/g,"-").replace(/\s+/g," ").slice(0,60);
const folderOf=(name,hid)=>{ const b=mediaSafe(name)||"Khac"; const h=(hid||"").trim(); return h?`${b.slice(0,46)} [${mediaSafe(h)}]`:b; };
const b=new URLSearchParams({client_id:process.env.GDRIVE_OAUTH_CLIENT_ID,client_secret:process.env.GDRIVE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GDRIVE_OAUTH_REFRESH,grant_type:"refresh_token"});
const tj=await(await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b})).json();
const H={Authorization:`Bearer ${tj.access_token}`};
const ls=async p=>((await(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${p}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=1000&${S}`,{headers:H})).json()).files||[]);
const fc=async(p,n)=>(await ls(p)).find(f=>f.name===n&&f.mimeType===F);
const rename=async(id,name)=>{ if(!GO) return; await fetch(`https://www.googleapis.com/drive/v3/files/${id}?${S}&fields=id`,{method:"PATCH",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({name})}); };

let ep=ROOT; for(const s of["DATABASE","ePMP"]) ep=(await fc(ep,s)).id;
const media=(await fc(ep,"Media")).id;
const have=(await ls(media)).filter(f=>f.mimeType===F);
console.log(GO?"=== ĐỔI TÊN THẬT ===":"=== DRY (thêm --go để làm thật) ===");
let done=0, skip=0, miss=[];
for(const f of have){
  if(/\[[^\]]+\]$/.test(f.name)){ skip++; continue; }                 // đã neo ID rồi
  const hit=MAP.find(m=>mediaSafe(m.name)===f.name || mediaSafe(m.name).slice(0,60)===f.name);
  if(!hit?.hid){ miss.push(f.name); continue; }
  const to=folderOf(hit.name, hit.hid);
  if(to===f.name){ skip++; continue; }
  console.log(`  "${f.name}"\n      → "${to}"`);
  await rename(f.id, to); done++;
}
if(miss.length){ console.log(`\n⚠ ${miss.length} folder KHÔNG có ID cứng trong map (giữ nguyên, app tự lùi về tên trần):`);
  for(const m of miss) console.log(`    - ${m}`); }
console.log(`\nĐổi tên ${done} · bỏ qua ${skip} · thiếu ID ${miss.length}.`);
console.log(GO?"✅ Xong.":"→ thêm --go để làm thật.");
