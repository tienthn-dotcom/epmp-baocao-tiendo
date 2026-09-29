/**
 * TRỢ LÝ ePMP — KHO KIẾN THỨC VỀ TÍNH NĂNG.
 *
 * Mỗi mục là một câu hỏi người ta hay hỏi về CÁCH DÙNG app, kèm câu trả lời viết sẵn và nút đưa
 * tới đúng chỗ. Trợ lý dò theo từ khoá đã bỏ dấu.
 *
 * VÌ SAO VIẾT TAY: câu trả lời về cách dùng phải ĐÚNG TỚI TỪNG CHỮ — cú pháp ghi vướng mắc sai
 * một chữ là dự án rớt khỏi bộ lọc. Viết sẵn thì sửa luật ở đâu, sửa câu trả lời ở đó.
 *
 * NGƯỜI SỬA SAU: đổi luật trong app thì sửa mục tương ứng ở đây. Mục nói sai còn tệ hơn không có.
 */
import type { CauTraLoi, Khoi } from "./kieu";

const chu = (...c: string[]): Khoi[] => c.map((x) => ({ loai: "chu" as const, chu: x }));

export type MucKienThuc = {
  id: string;
  /** Dò theo từ khoá ĐÃ BỎ DẤU, chữ thường. Một cụm khớp là đủ. */
  tuKhoa: string[];
  /** Phải có thêm ít nhất một chữ trong nhóm này (để từ khoá rộng không nuốt mọi câu). */
  buoc?: string[];
  tra: CauTraLoi;
};

export const KIEN_THUC: MucKienThuc[] = [
  {
    id: "cu-phap-mp",
    tuKhoa: ["cu phap", "ghi the nao", "viet the nao", "ghi sao", "cach ghi"],
    tra: {
      tieuDe: "Cú pháp ghi “cần trình BOD phê duyệt” trên ô Vướng mắc cấp dự án",
      khoi: [
        ...chu(
          "Ba chữ bắt buộc, phải nằm TRONG CÙNG MỘT CÂU: **trình** + **duyệt** + **bitrix**. Thứ tự không quan trọng, có dấu hay không dấu đều được. Chữ “BOD” nên có cho rõ nhưng không bắt buộc.",
          "Hai mẫu nên dùng:\n· PMO: Dự án mới cần PM lập master plan & trình BOD phê duyệt bitrix trước 22/09\n· PMO: Tiến độ dời từ 30/06 đến 30/11, cần PM trình BOD phê duyệt bitrix trước 22/09",
          "**Ghi hạn:** ngày phải nằm trong chính câu đó và có chữ dẫn đứng trước — trước · trước ngày · hạn · hạn chót · chậm nhất · deadline · mốc · trong ngày — hoặc viết ngay sau chữ bitrix.",
        ),
        { loai: "nhac", mau: "vang", chu: "Ngày đứng sau từ / đến / tới / sang / qua KHÔNG được tính là hạn — đó là cụm dời tiến độ. Ngày trơ trọi không chữ dẫn cũng bỏ, app không đoán." },
        ...chu("**Không vào bộ lọc:** câu nói việc đã xong (“BOD đã phê duyệt bitrix”), câu “không cần trình”, và “trình duyệt mẫu trên bitrix” (đó là khâu Duyệt mẫu)."),
      ],
      hanhDong: [{ nhan: "Xem dự án đang cần trình", lenh: { kieu: "loc-mp" } }],
      goiY: ["Vì sao dự án của tôi không vào bộ lọc MP?"],
      nguon: "luật trong lib/mp-deadline.ts",
    },
  },
  {
    id: "loc-binh-luan",
    tuKhoa: ["loc binh luan", "loc cmt", "loc comment", "nhom doi tuong"],
    tra: {
      tieuDe: "Bộ lọc bình luận theo nhóm đối tượng",
      khoi: chu(
        "Ô lọc tên **Bình luận** nằm cạnh các ô lọc khác (PM, PES, Chủ đầu tư, Vùng). Mở ra có bốn nhóm kèm số bình luận đang có: BOD · OCC · PM · Khác.",
        "Chọn nhóm nào thì bảng **chỉ còn những dòng có bình luận của nhóm đó**, và trong ô chỉ hiện bình luận của nhóm đó. Ô nào có bình luận nhưng bị lọc giấu hết thì ghi “— đã lọc”.",
        "Nhóm lấy theo bảng phân cấp: ai chưa được gán vai thì vào nhóm Khác. Câu lấy từ file nguồn tính là của OCC. Nhóm chưa có bình luận nào thì để mờ, bấm không được.",
      ),
      goiY: ["Cách gán vai cho người dùng"],
    },
  },
  {
    id: "sap-xep",
    tuKhoa: ["sap xep", "sort", "sap theo cot", "thu tu bang"],
    tra: {
      tieuDe: "Sắp xếp bảng theo cột",
      khoi: chu(
        "Cả hai bảng đều bấm tiêu đề cột để sắp xếp: lần đầu **giảm dần**, bấm nữa **tăng dần**, bấm lần ba **bỏ**.",
        "Chọn nhiều cột được — cột vừa bấm thành khoá chính, cột cũ tụt xuống khoá phụ, giữ tối đa 3. Số nhỏ cạnh mũi tên cho biết thứ tự khoá.",
        "Hai bảng có **chuỗi sắp xếp riêng**, không kéo nhau. Lựa chọn nhớ theo từng máy. Ô trống luôn nằm cuối ở cả hai chiều.",
      ),
      hanhDong: [{ nhan: "Mở bảng Tổng thể tiến độ", lenh: { kieu: "mo-man", man: "tong-the" } }],
    },
  },
  {
    id: "xuat-file",
    tuKhoa: ["xuat pdf", "xuat excel", "in bao cao", "export", "tai file"],
    tra: {
      tieuDe: "Xuất PDF và Excel",
      khoi: chu(
        "Nút **Xuất PDF** và **Xuất Excel** nằm trên thanh công cụ của bảng.",
        "Cả hai xuất **đúng phần đang hiện**: lọc gì, sắp xếp gì, ẩn dòng nào thì file ra y vậy.",
        "Excel là ô thật (lọc / sắp xếp / sửa được trong Excel), không phải ảnh chụp bảng. Ô Vướng mắc cấp dự án trong Excel chiếu một tin mới nhất, đúng như trên bảng.",
      ),
    },
  },
  {
    id: "vuong-mac-mot-tin",
    tuKhoa: ["vuong mac", "ghi chu cap du an", "cmt cap du an"],
    buoc: ["mot tin", "1 tin", "tin cu", "sao chi", "tai sao", "vi sao", "an di", "mat tin"],
    tra: {
      tieuDe: "Vì sao ô Vướng mắc cấp dự án chỉ hiện một tin",
      khoi: chu(
        "Ô đó chiếu **đúng một tin mới nhất**. Tin cũ không mất — bấm vào ô là hộp thoại hiện đủ, vẫn sửa / ẩn / xoá được như cũ.",
        "Tin mới nhất tính theo mốc thời gian. Câu của file nguồn và câu gõ trong app so chung một thước; cùng một ngày thì câu gõ trong app tính là mới hơn. Ô nào có tin thiếu mốc thời gian thì chiếu hết, không đoán.",
        "Câu lấy từ file nguồn **không sửa được trong app** — muốn đổi thì đổi trong file PMP.",
      ),
    },
  },
  {
    id: "ngay-cap-nhat",
    tuKhoa: ["ngay update", "ngay cap nhat", "cot ngay"],
    tra: {
      tieuDe: "Cột “Ngày update”",
      khoi: chu(
        "Là ngày ghi trong **cột Ngày update của file PMP**, do người phụ trách tự điền — không phải ngày app tải dữ liệu.",
        "Dòng nào có gắn link báo cáo thì cột này hiện ngày của chính file trong link.",
        "Muốn biết dữ liệu app tải lúc nào thì xem chữ “Dữ liệu tính đến” trên đầu trang.",
      ),
    },
  },
  {
    id: "an-dong",
    tuKhoa: ["an dong", "bo an", "dong da an", "hien tat ca dau viec", "viec da xong"],
    tra: {
      tieuDe: "Ẩn dòng và hiện việc đã xong",
      khoi: chu(
        "**Hiện tất cả đầu việc**: nút trên thanh công cụ, bật thì bảng có cả việc đã xong 100%. Mặc định BẬT, nhớ theo từng máy.",
        "**Ẩn dòng thủ công** (admin và OCC): rê chuột vào dòng rồi bấm nút ẩn. Muốn xem lại thì bấm “Dòng đã ẩn (n)” để soi và bỏ ẩn.",
      ),
    },
  },
  {
    id: "phan-cap",
    tuKhoa: ["phan cap", "gan vai", "quyen han", "role", "badge"],
    tra: {
      tieuDe: "Phân cấp người dùng",
      khoi: chu(
        "Ba cấp: **BOD** (Ban lãnh đạo) · **OCC** (Phòng Điều hành Trung tâm) · **PM** (quản lý dự án). Admin gán trong menu Hệ thống.",
        "Cấp quyết định badge màu trước tên trong box chat, và quyết định ai sửa / ẩn / xoá được bình luận của người khác (admin và OCC được).",
        "Ai chưa được gán thì không có badge và vào nhóm “Khác” khi lọc bình luận.",
      ),
    },
  },
  {
    id: "mtld-ttbg",
    tuKhoa: ["mtld", "ttbg", "ma tran lap dat", "bao cao ban giao", "bieu do tien do", "tclđ", "tcld"],
    tra: {
      tieuDe: "Màn MTLĐ và báo cáo lắp đặt / bàn giao",
      khoi: chu(
        "Màn **MTLĐ** nằm trong danh sách ứng dụng bên trái, chỉ admin và OCC thấy. Nó bày popup lắp đặt của các dự án đã gắn link.",
        "Báo cáo chuẩn của nhà mình đặt tên theo cặp: **nA. Data …** là chỗ nhập tay, **nB. Báo cáo …** chỉ chứa công thức. Ví dụ “1B. Báo cáo TCLĐ Phòng”, “2B. Báo cáo TTBG Phòng”.",
        "Gắn link cho một dự án: bấm “Gắn link” ở cột Mã CT trong bảng (admin và OCC).",
      ),
      hanhDong: [{ nhan: "Mở màn MTLĐ", lenh: { kieu: "mo-man", man: "mtld" } }],
      goiY: ["Dự án nào chưa gắn báo cáo?"],
    },
  },
  {
    id: "canh-bao",
    tuKhoa: ["tieu chi canh bao", "cach cham canh bao", "the nao la tre", "the nao la can cat"],
    tra: {
      tieuDe: "Ba nhóm cảnh báo",
      khoi: chu(
        "**Trễ tiến độ** — hạng mục đã qua ngày kết thúc mà chưa xong.",
        "**Cần cắt đầu việc** — khối lượng còn lại quá lớn so với thời gian còn lại.",
        "**Cần tập trung** — chưa trễ nhưng đang đuối, không tăng tốc thì trễ.",
        "Bấm thẳng vào thẻ số ở đầu trang là lọc bảng theo nhóm đó. Chi tiết cách chấm nằm ở nút “Tiêu chí cảnh báo”.",
      ),
      hanhDong: [{ nhan: "Xem dự án đang trễ", lenh: { kieu: "loc-tre" } }],
    },
  },
  {
    id: "toi-lam-duoc-gi",
    tuKhoa: ["ban lam duoc gi", "giup gi", "biet gi", "huong dan", "help", "tro ly lam gi", "ban la ai"],
    tra: {
      tieuDe: "Tôi giúp được gì",
      khoi: chu(
        "**Số liệu** — tổng quan, dự án nào trễ, bàn giao tháng nào, dự án của một PM, tra một dự án theo mã CT hay tên.",
        "**Master plan** — dự án nào cần trình BOD, hạn bao giờ, quá hạn mấy tuần.",
        "**Cách dùng app** — cú pháp ghi vướng mắc, bộ lọc, sắp xếp, xuất file, phân cấp, ẩn dòng, màn MTLĐ.",
        "Tôi đọc đúng con số app đang bày, không tự tính lại, và luôn nói số lấy từ đâu. Hỏi gì tôi không chắc thì tôi nói thẳng là chưa biết chứ không đoán.",
      ),
      goiY: ["Tổng quan hôm nay", "Dự án nào đang trễ?", "Dự án nào cần trình BOD?"],
    },
  },
];
