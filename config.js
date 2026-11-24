// Filled in during setup. The anon/publishable key is safe in the app: the database
// only lets signed-in users read, and nobody can write from the app.
window.TM = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-OR-PUBLISHABLE-KEY"
};
