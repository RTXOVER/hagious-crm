"use server";

import { requireManager } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isValidCnpj, normalizeWhatsapp, onlyDigits } from "@/lib/validation/cnpj";

/**
 * Consulta dados públicos do CNPJ na BrasilAPI (https://brasilapi.com.br), que reúne dados abertos da Receita Federal.
 * Usamos SOMENTE dados da empresa. O quadro de sócios (QSA) contém dados pessoais e é descartado (minimização, LGPD).
 * Os dados apenas pré-preenchem o formulário: a pessoa confere antes de salvar.
 */
export type CnpjLookupResult =
  | {
      ok: true;
      data: {
        legal_name: string;
        trade_name: string;
        address: string;
        phone: string; // apenas dígitos com DDI 55, ou ""
        email: string;
        registration_status: string; // ATIVA, BAIXADA, INAPTA...
        city: string;
        activity: string;
        opened_on: string;
        suggested_regime: "mei" | "simples_nacional" | null;
      };
      existing?: { id: string; name: string };
    }
  | { ok: false; reason: "invalid" | "not_found" | "unavailable"; existing?: { id: string; name: string } };

type BrasilApiCnpj = {
  razao_social?: string;
  nome_fantasia?: string;
  descricao_tipo_de_logradouro?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  ddd_telefone_1?: string;
  email?: string | null;
  descricao_situacao_cadastral?: string;
  cnae_fiscal_descricao?: string;
  data_inicio_atividade?: string;
  opcao_pelo_mei?: boolean | null;
  opcao_pelo_simples?: boolean | null;
};

export async function lookupCnpjAction(rawCnpj: string): Promise<CnpjLookupResult> {
  await requireManager();
  const cnpj = onlyDigits(rawCnpj);
  if (!isValidCnpj(cnpj)) return { ok: false, reason: "invalid" };

  // Já cadastrado? Evita duplicidade antes mesmo de consultar a Receita
  const supabase = await createClient();
  const { data: dup } = await supabase.from("clients").select("id, legal_name").eq("cnpj", cnpj).maybeSingle();
  const existing = dup ? { id: dup.id, name: dup.legal_name } : undefined;

  let body: BrasilApiCnpj;
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
      // A BrasilAPI recusa (403) requisições sem identificação de origem
      headers: { Accept: "application/json", "User-Agent": "HagiousCRM/1.0 (+consulta de CNPJ de clientes)" },
    });
    if (res.status === 404) return { ok: false, reason: "not_found", existing };
    if (!res.ok) return { ok: false, reason: "unavailable", existing };
    body = (await res.json()) as BrasilApiCnpj;
  } catch (err) {
    console.error("[cnpj] consulta falhou", err);
    return { ok: false, reason: "unavailable", existing };
  }

  const clean = (v?: string | null) => (v ?? "").replace(/\s+/g, " ").trim();
  const cep = onlyDigits(body.cep ?? "");
  const street = [clean(body.descricao_tipo_de_logradouro), clean(body.logradouro)].filter(Boolean).join(" ");
  const address = [
    [street, clean(body.numero)].filter(Boolean).join(", "),
    clean(body.complemento),
    clean(body.bairro),
    [clean(body.municipio), clean(body.uf)].filter(Boolean).join("/"),
    cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : "",
  ]
    .filter(Boolean)
    .join(" - ")
    .slice(0, 400);

  const phoneDigits = onlyDigits(body.ddd_telefone_1 ?? "");
  const email = clean(body.email).toLowerCase();

  return {
    ok: true,
    existing,
    data: {
      legal_name: clean(body.razao_social).slice(0, 200),
      trade_name: clean(body.nome_fantasia).slice(0, 200),
      address,
      phone: phoneDigits ? normalizeWhatsapp(phoneDigits) ?? "" : "",
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : "",
      registration_status: clean(body.descricao_situacao_cadastral).toUpperCase(),
      city: [clean(body.municipio), clean(body.uf)].filter(Boolean).join("/"),
      activity: clean(body.cnae_fiscal_descricao),
      opened_on: clean(body.data_inicio_atividade),
      suggested_regime: body.opcao_pelo_mei ? "mei" : body.opcao_pelo_simples ? "simples_nacional" : null,
    },
  };
}
