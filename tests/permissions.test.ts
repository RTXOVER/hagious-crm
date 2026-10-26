/**
 * Testes de permissão direto no banco (RLS).
 * Precisam de um Supabase de DESENVOLVIMENTO configurado no .env.local.
 * Criam usuários e um cliente FICTÍCIOS (is_demo = true) e apagam tudo no final.
 * Rode com: npm run test:db
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { Database } from "@/lib/database.types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configured = Boolean(url && anonKey && serviceKey);

type DB = SupabaseClient<Database>;
type Role = Database["public"]["Enums"]["user_role"];
type Dep = Database["public"]["Enums"]["department"];

/** Gera um CNPJ válido aleatório (fictício). */
function fakeCnpj(): string {
  const base = Array.from(randomBytes(12), (b) => b % 10);
  base[8] = 0; base[9] = 0; base[10] = 0; base[11] = 1;
  const dv = (digits: number[]) => {
    const w = digits.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = digits.reduce((s, d, i) => s + d * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join("");
}

describe.skipIf(!configured)("Permissões no banco (RLS)", () => {
  const service: DB = configured ? createClient<Database>(url!, serviceKey!, { auth: { persistSession: false } }) : (null as never);
  const tag = randomBytes(4).toString("hex");
  const users: Record<string, { id: string; client: DB }> = {};
  let clientId = "";

  async function makeUser(key: string, role: Role, department: Dep | null) {
    const email = `teste-${key}-${tag}@exemplo.invalid`;
    const password = `Senha${randomBytes(8).toString("hex")}1`;
    const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const { error: pe } = await service.from("profiles").insert({
      id: data.user.id, full_name: `Teste ${key}`, email, role, department,
    });
    if (pe) throw pe;
    const client = createClient<Database>(url!, anonKey!, { auth: { persistSession: false } });
    const { error: le } = await client.auth.signInWithPassword({ email, password });
    if (le) throw le;
    users[key] = { id: data.user.id, client };
  }

  beforeAll(async () => {
    await makeUser("admin", "admin", null);
    await makeUser("gestor", "gestor", null);
    await makeUser("fiscal", "colaborador", "fiscal");
    await makeUser("dp", "colaborador", "dp");
    await makeUser("atend", "colaborador", "atendimento");
    await makeUser("contabil", "colaborador", "contabil");

    // Gestor cadastra um cliente fictício com serviço FISCAL
    const { data, error } = await users.gestor.client
      .from("clients")
      .insert({ legal_name: `Cliente Fictício ${tag}`, cnpj: fakeCnpj(), is_demo: true })
      .select("id")
      .single();
    if (error) throw error;
    clientId = data.id;
    const { error: se } = await users.gestor.client
      .from("client_services")
      .insert({ client_id: clientId, department: "fiscal", description: "Apuração de impostos" });
    if (se) throw se;
  });

  afterAll(async () => {
    if (clientId) await service.from("clients").delete().eq("id", clientId);
    for (const u of Object.values(users)) {
      await service.from("client_responsibles").delete().eq("user_id", u.id);
      await service.auth.admin.deleteUser(u.id);
    }
    // Remove do histórico os registros gerados por estes dados fictícios
    if (clientId) {
      await service.from("audit_log").delete()
        .or(`record_id.eq.${clientId},new_data->>client_id.eq.${clientId},old_data->>client_id.eq.${clientId}`);
    }
    const userIds = Object.values(users).map((u) => u.id);
    if (userIds.length) await service.from("audit_log").delete().eq("table_name", "profiles").in("record_id", userIds);
  });

  const canSee = async (key: string) => {
    const { data } = await users[key].client.from("clients").select("id").eq("id", clientId);
    return (data?.length ?? 0) > 0;
  };

  it("visitante sem login não lê nenhum cliente", async () => {
    const anon = createClient<Database>(url!, anonKey!, { auth: { persistSession: false } });
    const { data } = await anon.from("clients").select("id").eq("id", clientId);
    expect(data ?? []).toHaveLength(0);
  });

  it("gestão e atendimento veem o cliente", async () => {
    expect(await canSee("admin")).toBe(true);
    expect(await canSee("gestor")).toBe(true);
    expect(await canSee("atend")).toBe(true);
  });

  it("colaborador vê apenas clientes do seu departamento", async () => {
    expect(await canSee("fiscal")).toBe(true);
    expect(await canSee("dp")).toBe(false);
  });

  it("ser responsável pelo cliente libera o acesso", async () => {
    expect(await canSee("contabil")).toBe(false);
    const { error } = await users.gestor.client
      .from("client_responsibles")
      .insert({ client_id: clientId, department: "contabil", user_id: users.contabil.id });
    expect(error).toBeNull();
    expect(await canSee("contabil")).toBe(true);
  });

  it("colaborador não cadastra nem altera dados do cliente", async () => {
    const ins = await users.fiscal.client.from("clients").insert({ legal_name: "Indevido", cnpj: fakeCnpj() });
    expect(ins.error).not.toBeNull();

    const upd = await users.fiscal.client.from("clients").update({ legal_name: "Alterado" }).eq("id", clientId).select("id");
    expect(upd.data ?? []).toHaveLength(0);
  });

  it("colaborador com acesso pode manter contatos; sem acesso, não", async () => {
    const ok = await users.fiscal.client
      .from("client_contacts")
      .insert({ client_id: clientId, name: "Contato Fictício", whatsapp: "5511900000000" });
    expect(ok.error).toBeNull();

    const denied = await users.dp.client
      .from("client_contacts")
      .insert({ client_id: clientId, name: "Indevido" });
    expect(denied.error).not.toBeNull();
  });

  it("colaborador não muda o próprio cargo", async () => {
    const r = await users.fiscal.client.from("profiles").update({ role: "admin" }).eq("id", users.fiscal.id).select("id");
    expect(r.data ?? []).toHaveLength(0);
    const { data } = await service.from("profiles").select("role").eq("id", users.fiscal.id).single();
    expect(data?.role).toBe("colaborador");
  });

  it("auditoria registra quem alterou e só a gestão consegue ler", async () => {
    await users.gestor.client.from("clients").update({ notes: "Alteração de teste" }).eq("id", clientId);

    const { data: forManager } = await users.gestor.client
      .from("audit_log")
      .select("action, actor_id")
      .eq("table_name", "clients")
      .eq("record_id", clientId)
      .eq("action", "UPDATE");
    expect(forManager?.some((r) => r.actor_id === users.gestor.id)).toBe(true);

    const { data: forColab } = await users.fiscal.client.from("audit_log").select("id").eq("record_id", clientId);
    expect(forColab ?? []).toHaveLength(0);
  });

  it("banco rejeita CNPJ inválido mesmo sem passar pela tela", async () => {
    const r = await users.gestor.client.from("clients").insert({ legal_name: "CNPJ ruim", cnpj: "11222333000100" });
    expect(r.error).not.toBeNull();
  });

  it("perfil desativado perde o acesso imediatamente", async () => {
    await service.from("profiles").update({ active: false }).eq("id", users.atend.id);
    expect(await canSee("atend")).toBe(false);
    await service.from("profiles").update({ active: true }).eq("id", users.atend.id);
  });
});
