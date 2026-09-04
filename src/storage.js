// Supabase-backed shared storage for the multiplayer trading floor.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

function clientId() {
  let id = localStorage.getItem("stockex_client_id");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    localStorage.setItem("stockex_client_id", id);
  }
  return id;
}

const scopeFor = (shared) => (shared ? "shared" : `user:${clientId()}`);

export const storage = {
  async get(key, shared = false) {
    const { data, error } = await supabase.from("storage_kv").select("value").eq("scope", scopeFor(shared)).eq("key", key).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`storage: no value for "${key}"`);
    return { key, value: data.value, shared };
  },
  async set(key, value, shared = false) {
    const { error } = await supabase.from("storage_kv").upsert({ scope: scopeFor(shared), key, value, updated_at: new Date().toISOString() }, { onConflict: "scope,key" });
    if (error) throw error;
    return { key, value, shared };
  },
  async delete(key, shared = false) {
    const { error } = await supabase.from("storage_kv").delete().eq("scope", scopeFor(shared)).eq("key", key);
    if (error) throw error;
    return { key, deleted: true, shared };
  },
  async list(prefix = "", shared = false) {
    const { data, error } = await supabase.from("storage_kv").select("key").eq("scope", scopeFor(shared)).like("key", `${prefix}%`);
    if (error) throw error;
    return { keys: (data || []).map((r) => r.key), prefix, shared };
  },
};
