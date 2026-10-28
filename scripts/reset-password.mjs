// Gera uma senha provisória para uma conta (ex.: administrador que esqueceu a senha).
// Uso (na pasta do projeto):
//   npm run reset-password -- "email@empresa.com"
// A senha provisória aparece uma única vez, só neste terminal. Troque-a em Configurações → Conta.

import { createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error('Uso: npm run reset-password -- "email@empresa.com"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const { data: profile, error: findError } = await supabase.from("profiles").select("id, full_name, role, active").eq("email", email).maybeSingle();
if (findError || !profile) {
  console.error("Conta não encontrada com esse e-mail.");
  process.exit(1);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const password = [...randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join("") + "7a";
const { error } = await supabase.auth.admin.updateUserById(profile.id, { password });
if (error) {
  console.error("Não foi possível trocar a senha:", error.message);
  process.exit(1);
}
// Libera um eventual bloqueio por tentativas erradas (a tabela pode ainda não existir)
// (mesma chave usada pelo servidor em src/lib/security/throttle.ts)
if (process.env.CHANNEL_SECRET_KEY) {
  const accountKey = createHmac("sha256", process.env.CHANNEL_SECRET_KEY).update(`conta:${email}`).digest("hex");
  await supabase.from("login_attempts").insert({ account_key: accountKey, ip_key: "reset", success: true }).then(() => {}, () => {});
}

console.log(`\nSenha trocada para ${profile.full_name} (${email}).`);
if (!profile.active) console.log("  Atenção: esta conta está DESATIVADA; reative na tela Equipe.");
console.log(`  Senha provisória: ${password}`);
console.log("  Entre com ela e troque em Configurações → Conta.\n");
