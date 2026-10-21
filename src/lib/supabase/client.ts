"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicConfig } from "@/lib/supabase/config";

export function createClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase ainda não está configurado.");
  return createBrowserClient(config.url, config.publishableKey);
}
