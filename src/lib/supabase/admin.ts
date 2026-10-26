import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { publicEnv, serviceRoleKey } from "@/lib/env";

/**
 * Cliente com a chave de serviço: IGNORA as regras de permissão.
 * Use somente no servidor, depois de verificar no código que o usuário
 * tem autorização para a operação (ex.: admin criando conta de colaborador).
 */
export function createAdminClient() {
  return createClient<Database>(publicEnv().url, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
