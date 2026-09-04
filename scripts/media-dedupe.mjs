/**
 * DÒ & GỘP FOLDER PHÒNG BỊ TRÙNG TÊN trong Media/<Dự án>/<Toà>/.
 * Vì sao phải sạch: app dựng đường dẫn Media/<Toà>/<phòng>/(Hình ảnh|Video) và luôn lấy folder khớp tên
 * ĐẦU TIÊN → 2 folder cùng tên phòng thì ảnh vào cái này, video vào cái kia, list đọc thiếu.
 * Gộp: giữ folder có nhiều file nhất, dời hết file của bản trùng sang, đảm bảo đủ Hình ảnh + Video,
 * rồi trash bản trùng ĐÃ RỖNG. Không bao giờ xoá file.
 *   node scripts/media-dedupe.mjs        (DRY) | --go (làm thật)
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env","utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2];}
const GO=process.argv.includes("--go");
const ONLY=process.argv.find(a=>!a.startsWith("--")&&!a.includes("node")&&!a.includes("media-dedupe"));   // để trống = QUÉT MỌI DỰ ÁN
const ROOT="1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO", S="supportsAllDrives=true&includeItemsFromAllDrives=true", F="application/vnd.google-apps.folder";
const KIND=["Hình ảnh","Video"];
const b=new URLSearchParams({client_id:process.env.GDRIVE_OAUTH_CLIENT_ID,client_secret:process.env.GDRIVE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GDRIVE_OAUTH_REFRESH,grant_type:"refresh_token"});
const tj=await(await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b})).json();
const H={Authorization:`Bearer ${tj.access_token}`};
const ls=async p=>((await(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${p}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=1000&${S}`,{headers:H})).json()).files||[]);
const fc=async(p,n)=>(await ls(p)).find(f=>f.name===n&&f.mimeType===F);
const mkdir=async(p,n)=>{const e=await fc(p,n); if(e) return e.id; if(!GO) return "(dry)";
  return (await(await fetch(`https://www.googleapis.com/drive/v3/files?${S}&fields=id`,{method:"POST",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({name:n,mimeType:F,parents:[p]})})).json()).id;};
const move=async(id,from,to)=>{ if(!GO) return; await fetch(`https://www.googleapis.com/drive/v3/files/${id}?addParents=${to}&removeParents=${from}&${S}&fields=id`,{method:"PATCH",headers:H}); };
const trash=async id=>{ if(!GO) return; await fetch(`https://www.googleapis.com/drive/v3/files/${id}?${S}`,{method:"PATCH",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({trashed:true})}); };
const nFiles=async id=>{ let n=0; for(const k of await ls(id)){ if(k.mimeType!==F) n++; else n+=await nFiles(k.id); } return n; };

let ep=ROOT; for(const s of["DATABASE","ePMP"]) ep=(await fc(ep,s)).id;
const mediaId=(await fc(ep,"Media")).id;
const projects=(await ls(mediaId)).filter(f=>f.mimeType===F && (!ONLY || f.name===ONLY));
if(!projects.length){ console.log("Không thấy dự án nào để quét."); process.exit(0); }
console.log(GO?"=== GỘP THẬT ===":"=== DRY (thêm --go để làm thật) ===", "·", ONLY||`${projects.length} dự án`);
let dup=0, moved=0, trashed=0;
for(const proj of projects){
for(const toa of await ls(proj.id)){
  if(toa.mimeType!==F || KIND.includes(toa.name)) continue;
  const byName=new Map();
  for(const room of await ls(toa.id)){ if(room.mimeType!==F) continue; (byName.get(room.name)??byName.set(room.name,[]).get(room.name)).push(room); }
  for(const [name,list] of byName){
    if(list.length<2) continue;
    dup++;
    const counts=await Promise.all(list.map(r=>nFiles(r.id)));
    const keepI=counts.indexOf(Math.max(...counts));
    const keep=list[keepI];
    console.log(`  ${proj.name} › ${toa.name}/${name}: ${list.length} folder trùng (số file: ${counts.join(" · ")}) → giữ #${keepI+1}`);
    for(let i=0;i<list.length;i++){
      if(i===keepI) continue;
      for(const kind of await ls(list[i].id)){
        if(kind.mimeType!==F){ await move(kind.id, list[i].id, keep.id); moved++; continue; }
        const dk=await mkdir(keep.id, kind.name);
        for(const f of (await ls(kind.id)).filter(x=>x.mimeType!==F)){ await move(f.id, kind.id, dk); moved++; }
      }
      const left=await nFiles(list[i].id);
      if(left===0){ console.log(`      trash bản trùng (đã rỗng)`); await trash(list[i].id); trashed++; }
      else console.log(`      ⚠ GIỮ bản trùng — còn ${left} file chưa dời được, xử tay`);
    }
    for(const k of KIND) await mkdir(keep.id, k);
  }
}
}
console.log(`\n${dup} phòng bị trùng · dời ${moved} file · trash ${trashed} folder rỗng.`);
console.log(GO?"✅ Xong.":"→ thêm --go để làm thật.");
