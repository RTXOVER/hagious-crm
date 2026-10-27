import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySignature } from "@/lib/channels/whatsapp-parse";
import { processWhatsAppPayload, whatsappEnv } from "@/lib/channels/whatsapp";
import type { Json } from "@/lib/database.types";

/**
 * Endereço que a Meta chama com as mensagens do WhatsApp.
 * GET: validação do endereço (a Meta envia hub.verify_token e espera hub.challenge de volta).
 * POST: avisos assinados com X-Hub-Signature-256; guardados antes de processar (a Meta não reenvia histórico).
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const { verifyToken } = whatsappEnv();
  if (verifyToken && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === verifyToken) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Token de verificação inválido", { status: 403 });
}

export async function POST(request: NextRequest) {
  const { appSecret } = whatsappEnv();
  if (!appSecret) return new NextResponse("WhatsApp não configurado", { status: 503 });

  const raw = await request.text();
  const ok = verifySignature(raw, request.headers.get("x-hub-signature-256"), appSecret);
  if (!ok) return new NextResponse("Assinatura inválida", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Corpo inválido", { status: 400 });
  }

  const admin = createAdminClient();
  const { data: event } = await admin
    .from("webhook_events")
    .insert({ source: "whatsapp", payload: payload as Json, signature_ok: true })
    .select("id")
    .single();

  try {
    await processWhatsAppPayload(payload);
    if (event) await admin.from("webhook_events").update({ processed_at: new Date().toISOString(), attempts: 1 }).eq("id", event.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Erro: fica registrado e a resposta 500 faz a Meta tentar de novo (o processamento não duplica)
    console.error("[webhook whatsapp]", e);
    if (event) await admin.from("webhook_events").update({ attempts: 1, error: String((e as Error).message).slice(0, 2000) }).eq("id", event.id);
    return new NextResponse("Erro ao processar", { status: 500 });
  }
}
