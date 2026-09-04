/**
 * ĐƯA BẢNG MÃ MÀU HEATMAP LÊN DRIVE: "Data Source" › Mã màu › heatmap-colors.csv
 * Từ nay đổi màu = SỬA/THAY file này trên Drive, app tự áp (không cần sửa code, không cần deploy).
 * Chạy lại script sẽ THAY bản cũ cùng tên.
 *   node scripts/upload-heatmap-colors.mjs
 */
import { readFileSync } from "node:fs";
for (const l of readFileSync(".env","utf8").split(/\r?\n/)){const m=l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m)process.env[m[1]]=m[2];}
const ROOT="1O9VktCpBENaZB1xgABr8MfIbl3YW8hFO", S="supportsAllDrives=true&includeItemsFromAllDrives=true", F="application/vnd.google-apps.folder";
const NAME="heatmap-colors.csv";
const CSV = `Mã màu,Diễn giải
#C00000,Chưa bàn giao
#D3E8FE,Đang thi công
#3B82F6,Đã giao thô
#1E3A8A,Đã giao tinh (PMU)
#AFD8C7,Đã ra list Defect (Vận hành)
#059669,Xoá list Defect (Vận hành)
#006100,Đã giao Vận Hành
#A6A6A6,Không có thi công
`;
const b=new URLSearchParams({client_id:process.env.GDRIVE_OAUTH_CLIENT_ID,client_secret:process.env.GDRIVE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GDRIVE_OAUTH_REFRESH,grant_type:"refresh_token"});
const tj=await(await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:b})).json();
const H={Authorization:`Bearer ${tj.access_token}`};
const ls=async p=>((await(await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${p}' in parents and trashed=false`)}&fields=files(id,name,mimeType)&pageSize=1000&${S}`,{headers:H})).json()).files||[]);
const folder=(await ls(ROOT)).find(f=>f.name==="Mã màu"&&f.mimeType===F);
if(!folder){ console.log('Không thấy thư mục "Mã màu" trong Data Source.'); process.exit(1); }
for(const f of await ls(folder.id)) if(f.name===NAME){
  await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?${S}`,{method:"PATCH",headers:{...H,"Content-Type":"application/json"},body:JSON.stringify({trashed:true})});
  console.log("thay bản cũ:",f.name);
}
const boundary="bnd"+Date.now();
const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`
  + JSON.stringify({name:NAME,parents:[folder.id],mimeType:"text/csv"})
  + `\r\n--${boundary}\r\nContent-Type: text/csv; charset=UTF-8\r\n\r\n${CSV}\r\n--${boundary}--`;
const r=await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name&${S}`,
  {method:"POST",headers:{...H,"Content-Type":`multipart/related; boundary=${boundary}`},body});
const j=await r.json();
console.log(j.id?`✅ Đã tạo: Data Source / Mã màu / ${j.name}`:"❌ Lỗi: "+JSON.stringify(j));
