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

  /** Existe algum cliente que NÃO é fictício? (então é um banco com dados reais) */
  const hasRealClients = async () => {
    const { count } = await service.from("clients").select("id", { count: "exact", head: true }).eq("is_demo", false);
    return (count ?? 0) > 0;
  };

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

  it("gestor muda a situação, mas só o administrador exclui", async () => {
    const st = await users.gestor.client.from("clients").update({ status: "suspenso" }).eq("id", clientId).select("status");
    expect(st.data?.[0]?.status).toBe("suspenso");
    await users.gestor.client.from("clients").update({ status: "ativo" }).eq("id", clientId);

    const byGestor = await users.gestor.client.from("clients").delete().eq("id", clientId).select("id");
    expect(byGestor.data ?? []).toHaveLength(0);
    const byColab = await users.fiscal.client.from("clients").delete().eq("id", clientId).select("id");
    expect(byColab.data ?? []).toHaveLength(0);
    const { data: still } = await service.from("clients").select("id").eq("id", clientId);
    expect(still).toHaveLength(1);
  });

  it("administrador exclui cliente e os dados ligados a ele saem junto", async () => {
    const { data: tmp } = await users.admin.client
      .from("clients")
      .insert({ legal_name: `Excluir Fictício ${tag}`, cnpj: fakeCnpj(), is_demo: true })
      .select("id")
      .single();
    await users.admin.client.from("client_contacts").insert({ client_id: tmp!.id, name: "Contato a excluir" });
    const del = await users.admin.client.from("clients").delete().eq("id", tmp!.id).select("id");
    expect(del.data).toHaveLength(1);
    const { data: orphan } = await service.from("client_contacts").select("id").eq("client_id", tmp!.id);
    expect(orphan).toHaveLength(0);
    await service.from("audit_log").delete()
      .or(`record_id.eq.${tmp!.id},new_data->>client_id.eq.${tmp!.id},old_data->>client_id.eq.${tmp!.id}`);
  });

  it("banco rejeita CNPJ inválido mesmo sem passar pela tela", async () => {
    const r = await users.gestor.client.from("clients").insert({ legal_name: "CNPJ ruim", cnpj: "11222333000100" });
    expect(r.error).not.toBeNull();
  });

  it("perfil desativado perde o acesso imediatamente", async () => {
    await service.from("profiles").update({ active: false }).eq("id", users.atend.id);
    try {
      expect(await canSee("atend")).toBe(false);
    } finally {
      await service.from("profiles").update({ active: true }).eq("id", users.atend.id);
    }
  });

  // ---------------- Tickets ----------------
  describe("Tickets", () => {
    let ticketId = "";

    const categoryId = async (name: string, department: Dep) => {
      const { data } = await service.from("ticket_categories").select("id").eq("name", name).eq("department", department).single();
      return data!.id;
    };
    const sees = async (key: string, id = ticketId) => {
      const { data } = await users[key].client.from("tickets").select("id").eq("id", id);
      return (data?.length ?? 0) > 0;
    };

    it("atendimento abre ticket e o banco calcula os prazos (ignora valores forjados)", async () => {
      const { data, error } = await users.atend.client
        .from("tickets")
        .insert({
          client_id: clientId,
          title: `Certidão fictícia ${tag}`,
          category_id: await categoryId("Emissão de certidão simples", "fiscal"),
          department: "fiscal",
          origin: "whatsapp",
          resolution_due_at: "2099-01-01T00:00:00Z",
          created_at: "2020-01-01T00:00:00Z",
          status: "concluido",
        })
        .select("*")
        .single();
      expect(error).toBeNull();
      ticketId = data!.id;
      expect(data!.status).toBe("aberto");
      expect(data!.created_by).toBe(users.atend.id);
      expect(Math.abs(Date.parse(data!.created_at) - Date.now())).toBeLessThan(5 * 60_000);
      expect(data!.resolution_due_at?.startsWith("2099")).toBe(false);
      expect(Date.parse(data!.resolution_due_at!)).toBeGreaterThan(Date.parse(data!.created_at));
    });

    it("só vê o ticket quem tem relação com ele", async () => {
      expect(await sees("gestor")).toBe(true);
      expect(await sees("fiscal")).toBe(true);
      expect(await sees("dp")).toBe(false);
      expect(await sees("contabil")).toBe(false);
    });

    it("prazo não pode ser alterado à mão", async () => {
      const before = await service.from("tickets").select("resolution_due_at").eq("id", ticketId).single();
      await users.fiscal.client.from("tickets").update({ resolution_due_at: "2099-01-01T00:00:00Z" }).eq("id", ticketId);
      const after = await service.from("tickets").select("resolution_due_at").eq("id", ticketId).single();
      expect(after.data!.resolution_due_at).toBe(before.data!.resolution_due_at);
    });

    it("mudar departamento só por encaminhamento com motivo", async () => {
      const direct = await users.fiscal.client.from("tickets").update({ department: "contabil" }).eq("id", ticketId);
      expect(direct.error).not.toBeNull();

      const noReason = await users.fiscal.client.rpc("ticket_forward", {
        p_ticket: ticketId, p_department: "contabil", p_assignee: null, p_reason: " ",
      });
      expect(noReason.error).not.toBeNull();

      const ok = await users.fiscal.client.rpc("ticket_forward", {
        p_ticket: ticketId, p_department: "contabil", p_assignee: users.contabil.id, p_reason: "Envolve alteração contratual",
      });
      expect(ok.error).toBeNull();
      expect(await sees("contabil")).toBe(true);
      // Quem encaminhou continua acompanhando
      expect(await sees("fiscal")).toBe(true);

      const { data: ev } = await service.from("ticket_events").select("body, actor_id").eq("ticket_id", ticketId).eq("kind", "encaminhamento");
      expect(ev?.[0]?.body).toBe("Envolve alteração contratual");
      expect(ev?.[0]?.actor_id).toBe(users.fiscal.id);
    });

    it("menção avisa só a pessoa mencionada e libera o acompanhamento", async () => {
      const { error } = await users.atend.client.from("ticket_events").insert({
        ticket_id: ticketId, kind: "comentario", actor_id: users.atend.id, body: "Pode olhar a folha?", mentions: [users.dp.id],
      });
      expect(error).toBeNull();
      const { data: mine } = await users.dp.client.from("notifications").select("kind").eq("ticket_id", ticketId);
      expect(mine?.some((n) => n.kind === "mencao")).toBe(true);
      const { data: others } = await users.fiscal.client.from("notifications").select("id").eq("user_id", users.dp.id);
      expect(others ?? []).toHaveLength(0);
      expect(await sees("dp")).toBe(true);

      const forged = await users.dp.client.from("ticket_events").insert({
        ticket_id: ticketId, kind: "comentario", actor_id: users.atend.id, body: "Assinado por outra pessoa",
      });
      expect(forged.error).not.toBeNull();
    });

    it("concluir exige descrição e só a gestão reabre", async () => {
      const noNote = await users.contabil.client.rpc("ticket_set_status", { p_ticket: ticketId, p_status: "concluido", p_note: "" });
      expect(noNote.error).not.toBeNull();
      const done = await users.contabil.client.rpc("ticket_set_status", {
        p_ticket: ticketId, p_status: "concluido", p_note: "Certidão emitida e enviada",
      });
      expect(done.error).toBeNull();

      const reopenColab = await users.contabil.client.rpc("ticket_set_status", { p_ticket: ticketId, p_status: "em_andamento" });
      expect(reopenColab.error).not.toBeNull();
      const reopenGestor = await users.gestor.client.rpc("ticket_set_status", { p_ticket: ticketId, p_status: "em_andamento", p_note: "Cliente pediu ajuste" });
      expect(reopenGestor.error).toBeNull();
    });

    it("prazo vencido avisa responsável e gestão uma vez só", async (ctx) => {
      // As rotinas automáticas agem sobre TODOS os dados: só rodam num banco sem clientes reais
      if (await hasRealClients()) return ctx.skip();
      // Ticket aberto há 10 dias (só a chave de serviço pode definir a data, como numa importação)
      const { data: old, error } = await service
        .from("tickets")
        .insert({
          client_id: clientId,
          title: `Atrasado fictício ${tag}`,
          category_id: await categoryId("Emissão de certidão simples", "fiscal"),
          assignee_id: users.fiscal.id,
          created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
        })
        .select("id")
        .single();
      expect(error).toBeNull();

      await service.rpc("sla_sweep");
      await service.rpc("sla_sweep");

      const { data: n } = await service.from("notifications").select("user_id, kind").eq("ticket_id", old!.id);
      const count = (user: string, kind: string) => n!.filter((x) => x.user_id === user && x.kind === kind).length;
      expect(count(users.fiscal.id, "prazo_vencido")).toBe(1);
      expect(count(users.gestor.id, "escalonamento")).toBeGreaterThanOrEqual(1);
      // Sem duplicar: no máximo 1 aviso de escalonamento por tipo (1ª resposta + prazo)
      expect(count(users.gestor.id, "escalonamento")).toBeLessThanOrEqual(2);

      const { data: t } = await service.from("tickets").select("overdue_notified_at").eq("id", old!.id).single();
      expect(t!.overdue_notified_at).not.toBeNull();
    });

    it("documentos: exigência gera pendência, lembrete sai uma vez e recebimento encerra a cobrança", async (ctx) => {
      if (await hasRealClients()) return ctx.skip();
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const due = new Date(`${today}T12:00:00Z`);
      due.setUTCDate(due.getUTCDate() + 5);
      const dueIso = due.toISOString().slice(0, 10);
      const { data: type } = await service.from("document_types").select("id").eq("department", "fiscal").limit(1).single();

      // Fiscal cadastra a exigência; DP (não atende o cliente) não consegue
      const denied = await users.dp.client.from("document_requirements")
        .insert({ client_id: clientId, document_type_id: type!.id, periodicity: "mensal", due_day: 10 });
      expect(denied.error).not.toBeNull();
      const { error } = await users.fiscal.client.from("document_requirements")
        .insert({ client_id: clientId, document_type_id: type!.id, periodicity: "mensal", due_day: due.getUTCDate() });
      expect(error).toBeNull();
      const { data: doc } = await service.from("client_documents").select("id, status").eq("client_id", clientId).eq("due_date", dueIso).single();
      expect(doc?.status).toBe("pendente");
      const { data: hidden } = await users.dp.client.from("client_documents").select("id").eq("id", doc!.id);
      expect(hidden ?? []).toHaveLength(0);

      // Varredura às 10h de hoje: 1 lembrete interno, sem duplicar ao rodar de novo
      const at10 = `${today}T10:00:00-03:00`;
      await service.rpc("documents_sweep", { p_now: at10 });
      await service.rpc("documents_sweep", { p_now: at10 });
      const { data: rem } = await service.from("document_reminders").select("channel, days_before, status").eq("document_id", doc!.id);
      expect(rem?.filter((r) => r.channel === "interno")).toEqual([{ channel: "interno", days_before: 5, status: "enviado" }]);

      // Dispensar exige motivo; atendimento registra o recebimento
      const noReason = await users.fiscal.client.from("client_documents").update({ status: "dispensado" }).eq("id", doc!.id);
      expect(noReason.error).not.toBeNull();
      const rec = await users.atend.client.from("client_documents").update({ status: "recebido" }).eq("id", doc!.id).select("received_by");
      expect(rec.data?.[0]?.received_by).toBe(users.atend.id);
      await service.rpc("documents_sweep", { p_now: at10 });
      const { count } = await service.from("document_reminders").select("id", { count: "exact", head: true }).eq("document_id", doc!.id);
      expect(count).toBe(rem!.length);
    });

    it("usuário não lê avisos de outra pessoa nem marca como lidos", async () => {
      const r = await users.fiscal.client.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", users.gestor.id).select("id");
      expect(r.data ?? []).toHaveLength(0);
    });
  });
});
