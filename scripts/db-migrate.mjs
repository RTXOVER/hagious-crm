// Aplica as migrações pendentes de supabase/migrations no banco configurado em SUPABASE_DB_URL.
// Uso: npm run db:migrate            (aplica as pendentes)
//      npm run db:migrate -- --status (só mostra o que está aplicado/pendente)
//
// Registra cada migração em supabase_migrations.schema_migrations (mesmo controle do Supabase CLI),
// então nenhuma roda duas vezes. Cada arquivo roda numa transação: se falhar, nada dele fica aplicado.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("Configure SUPABASE_DB_URL no .env.local (veja o README, seção 'Aplicar migrações').");
  process.exit(1);
}
const statusOnly = process.argv.includes("--status");
const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();

const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key, statements text[], name text
    );
  `);
  // A primeira migração foi aplicada manualmente pelo SQL Editor: registra se as tabelas já existem
  const { rows: base } = await client.query(`select to_regclass('public.profiles') is not null as ok`);
  if (base[0].ok) {
    await client.query(
      `insert into supabase_migrations.schema_migrations (version, name) values ('20261026000001', 'base_clientes') on conflict do nothing`,
    );
  }

  const { rows } = await client.query(`select version from supabase_migrations.schema_migrations`);
  const applied = new Set(rows.map((r) => r.version));
  const pending = files.filter((f) => !applied.has(f.slice(0, 14)));

  for (const f of files) console.log(`${applied.has(f.slice(0, 14)) ? "aplicada " : "PENDENTE "} ${f}`);
  if (statusOnly || !pending.length) {
    console.log(pending.length ? `\n${pending.length} pendente(s).` : "\nBanco em dia: nenhuma migração pendente.");
  } else {
    for (const f of pending) {
      const sql = readFileSync(join(dir, f), "utf8");
      process.stdout.write(`\nAplicando ${f} ... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query(
          `insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)`,
          [f.slice(0, 14), f.slice(15, -4), [sql]],
        );
        await client.query("commit");
        console.log("ok");
      } catch (err) {
        await client.query("rollback");
        console.log("FALHOU (nada desta migração foi aplicado)");
        console.error(`  ${err.message}${err.where ? `\n  em: ${err.where}` : ""}`);
        process.exitCode = 1;
        break;
      }
    }
  }
} finally {
  await client.end();
}
