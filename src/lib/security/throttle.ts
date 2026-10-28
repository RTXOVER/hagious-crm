import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_LIMIT, IP_LIMIT, blockedUntil, clientIp, minutesLeft } from "./throttle-rules";

/*
 * Bloqueio de tentativas de senha, guardado no banco (vale mesmo com o servidor reiniciado).
 * E-mail e endereço de rede são guardados com hash (HMAC): o registro não revela quem nem de onde.
 * Se o banco não responder, o login continua funcionando (não trava a equipe), e o erro vai para o log.
 */

function hmac(value: string): string {
  const secret = process.env.CHANNEL_SECRET_KEY;
  if (!secret) throw new Error("CHANNEL_SECRET_KEY não configurada no servidor.");
  return createHmac("sha256", secret).update(value).digest("hex");
}

async function keys(email: string) {
  const h = await headers();
  const ip = clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
  // Mesma chave de conta usada em scripts/reset-password.mjs
  return { account: hmac(`conta:${email}`), ip: hmac(`ip:${ip}`) };
}

/** Antes de conferir a senha: está bloqueado? Retorna os minutos que faltam ou null. */
export async function loginBlocked(email: string): Promise<number | null> {
  try {
    const k = await keys(email);
    const since = new Date(Date.now() - Math.max(ACCOUNT_LIMIT.windowMs, IP_LIMIT.windowMs)).toISOString();
    const admin = createAdminClient();
    const [acc, ip] = await Promise.all([
      admin.from("login_attempts").select("success, created_at").eq("account_key", k.account).gte("created_at", since).limit(200),
      admin.from("login_attempts").select("success, created_at").eq("ip_key", k.ip).eq("success", false).gte("created_at", since).limit(200),
    ]);
    if (acc.error || ip.error) throw acc.error ?? ip.error;
    const now = Date.now();
    const toAttempts = (rows: { success: boolean; created_at: string }[]) => rows.map((r) => ({ success: r.success, at: Date.parse(r.created_at) }));
    const until = Math.max(
      blockedUntil(toAttempts(acc.data), now, ACCOUNT_LIMIT) ?? 0,
      blockedUntil(toAttempts(ip.data), now, IP_LIMIT, false) ?? 0,
    );
    return until > now ? minutesLeft(until, now) : null;
  } catch (e) {
    console.error("[segurança] verificação de bloqueio indisponível", e);
    return null;
  }
}

/** Depois de conferir a senha: registra o resultado; ao atingir o limite, avisa os administradores. */
export async function recordLogin(email: string, success: boolean): Promise<void> {
  try {
    const k = await keys(email);
    const admin = createAdminClient();
    const { error } = await admin.from("login_attempts").insert({ account_key: k.account, ip_key: k.ip, success });
    if (error) throw error;
    if (success) return;
    const now = Date.now();
    const { data } = await admin
      .from("login_attempts")
      .select("success, created_at")
      .eq("account_key", k.account)
      .gte("created_at", new Date(now - ACCOUNT_LIMIT.windowMs).toISOString())
      .limit(200);
    const until = blockedUntil((data ?? []).map((r) => ({ success: r.success, at: Date.parse(r.created_at) })), now, ACCOUNT_LIMIT);
    if (!until) return;
    // Só avisa contas que existem (e-mail inventado não gera aviso)
    const { data: target } = await admin.from("profiles").select("full_name").eq("email", email).maybeSingle();
    if (!target) return;
    const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").eq("active", true);
    const bucket = Math.floor(until / ACCOUNT_LIMIT.windowMs);
    if (admins?.length) {
      await admin.from("notifications").upsert(
        admins.map((a) => ({
          user_id: a.id,
          kind: "seguranca_login",
          title: "Login bloqueado por senhas erradas",
          body: `${target.full_name} (${email}): ${ACCOUNT_LIMIT.max} senhas erradas seguidas. Acesso bloqueado por 15 minutos. Se não foi a pessoa, pode ser tentativa de invasão.`,
          link: "/equipe",
          dedupe_key: `lock:${k.account.slice(0, 16)}:${bucket}`,
        })),
        { onConflict: "user_id,dedupe_key", ignoreDuplicates: true },
      );
    }
  } catch (e) {
    console.error("[segurança] não foi possível registrar a tentativa de login", e);
  }
}
