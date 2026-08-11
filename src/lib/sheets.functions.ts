import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Server-side fetch of a Google Sheet as CSV.
 *
 * Accepts ANY of the common Google Sheets URL shapes and normalises to the
 * `/export?format=csv&gid=...` endpoint, which works as long as the sheet is
 * shared with "Anyone with the link" (Viewer) — no need to "Publish to web".
 *
 *  - https://docs.google.com/spreadsheets/d/<ID>/edit#gid=123
 *  - https://docs.google.com/spreadsheets/d/<ID>/edit?gid=123
 *  - https://docs.google.com/spreadsheets/d/<ID>/edit?usp=sharing
 *  - https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pub?gid=123&output=csv  (Publish-to-web)
 *  - https://docs.google.com/spreadsheets/d/e/<PUB_ID>/pubhtml?gid=123
 *  - https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&gid=123
 */
export const fetchSheetCsv = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ url: z.string().url().max(2000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const raw = data.url.trim();
    if (!/docs\.google\.com\/spreadsheets/.test(raw)) {
      throw new Error(
        "Link không hợp lệ. Hãy dán URL bắt đầu bằng https://docs.google.com/spreadsheets/...",
      );
    }

    const candidates = buildSheetUrlCandidates(raw);

    let res: Response | null = null;
    let target = candidates[0];
    let lastStatus = 0;
    for (const url of candidates) {
      try {
        // Bust caches: append timestamp + send no-store + Pragma/Cache-Control.
        const bust = url + (url.includes("?") ? "&" : "?") + "_ts=" + Date.now();
        const r = await fetch(bust, {
          redirect: "follow",
          cache: "no-store",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; LovableDashboard/1.0; +https://lovable.dev)",
            Accept: "text/csv,text/plain,*/*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });

        lastStatus = r.status;
        if (r.ok) {
          res = r;
          target = url;
          break;
        }
        // 400 thường do gid sai / endpoint không phù hợp → thử URL kế tiếp.
        if (r.status !== 400 && r.status !== 404) {
          res = r;
          target = url;
          break;
        }
      } catch (err) {
        throw new Error(
          `Không kết nối được tới Google (${(err as Error).message}). Kiểm tra lại link hoặc kết nối mạng.`,
        );
      }
    }

    if (!res) {
      throw new Error(
        `Không tải được Google Sheet (HTTP ${lastStatus}). Kiểm tra lại link gid (tab) hoặc quyền chia sẻ "Anyone with the link".`,
      );
    }

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          `Google Sheet đang ở chế độ riêng tư (HTTP ${res.status}). Mở sheet → nút "Share" → đổi "Restricted" thành "Anyone with the link" (Viewer), rồi dán lại link.`,
        );
      }
      if (res.status === 404) {
        throw new Error(
          `Không tìm thấy sheet (HTTP 404). Link đã bị xoá, sai ID hoặc gid không tồn tại.`,
        );
      }
      throw new Error(
        `Không tải được Google Sheet (HTTP ${res.status}). Thử bỏ phần #gid=... ở cuối link, hoặc kiểm tra quyền chia sẻ.`,
      );
    }

    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "";

    // Google trả HTML khi sheet không cho phép truy cập công khai
    // (trang đăng nhập / "You need access" / "Sign in").
    const looksHtml =
      contentType.includes("text/html") ||
      /^\s*<!DOCTYPE html|<html/i.test(text.slice(0, 200));

    if (looksHtml) {
      throw new Error(
        [
          "Google trả về trang HTML thay vì CSV — nghĩa là sheet chưa cho phép truy cập công khai.",
          "Cách sửa:",
          '  1. Mở Google Sheet → bấm nút "Share" (Chia sẻ).',
          '  2. Mục "General access" đổi từ "Restricted" → "Anyone with the link", quyền "Viewer".',
          "  3. Copy lại đúng link và dán vào đây.",
          "Hoặc dùng File → Share → Publish to web → CSV (sheet Timeline) rồi dán link đó.",
        ].join("\n"),
      );
    }

    if (!text.trim()) {
      throw new Error("Sheet trả về CSV rỗng. Kiểm tra lại gid (đúng tab Timeline chưa?).");
    }

    return { text, fetchedAt: new Date().toISOString(), resolvedUrl: target };
  });

/**
 * Tải Google Sheet dưới dạng FILE XLSX (toàn bộ workbook) — đường nhập chuẩn.
 *
 * Lý do tồn tại: đường CSV có nhiều quirk (Publish-to-web cache bản cũ ~5 phút,
 * endpoint gviz tự đoán header/nuốt dòng, ngày bị format lại theo locale) →
 * cùng một dữ liệu nhưng CSV ra kết quả LỆCH so với upload file Excel.
 * Tải thẳng .xlsx rồi parse bằng ĐÚNG parseXlsxBuffer của nhánh upload
 * ⇒ hai đường import là MỘT, kết quả bắt buộc giống nhau.
 *
 * Trả về base64 của file xlsx; client tự decode và parse.
 */
export const fetchSheetXlsx = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z.object({ url: z.string().url().max(2000) }).parse(input),
  )
  .handler(async ({ data }) => {
    const raw = data.url.trim();
    if (!/docs\.google\.com\/spreadsheets/.test(raw)) {
      throw new Error(
        "Link không hợp lệ. Hãy dán URL bắt đầu bằng https://docs.google.com/spreadsheets/...",
      );
    }

    const candidates = buildXlsxUrlCandidates(raw);
    let lastErr = "";
    for (const url of candidates) {
      const bust = url + (url.includes("?") ? "&" : "?") + "_ts=" + Date.now();
      let r: Response;
      try {
        r = await fetch(bust, {
          redirect: "follow",
          cache: "no-store",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; LovableDashboard/1.0; +https://lovable.dev)",
            Accept:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            Pragma: "no-cache",
          },
        });
      } catch (err) {
        throw new Error(
          `Không kết nối được tới Google (${(err as Error).message}). Kiểm tra lại link hoặc kết nối mạng.`,
        );
      }
      if (!r.ok) {
        lastErr = `HTTP ${r.status}`;
        if (r.status === 401 || r.status === 403) {
          lastErr =
            `Google Sheet đang ở chế độ riêng tư (HTTP ${r.status}). Mở sheet → "Share" → đổi "Restricted" thành "Anyone with the link" (Viewer).`;
        }
        continue; // thử candidate kế
      }
      const ab = await r.arrayBuffer();
      const bytes = new Uint8Array(ab);
      // File xlsx là ZIP — magic bytes "PK". Nếu không phải → Google trả HTML
      // (trang đăng nhập / báo không có quyền).
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
        lastErr =
          'Google trả về trang HTML thay vì file Excel — sheet chưa cho phép truy cập công khai. Mở sheet → "Share" → "Anyone with the link" (Viewer).';
        continue;
      }
      // base64-encode theo chunk để không tràn call stack với file lớn.
      let binary = "";
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
      }
      return {
        base64: btoa(binary),
        fetchedAt: new Date().toISOString(),
        resolvedUrl: url,
      };
    }
    throw new Error(
      lastErr ||
        "Không tải được Google Sheet dạng Excel. Kiểm tra lại link và quyền chia sẻ.",
    );
  });

/** Ứng viên URL tải xlsx: link thường → /export?format=xlsx (dữ liệu LIVE);
 *  link Publish-to-web (/d/e/) → /pub?output=xlsx (snapshot, có thể trễ ~5'). */
function buildXlsxUrlCandidates(raw: string): string[] {
  const pubMatch = raw.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/);
  if (pubMatch) {
    return [`https://docs.google.com/spreadsheets/d/e/${pubMatch[1]}/pub?output=xlsx`];
  }
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) throw new Error("Không trích xuất được Spreadsheet ID từ link.");
  return [`https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=xlsx`];
}

/* ------------------------------------------------------------------ */
/* URL normalisation                                                   */
/* ------------------------------------------------------------------ */

/** Tên tab Timeline cần thử khi link không có gid rõ ràng. */
const TIMELINE_SHEET_NAMES = ["Timeline", "TIMELINE", "timeline"];

function buildSheetUrlCandidates(raw: string): string[] {
  // Already a CSV-yielding URL — keep as-is.
  if (/output=csv/i.test(raw) || /[?&]format=csv/i.test(raw) || /tqx=out:csv/i.test(raw)) {
    return [raw];
  }

  const idMatch =
    raw.match(/\/spreadsheets\/d\/e\/([a-zA-Z0-9-_]+)/) ||
    raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    throw new Error("Không trích xuất được Spreadsheet ID từ link.");
  }
  const isPublished = /\/spreadsheets\/d\/e\//.test(raw);
  const id = idMatch[1];

  const gidMatch = raw.match(/[#?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : null;

  if (isPublished) {
    const base = `https://docs.google.com/spreadsheets/d/e/${id}/pub`;
    const withGid = gid
      ? [`${base}?gid=${gid}&single=true&output=csv`]
      : [];
    return [...withGid, `${base}?output=csv`];
  }

  const exportBase = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  const gvizBase = `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv`;
  const list: string[] = [];
  if (gid) {
    // Link đã chỉ rõ tab → dùng đúng gid đó, KHÔNG fallback sang tab khác.
    list.push(`${exportBase}&gid=${gid}`);
    list.push(`${gvizBase}&gid=${gid}`);
    return list;
  }
  // Không có gid → KHÔNG mặc định lấy tab đầu tiên. Thử đúng tab "Timeline" theo TÊN.
  for (const name of TIMELINE_SHEET_NAMES) {
    list.push(`${gvizBase}&sheet=${encodeURIComponent(name)}`);
    list.push(`${exportBase}&sheet=${encodeURIComponent(name)}`);
  }
  // Fallback cuối: tab đầu tiên (đa số file chỉ-Timeline vẫn chạy đúng).
  list.push(exportBase);
  list.push(gvizBase);
  return list;
}
