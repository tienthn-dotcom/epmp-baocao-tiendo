/** ETL core · num — chuẩn hoá SỐ từ chuỗi thực tế (dấu ngăn nghìn/thập phân đa dạng, hệ số triệu/nghìn/tỷ, tiền tệ). */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v ?? "").trim();
  if (!s) return null;
  s = s.replace(/[₫đ]|vn[dđ]/gi, "").trim();
  let mult = 1;
  const mm = s.match(/^([\d.,\s]+)\s*(triệu|tr|ngh[ìi]n|ng[àa]n|tỷ|ty|[kmb])\.?$/i);
  if (mm) {
    s = mm[1]; const u = mm[2].toLowerCase();
    mult = /^(triệu|tr|m)$/.test(u) ? 1e6 : /^(ngh[ìi]n|ng[àa]n|k)$/.test(u) ? 1e3 : /^(tỷ|ty|b)$/.test(u) ? 1e9 : 1;
  }
  s = s.replace(/\s/g, "");
  const lc = s.lastIndexOf(","), ld = s.lastIndexOf(".");
  if (lc > -1 && ld > -1) s = lc > ld ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  else if (lc > -1) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (ld > -1) s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s;
  const n = parseFloat(s);
  return isFinite(n) ? n * mult : null;
}

/** % → số 0..100 (chấp nhận "85%", "0.85", "85"). */
export function toPercent(v: unknown): number | null {
  if (typeof v === "number") return v;
  const m = /(-?\d+(?:[.,]\d+)?)/.exec(String(v ?? ""));
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/** {value, currency} — giữ metadata đơn vị tiền (không mất thông tin). */
export function parseCurrency(v: unknown): { value: number | null; currency: string | null } {
  const raw = String(v ?? "");
  const currency = /[₫đ]|vn[dđ]/i.test(raw) ? "VND" : /\$|usd/i.test(raw) ? "USD" : null;
  return { value: toNumber(v), currency };
}
