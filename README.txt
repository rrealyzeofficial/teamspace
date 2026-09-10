TEAM SPACE — V2 SUPABASE
========================

FILE:
- index.html
- style.css
- app.js
- config.js
- supabase_team_workspace.sql

MỚI TRONG V2
------------
1. SONG FORMATION tự động:
   - DUO = 2 members
   - TRIPLE = 3 members
   - TEAM = 4–7 members
   - GROUP = toàn bộ member chính đang active (hiện tại là 8)
   - SOLO = trường hợp dự phòng khi chỉ có 1 member

2. LOGIN RIÊNG TƯ:
   - Không có Sign Up.
   - Member chỉ đăng nhập bằng email + password được người giữ web gửi.
   - Người không đăng nhập không thấy workspace.
   - RLS của Supabase chặn luôn dữ liệu ở database.

3. SUPABASE:
   - Projects dùng database chung.
   - Project Test dùng database chung.
   - Activity chung.
   - Realtime cập nhật giữa các máy.
   - My Tasks dựa vào chính tài khoản đang đăng nhập, không còn "Viewing as".

============================================================
CÀI ĐẶT SUPABASE
============================================================

BƯỚC 1
Chạy toàn bộ file:
supabase_team_workspace.sql
trong Supabase Dashboard > SQL Editor.

BƯỚC 2
Vào:
Authentication > Users

Tạo tài khoản cho từng member.
Nên tạo 8 account riêng cho:
- Shota
- Vani
- Shoto
- Mikon
- Elis
- Hikari
- Ebi
- Zanith

Người giữ web tự đặt password rồi gửi riêng cho từng người.

Web KHÔNG có chức năng tự đăng ký.

BƯỚC 3
Sau khi tạo Auth User, link account vào member tương ứng.

Ví dụ Shota:

update public.team_members tm
set auth_user_id = au.id
from auth.users au
where tm.slug = 'shota'
  and lower(au.email) = lower('EMAIL_CUA_SHOTA');

Làm tương tự cho:
vani
shoto
mikon
elis
hikari
ebi
zanith

BƯỚC 4
Chọn người giữ web / owner.

Ví dụ:
update public.team_members
set is_owner = true
where slug = 'shota';

Hiện tại owner khác member thường ở quyền chỉnh roster/account.
Projects và Project Test thì tất cả member đều có quyền chỉnh sửa.

BƯỚC 5
Mở:
config.js

Điền:

window.TEAM_SUPABASE = {
  url: "https://PROJECT.supabase.co",
  key: "PUBLISHABLE_KEY_HOAC_ANON_KEY"
};

KHÔNG BAO GIỜ cho service_role key vào file web.

BƯỚC 6
Host web bằng GitHub Pages hoặc localhost.

Nếu test localhost:
python -m http.server 8000

Sau đó:
http://localhost:8000

============================================================
LƯU Ý VỀ PRIVATE
============================================================

Biết URL web không có nghĩa là xem được data.

Database đã bật Row Level Security:
- anon: không được đọc bảng
- authenticated nhưng không nằm trong team_members: không được đọc workspace
- authenticated + linked member: được đọc/sửa Projects + Project Test
- roster/account mapping: owner quản lý

Publishable/anon key có thể nằm trong frontend.
service_role key tuyệt đối không được đưa vào frontend.

============================================================
PROJECT TEST
============================================================

PASS trong Project Test chỉ đánh dấu candidate là PASSED.

Khi muốn candidate thật sự vào workspace:
1. Owner thêm candidate vào team_members.
2. Owner tạo Auth user.
3. Link auth_user_id giống các member khác.

Không để client tự tạo Auth user vì thao tác admin cần secret/service role.


V2.1 FIX
--------
- Sửa lỗi web vẫn báo chưa cấu hình dù đã điền Supabase.
- Hỗ trợ key tên: key / publishableKey / anonKey / supabaseKey.
- Hỗ trợ URL tên: url / supabaseUrl.
- Thêm cache-busting ?v=2.1 cho config.js và app.js.
- Nếu vẫn lỗi: Ctrl + F5 để xóa cache.
