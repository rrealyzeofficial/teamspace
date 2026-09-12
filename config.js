// TEAM SPACE — Supabase config
// Dán đúng Project URL và Publishable/Anon Key của project Supabase.
// KHÔNG dùng service_role key.
//
// Có thể dùng một trong các cách dưới đây.
// Cách khuyến nghị:

window.TEAM_SUPABASE = {
  url: "https://YOUR-PROJECT.supabase.co",
  key: "YOUR_PUBLISHABLE_OR_ANON_KEY"
};

// Nếu bạn thích tên khác, app.js V2.1 cũng chấp nhận:
// window.TEAM_SUPABASE = {
//   supabaseUrl: "...",
//   publishableKey: "..."
// };
//
// hoặc:
// window.TEAM_SUPABASE = {
//   url: "...",
//   anonKey: "..."
// };
