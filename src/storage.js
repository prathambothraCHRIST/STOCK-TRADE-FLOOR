import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// Prefer Supabase's modern publishable key, while keeping legacy anon compatibility.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  throw new Error("Missing Supabase environment variables. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel.");
}

export const supabase = createClient(url, key);

export function getClientId() {
  let id = localStorage.getItem("stockex_client_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("stockex_client_id", id);
  }
  return id;
}

export async function read(scope, keyName) {
  const { data, error } = await supabase.from("storage_kv").select("value,updated_at").eq("scope", scope).eq("key", keyName).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

export async function write(scope, keyName, value) {
  const { error } = await supabase.from("storage_kv").upsert({ scope, key: keyName, value, updated_at: new Date().toISOString() }, { onConflict: "scope,key" });
  if (error) throw error;
}

export async function remove(scope, keyName) {
  const { error } = await supabase.from("storage_kv").delete().eq("scope", scope).eq("key", keyName);
  if (error) throw error;
}

export async function listScope(scope, prefix = "") {
  const { data, error } = await supabase.from("storage_kv").select("key,value,updated_at").eq("scope", scope).like("key", `${prefix}%`);
  if (error) throw error;
  return data || [];
}
