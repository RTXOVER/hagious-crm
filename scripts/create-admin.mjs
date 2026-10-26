// Cria o PRIMEIRO administrador do CRM (as demais contas são criadas na tela Equipe).
// Uso (na pasta do projeto):
//   node --env-file=.env.local scripts/create-admin.mjs "email@empresa.com" "Nome Completo"
// A senha provisória é exibida uma única vez no terminal; troque-a em "Minha conta".

import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const [email, fullName] = process.argv.slice(2);
if (!email || !fullName) {
  console.error('Uso: node --env-file=.env.local scripts/create-admin.mjs "email" "Nome Completo"');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const password = [...randomBytes(16)].map((b) => alphabet[b % alphabet.length]).join("") + "7a";

const { data, error } = await supabase.auth.admin.createUser({
  email: email.toLowerCase(),
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});
if (error) {
  console.error("Erro ao criar usuário:", error.message);
  process.exit(1);
}

const { error: profileError } = await supabase.from("profiles").insert({
  id: data.user.id,
  full_name: fullName,
  email: email.toLowerCase(),
  role: "admin",
});
if (profileError) {
  await supabase.auth.admin.deleteUser(data.user.id);
  console.error("Erro ao criar perfil (conta desfeita):", profileError.message);
  process.exit(1);
}

console.log("\nAdministrador criado com sucesso.");
console.log(`  E-mail: ${email.toLowerCase()}`);
console.log(`  Senha provisória: ${password}`);
console.log('  Troque a senha em "Minha conta" no primeiro acesso.\n');
