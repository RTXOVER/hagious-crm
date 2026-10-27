import { describe, expect, it } from "vitest";
import { formatCnpj, isValidCnpj, normalizeCnpj, normalizeWhatsapp } from "@/lib/validation/cnpj";
import { clientSchema, isRealDate, newUserSchema } from "@/lib/validation/schemas";
import { makeFormatter } from "@/lib/format";
import { DEFAULT_PREFERENCES } from "@/lib/preferences";
import { relativeTime } from "@/lib/tickets";
import { emailSignals, htmlToText, pickUids } from "@/lib/channels/email";
import { signBody, verifySignature } from "@/lib/channels/whatsapp-parse";

describe("CNPJ alfanumérico (Receita, a partir de jul/2026)", () => {
  it("aceita o exemplo oficial e recusa dígito errado", () => {
    expect(isValidCnpj("12.ABC.345/01DE-35")).toBe(true);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("12abc34501de35")).toBe(true); // minúsculas viram maiúsculas
    expect(isValidCnpj("12ABC34501DE36")).toBe(false);
    expect(isValidCnpj("12ABC34501DEA5")).toBe(false); // os 2 últimos precisam ser dígitos
  });
  it("continua aceitando o CNPJ numérico e formata os dois", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("A11222333000181")).toBe(false); // antes uma letra era ignorada e passava
    expect(formatCnpj("12ABC34501DE35")).toBe("12.ABC.345/01DE-35");
    expect(normalizeCnpj(" 12.abc.345/01de-35 ")).toBe("12ABC34501DE35");
    expect(clientSchema.shape.cnpj.safeParse("12.ABC.345/01DE-35").data).toBe("12ABC34501DE35");
  });
});

describe("Telefones e datas", () => {
  it("WhatsApp com 0 de longa distância, 0055, DDD inválido", () => {
    expect(normalizeWhatsapp("011 99999-8888")).toBe("5511999998888");
    expect(normalizeWhatsapp("0055 11 99999-8888")).toBe("5511999998888");
    expect(normalizeWhatsapp("(10) 99999-8888")).toBeNull(); // DDD 10 não existe
    expect(normalizeWhatsapp("00000000000")).toBeNull();
    expect(normalizeWhatsapp("+1 415 555 1234")).toBe("14155551234");
  });
  it("recusa datas que não existem", () => {
    expect(isRealDate("2026-02-28")).toBe(true);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(clientSchema.shape.client_since.safeParse("2026-02-31").success).toBe(false);
  });
  it("e-mail de nova conta aceita espaços nas pontas", () => {
    const r = newUserSchema.safeParse({ full_name: "Ana", email: "  Ana@Empresa.com ", role: "gestor", department: "" });
    expect(r.success && r.data.email).toBe("ana@empresa.com");
  });
});

describe("Formatação robusta", () => {
  const f = makeFormatter();
  it("data inválida não derruba a tela", () => {
    expect(f.dateTime("lixo")).toBe("—");
    expect(f.date("2026")).toBe("—");
    expect(f.date("31/12/2026")).toBe("—");
  });
  it("dia/mês segue o formato escolhido", () => {
    expect(f.dayMonth("2026-03-09T17:30:00Z")).toBe("09/03");
    expect(makeFormatter({ ...DEFAULT_PREFERENCES, date_format: "ymd" }).dayMonth("2026-03-09T17:30:00Z")).toBe("03-09");
  });
  it("número decimal no idioma", () => {
    expect(f.number(1.5)).toBe("1,5");
  });
  it("tempo relativo sem casos estranhos", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(relativeTime("2026-10-28T12:00:20Z", now)).toBe("agora");
    expect(relativeTime("2026-10-29T12:00:00Z", now)).toBe("em 24 h");
    expect(relativeTime("2026-10-31T12:00:00Z", now)).toBe("em 3 dias");
    expect(relativeTime("lixo", now)).toBe("—");
  });
});

describe("E-mail: classificação, texto e sincronização", () => {
  const H = (o: Record<string, string>) => new Map(Object.entries(o));
  it("sinais de envio em massa/automático", () => {
    expect(emailSignals(H({ "list-unsubscribe": "<mailto:x>" }), "news@loja.com").bulk).toBe(true);
    expect(emailSignals(H({ precedence: "bulk" }), "a@b.com").bulk).toBe(true);
    expect(emailSignals(H({ "auto-submitted": "auto-generated" }), "a@b.com").bulk).toBe(true);
    expect(emailSignals(H({ "auto-submitted": "no" }), "joao@cliente.com").bulk).toBe(false);
    expect(emailSignals(H({}), "noreply@banco.com.br").bulk).toBe(true);
    expect(emailSignals(H({}), "naoresponda@gov.br").bulk).toBe(true);
    expect(emailSignals(H({}), "maria@padaria.com.br")).toEqual({ bulk: false, reasons: [] });
  });
  it("HTML vira texto com entidades certas e sem <head>", () => {
    expect(htmlToText("<html><head><title>Oferta</title></head><body><p>Olá &amp;lt;tag&amp;gt; &quot;x&quot; &#39;y&#39; &#233;</p></body></html>")).toBe("Olá &lt;tag&gt; \"x\" 'y' é");
  });
  it("sincronização não perde e-mails quando chegam muitos de uma vez", () => {
    const uids = Array.from({ length: 500 }, (_, i) => 1001 + i);
    expect(pickUids(uids, true).slice(0, 2)).toEqual([1001, 1002]); // continua pelos mais antigos
    expect(pickUids(uids, true)).toHaveLength(300);
    expect(pickUids(uids, false)[0]).toBe(1201); // primeira vez: os mais recentes
  });
});

describe("WhatsApp: assinatura no formato exato", () => {
  it("recusa lixo depois da assinatura válida", () => {
    const sig = signBody("{}", "s");
    expect(verifySignature("{}", sig, "s")).toBe(true);
    expect(verifySignature("{}", `${sig}zz`, "s")).toBe(false);
    expect(verifySignature("{}", ` ${sig}`, "s")).toBe(false);
  });
});
