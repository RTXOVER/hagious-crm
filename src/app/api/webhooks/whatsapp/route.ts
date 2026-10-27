import { after, NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySignature } from "@/lib/channels/whatsapp-parse";
import { processWhatsAppPayload, whatsappEnv } from "@/lib/channels/whatsapp";
import type { Json } from "@/lib/database.types";

/**
 * Endereço que a Meta chama com as mensagens do WhatsApp.
 * GET: validação do endereço (a Meta envia hub.verify_token e espera hub.challenge de volta).
 * POST: avisos assinados (X-Hub-Signature-256). O aviso é GUARDADO e a resposta sai na hora;
 * o processamento roda logo depois (after), e avisos que falharam são reprocessados nas próximas chamadas.
 */
const MAX_BODY = 5 * 1024 * 1024;

function sameText(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const { verifyToken } = whatsappEnv();
  if (verifyToken && p.get("hub.mode") === "subscribe" && sameText(p.get("hub.verify_token") ?? "", verifyToken)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Token de verificação inválido", { status: 403 });
}

/** Processa avisos guardados e ainda não processados (até 5 tentativas cada). */
async function processPending(admin: ReturnType<typeof createAdminClient>, firstId?: number) {
  const { data: pending } = await admin
    .from("webhook_events")
    .select("id, payload, attempts")
    .eq("source", "whatsapp")
    .is("processed_at", null)
    .lt("attempts", 5)
    .order("id")
    .limit(20);
  const list = [...(pending ?? [])].sort((a, b) => Number(b.id === firstId) - Number(a.id === firstId));
  for (const ev of list) {
    try {
      await processWhatsAppPayload(ev.payload);
      await admin.from("webhook_events").update({ processed_at: new Date().toISOString(), attempts: ev.attempts + 1, error: null }).eq("id", ev.id);
    } catch (e) {
      console.error("[webhook whatsapp]", e);
      await admin.from("webhook_events").update({ attempts: ev.attempts + 1, error: String((e as Error).message).slice(0, 2000) }).eq("id", ev.id);
    }
  }
}

export async function POST(request: NextRequest) {
  const { appSecret } = whatsappEnv();
  if (!appSecret) return new NextResponse("WhatsApp não configurado", { status: 503 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return new NextResponse("Corpo grande demais", { status: 413 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return new NextResponse("Corpo grande demais", { status: 413 });
  if (!verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new NextResponse("Assinatura inválida", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Corpo inválido", { status: 400 });
  }

  // Guarda primeiro (a Meta não reenvia histórico); se não conseguir guardar, pede reenvio (500)
  const admin = createAdminClient();
  const { data: event, error } = await admin
    .from("webhook_events")
    .insert({ source: "whatsapp", payload: payload as Json, signature_ok: true })
    .select("id")
    .single();
  if (error || !event) return new NextResponse("Erro ao guardar", { status: 500 });

  // Responde já (avisos grandes de histórico não estouram o tempo da Meta) e processa em seguida
  after(() => processPending(admin, event.id));
  return NextResponse.json({ ok: true });
}
