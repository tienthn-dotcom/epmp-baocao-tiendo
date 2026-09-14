import { it, expect } from "vitest";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { parseXlsxBuffer } from "@/lib/parser";
import { projectKeyOf } from "@/lib/filter";
import { ridKeys } from "@/lib/rid";
import { timNoteLac } from "@/lib/note-lac";
const S = process.env.SCRATCH!;
const OUT = S + "/lac.txt"; writeFileSync(OUT, "");
const LOG = (...a: unknown[]) => appendFileSync(OUT, a.join(" ") + "\n");

const itemKeyOf = (x: any) =>
  ridKeys(x.rid)[0] ? ridKeys(x.rid)[0]
  : x.projHid && x.projHid.trim() ? `h:${x.projHid.trim()}:${(x.rawCode || "").toUpperCase()}:${x.dupIdx ?? 0}`
  : x.id && x.id.trim() ? `id:${x.id.trim()}`
  : [x.projectCode, x.projectName, x.rawCode, x.dupIdx ?? 0].join(String.fromCharCode(0));
const normDesc = (s?: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

it("ghi chu mat dia chi", async () => {
  const buf = readFileSync(S + "/nguon.xlsx");
  const data = await parseXlsxBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "2026-09-14");
  const edits = JSON.parse(readFileSync(S + "/e-now.json", "utf8")) as Record<string, any>;
  const neo = JSON.parse(readFileSync(S + "/a-now.json", "utf8")) as Record<string, string>;

  const nay: Record<string, string> = {};
  for (const p of data.projects as any[]) {
    nay[projectKeyOf(p.code, p.name, p.id, p.hid)] = `${(p.code || "").trim()}||${(p.name || "").trim()}||__DUAN__`;
    for (const x of (p.allItems ?? p.items ?? [])) {
      nay[itemKeyOf(x)] = `${(x.maCT || x.projectCode || "").trim()}||${(x.projectName || "").trim()}||${(x.stage || x.rawCode || "").trim()}||${normDesc(x.desc)}`;
    }
  }
  const txt = (m?: any[]) => (m ?? []).filter((y) => !y.hidden).map((y) => y.text).join("\n");
  const coChu = (k: string) => { const e = edits[k]; return !!e && !!(txt(e.noteMsgs) || txt(e.actionMsgs)); };
  const trichDoan = (k: string) => { const e = edits[k]; return (txt(e?.noteMsgs) || txt(e?.actionMsgs) || "").replace(/\s+/g, " ").trim().slice(0, 90); };

  const lac = timNoteLac({ edits, coChu, trichDoan, neo, nay });
  const veDuoc = lac.filter((x) => x.dich);
  const chiu = lac.filter((x) => !x.dich);
  LOG("dong trong nguon:", Object.keys(nay).length, "| note co chu:", Object.keys(edits).filter(coChu).length);
  LOG("GHI CHU MAT DIA CHI:", lac.length);
  LOG("  -> dua ve duoc   :", veDuoc.length, "(trong do", veDuoc.filter((x) => x.canGop).length, "phai gop them)");
  LOG("  -> chua duoc      :", chiu.length);
  const vi: Record<string, number> = {};
  for (const x of chiu) vi[x.vuong] = (vi[x.vuong] ?? 0) + 1;
  for (const [k, v] of Object.entries(vi).sort((a, b) => b[1] - a[1])) LOG(`       ${String(v).padStart(3)}  ${k}`);
  LOG("");
  LOG("== DUA VE DUOC ==");
  for (const x of veDuoc) LOG(`  ${x.key.replace(/\u0000/g, " ~ ").slice(0, 26).padEnd(27)} -> ${x.dich!.slice(0, 24).padEnd(25)} ${x.canGop ? "[gop]" : "     "} ${x.danhTinh.split("||").slice(0, 3).join(" · ").slice(0, 60)}`);
  expect(true).toBe(true);
}, 180000);
