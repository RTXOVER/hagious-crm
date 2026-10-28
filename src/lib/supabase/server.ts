import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { sessionCookieOptions } from "@/lib/security/headers";
import type { Database } from "@/lib/database.types";
import { publicEnv } from "@/lib/env";

/**
 * Cliente Supabase com a sessão do usuário logado.
 * Todas as consultas passam pelas regras de permissão (RLS) do banco.
 * Crie um novo cliente a cada requisição.
 */
export async function createClient() {
  const [cookieStore, h] = await Promise.all([cookies(), headers()]);
  const { url, anonKey } = publicEnv();
  const https = h.get("x-forwarded-proto") === "https";

  return createServerClient<Database>(url, anonKey, {
    cookieOptions: sessionCookieOptions(https),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Chamado a partir de um Server Component: o proxy já renova a sessão.
        }
      },
    },
  });
}
