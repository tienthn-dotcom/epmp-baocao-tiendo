/**
 * BẢN CHỤP BẢNG TRACKING VẬN HÀNH MA TRẬN — ngày 16/10/2026 (tuần 41).
 *
 * Nguồn: sheet "TRACKING TIẾN ĐỘ VẬN HÀNH MA TRẬN TCLĐ" · tab "Tracking Tuần", do PMO chấm tay.
 * Anh Tiến gửi bản in ngày 16/10/2026 để app dán nhãn vận hành lên báo cáo BOD.
 *
 * ── TẠI SAO CHÉP VÀO ĐÂY MÀ KHÔNG ĐỌC THẲNG SHEET ──────────────────────────────────────────
 * Chưa có link sheet để app tự đọc. Chép vào đây thì báo cáo chạy đúng NGAY HÔM NAY, còn khi có
 * link thì chỉ việc gọi `docTracking()` với nội dung tải về — CÙNG MỘT HÀM ĐỌC, không phải viết
 * lại gì. Đây là bản chụp, KHÔNG phải nguồn sự thật.
 *
 * ── CẬP NHẬT HÀNG TUẦN ─────────────────────────────────────────────────────────────────────
 * Mở sheet → bôi đen vùng dữ liệu (bỏ dòng tiêu đề và dòng nhóm vùng cũng được, hàm đọc tự lọc)
 * → Ctrl+C → dán đè vào chuỗi dưới đây → đổi `NGAY_CHUP`. Cột phải đúng thứ tự của sheet:
 *
 *     STT · Tên PM · Tên dự án · Khu vực · Trạng thái · Ghi chú
 *
 * Đếm trên bản này: 83 dự án — 41 đã vận hành · 16 chưa vận hành · 5 chưa triển khai ·
 * 12 chưa cần triển khai · 9 không cần triển khai. Bộ kiểm tra khoá đúng mấy con số đó, nên dán
 * nhầm cột hay thiếu dòng là test đỏ ngay chứ không lọt ra bản gửi BOD.
 */

/** Ngày của bản chụp — in lên bìa báo cáo để người đọc biết nhãn lấy từ lúc nào. */
export const NGAY_CHUP = "16/10/2026";

export const TRACKING_TSV = `
1	Nguyễn Văn Có	Apec S2 Public	Phú Quốc	Đã vận hành
2	Nguyễn Văn Có	Apec S3 Public	Phú Quốc	Đã vận hành
3	Lê Tuấn	Apec S4 Phòng	Phú Quốc	Đã vận hành
4	Lê Tuấn	APEC_S4_MUR Marriott (Phòng mẫu tại site)	Phú Quốc	Không cần triển khai
5	Lê Tuấn	APEC_S4 Vách modular đại trà	Phú Quốc	Không cần triển khai
6	Lê Tuấn	Park Hyatt Phú Quốc Hotel	Phú Quốc	Không cần triển khai
7	Lê Tuấn	Park Hyatt Phú Quốc Village Center	Phú Quốc	Không cần triển khai
8	Trần Quốc Lý	Mini Hotel B6-B9 Public	Phú Quốc	Chưa vận hành
9	Trần Quốc Lý	Mini Hotel B6-B9 Phòng	Phú Quốc	Chưa vận hành
10	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Phòng (302 căn)	Phú Quốc	Đã vận hành
11	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Public: Nhà hàng Maxine	Phú Quốc	Đã vận hành
12	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Executive Lounge (Tháp A-L6)	Phú Quốc	Đã vận hành
13	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Golden Hour (Tháp E-L14)	Phú Quốc	Đã vận hành
14	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Sun Kraft (Tháp C-L1)	Phú Quốc	Đã vận hành
15	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Terra Mare (Tháp B)	Phú Quốc	Đã vận hành
16	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu The Market (Tháp A)	Phú Quốc	Đã vận hành
17	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu The Sole (Tháp E-L11)	Phú Quốc	Đã vận hành
18	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Tocha (Tháp E-L10)	Phú Quốc	Đã vận hành
19	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Basement Lobby	Phú Quốc	Đã vận hành
20	Đặng Ngọc Sáu	Nam Phương Hoàng Hậu Vietnamese Nam Phương (Tháp B-L6)	Phú Quốc	Đã vận hành
21	Đặng Ngọc Sáu	Trục Đông Tây 2C_Public (8 block) [SPMD]	Phú Quốc	Chưa vận hành
22	Đặng Ngọc Sáu	Trục Đông Tây 2C_Phòng (F12 & F18)	Phú Quốc	Chưa vận hành
23	Đặng Ngọc Sáu	Trục Đông Tây 2C_Phòng (6 blocks)	Phú Quốc	Chưa vận hành
24	Trịnh Nguyễn Xuân Hiển	Sunset Town High Rise_B4.7 [SPMD]	Phú Quốc	Chưa vận hành	VẬN HÀNH FILE THI CÔNG KHÁC
25	Trịnh Nguyễn Xuân Hiển	Sunset Town High Rise_B4.6	Phú Quốc	Chưa cần triển khai
26	Nguyễn Việt Dũng	Sun Tropical Village PQ 98 căn Villas	Phú Quốc	Đã vận hành
27	Nguyễn Việt Dũng	APEC_S4_Khách sạn Marriott Public khối đế	Phú Quốc	Chưa vận hành
28	Trần Viết Nghị	Chairman Villa Phú Quốc	Phú Quốc	Chưa cần triển khai
29	Trần Ngọc Phúc	APEC S6_M-Gallery MUR	Phú Quốc	Chưa vận hành
30	Trần Ngọc Phúc	APEC S6_SO_MUR	Phú Quốc	Chưa vận hành
31	Nguyễn Hoài Vũ	Mini Hotel PQ (B1-B5) Phòng	Phú Quốc	Đã vận hành
32	Trần Quốc Liêm	43 ĐTM_St.Regis_Public	Miền Bắc	Chưa vận hành	KHÔNG CÓ HÀNG THI CÔNG
33	Trần Quốc Liêm	Dự Án Số 1 VIP	Miền Bắc	Chưa vận hành	KHÔNG CÓ HÀNG THI CÔNG
34	Trần Quốc Liêm	43 ĐTM_Marriott_Phòng	Miền Bắc	Chưa cần triển khai
35	Trần Quốc Liêm	43 ĐTM_Marriott_Public	Miền Bắc	Chưa cần triển khai
36	Trần Quốc Liêm	43 ĐTM_St.Regis_Phòng	Miền Bắc	Chưa vận hành
37	Trần Quốc Liêm	43 ĐTM_Villa Blue	Miền Bắc	Chưa cần triển khai
38	Trần Quốc Liêm	43 ĐTM_Villa Rose	Miền Bắc	Chưa cần triển khai
39	Trần Quốc Liêm	Cải tạo nâng cấp Phủ Chủ Tịch	Miền Bắc	Chưa cần triển khai
40	Trần Giang Nam	Cát Bà tòa HH3	Miền Bắc	Đã vận hành
41	Trần Giang Nam	Tàu khách Emerald Raiya - EW04	Miền Bắc	Chưa cần triển khai
42	Trần Giang Nam	Tàu khách Emerald Xara - EW05	Miền Bắc	Chưa cần triển khai
43	Trương Thanh Long	Hyatt Regency Hạ Long	Miền Bắc	Đã vận hành
44	Nguyễn Ngọc Sơn	Tulip Villa. Vinhomes Riverside Hà Nội	Miền Bắc	Đã vận hành
45	Nguyễn Văn Cừ	THV_Căn hộ 2B-L09	Miền Bắc	Đã vận hành
46	Nguyễn Văn Cừ	THV_Nhà hàng Italia [SPMD]	Miền Bắc	Đã vận hành
47	Nguyễn Văn Cừ	THV_Nhà hàng Tây Ban Nha [SPMD]	Miền Bắc	Đã vận hành
48	Nguyễn Văn Cừ	THV_Penthouse T3D - Nhà chị Hương	Miền Bắc	Đã vận hành
49	Nguyễn Văn Cừ	THV_Căn hộ 2B-L06	Miền Bắc	Đã vận hành
50	Nguyễn Văn Cừ	Tây Hồ View - Public (Tháp 4S)	Miền Bắc	Đã vận hành
51	Nguyễn Văn Cừ	THV_3A_Penthouse	Miền Bắc	Đã vận hành
52	Nguyễn Văn Cừ	THV_Villa A2	Miền Bắc	Đã vận hành
53	Nguyễn Văn Cừ	Tây Hồ View - Tháp 4A	Miền Bắc	Đã vận hành
54	Nguyễn Văn Cừ	Tây Hồ View - Tháp 4B	Miền Bắc	Đã vận hành
55	Nguyễn Văn Cừ	THV_Sky Villa tháp 4B	Miền Bắc	Đã vận hành
56	Nguyễn Văn Cừ	THV_Căn hộ 2B-L11	Miền Bắc	Đã vận hành
57	Nguyễn Văn Cừ	THV_Căn hộ 3A-L09,10	Miền Bắc	Đã vận hành
58	Nguyễn Văn Cừ	THV_NH Maison Eric Kayser & NH Việt	Miền Bắc	Đã vận hành
59	Nguyễn Văn Cừ	THV_Penthouse 2A	Miền Bắc	Đã vận hành
60	Nguyễn Văn Cừ	THV_Penthouse Mr. Hưng (3A-L13-14)	Miền Bắc	Đã vận hành
61	Đặng Chí Linh	Tiến Bộ Plaza_Căn hộ khách sạn	Miền Bắc	Đã vận hành
62	Đặng Chí Linh	Tiến Bộ Plaza_BP12_Public	Miền Bắc	Chưa vận hành
63	Đỗ Ngọc Hoàn	Nhà hát Ngọc Trai	Miền Bắc	Không cần triển khai
64	Nguyễn Văn Có	Khu du lịch ven sông Hàn (B4.2)	Miền Trung	Đã vận hành
65	Võ Minh Vương	Khối tháp 2 Holiday Inn Bà Nà Phòng (846 PHÒNG)	Miền Trung	Đã vận hành
66	Võ Minh Vương	Khối tháp 2 Holiday Inn Bà Nà Khu Public	Miền Trung	Đã vận hành
67	Đặng Quốc Tuấn	Khu căn hộ phía Đông Trần Hưng Đạo (Madam)_Tháp A	Miền Trung	Chưa cần triển khai
68	Đặng Quốc Tuấn	Khu căn hộ phía Đông Trần Hưng Đạo (Madam)_Tháp B	Miền Trung	Chưa triển khai
69	Đặng Quốc Tuấn	Nhà Hàng La Maison - Intercontinental Đà Nẵng	Miền Trung	Chưa cần triển khai
70	Đặng Quốc Tuấn	Olalani Penthouse_Tháp B1.02 [SPMD]	Miền Trung	Chưa triển khai
71	Đặng Quốc Tuấn	Olalani Penthouse_Tháp B1.03 [SPMD]	Miền Trung	Chưa triển khai
72	Nguyễn Tấn Kiệt	Villa Tulip 3	Miền Nam	Chưa vận hành
73	Nguyễn Tấn Kiệt	Đại học Văn Lang	Miền Nam	Chưa cần triển khai
74	Nguyễn Tấn Kiệt	Văn phòng công ty Cao Trần	Miền Nam	Không cần triển khai
75	Nguyễn Hoàng Trường	Hyatt Regency Hồ Tràm Khu Public	Miền Nam	Đã vận hành
76	Nguyễn Hoàng Trường	Hyatt Regency Hồ Tràm 61 Villas	Miền Nam	Chưa vận hành	PENDING DO CĐT
77	Nguyễn Hoàng Trường	The Indochine By Melia (Hồ Tràm)	Miền Nam	Chưa triển khai
78	Bành Vĩ Long	Chateau De Saigon	Miền Nam	Chưa vận hành
79	Phạm Xuân Hoành	Hotel Des Arts Sài Gòn	Miền Nam	Không cần triển khai
80	Phạm Xuân Hoành	Villa Bason V60	Miền Nam	Chưa triển khai
81	Vũ Ngọc Pháp	New Wing Extension	Nước Ngoài	Đã vận hành
82	Vũ Ngọc Pháp	Nhà mẫu Borey Chulassa (Campuchia)	Nước Ngoài	Không cần triển khai
83	Nguyễn Đăng Khoa	Nhà mẫu Taipei City W.Gateway-16F-A Area	Nước Ngoài	Không cần triển khai
`;
