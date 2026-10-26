import { describe, expect, it } from "vitest";
import { formatCnpj, formatPhone, isValidCnpj, normalizeWhatsapp } from "@/lib/validation/cnpj";
import { clientSchema, contactSchema, newUserSchema, passwordSchema } from "@/lib/validation/schemas";

describe("CNPJ", () => {
  it("aceita CNPJ válido com ou sem máscara", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000181")).toBe(true);
  });
  it("rejeita dígito verificador errado, tamanho errado e sequências repetidas", () => {
    expect(isValidCnpj("11.222.333/0001-82")).toBe(false);
    expect(isValidCnpj("1122233300018")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
    expect(isValidCnpj("")).toBe(false);
  });
  it("formata", () => {
    expect(formatCnpj("11222333000181")).toBe("11.222.333/0001-81");
  });
});

describe("WhatsApp", () => {
  it("normaliza números brasileiros para formato internacional", () => {
    expect(normalizeWhatsapp("(11) 99999-8888")).toBe("5511999998888");
    expect(normalizeWhatsapp("11 3333-4444")).toBe("551133334444");
    expect(normalizeWhatsapp("+55 11 99999-8888")).toBe("5511999998888");
    expect(normalizeWhatsapp("5511999998888")).toBe("5511999998888");
  });
  it("rejeita números incompletos", () => {
    expect(normalizeWhatsapp("9999-8888")).toBeNull();
    expect(normalizeWhatsapp("abc")).toBeNull();
  });
  it("formata para exibição", () => {
    expect(formatPhone("5511999998888")).toBe("+55 (11) 99999-8888");
  });
});

describe("Formulário de cliente", () => {
  const base = {
    legal_name: "Empresa Teste Ltda",
    trade_name: "",
    cnpj: "11.222.333/0001-81",
    tax_regime: "simples_nacional",
    status: "ativo",
    email: "",
    phone: "",
    address: "",
    notes: "",
    client_since: "",
  };

  it("normaliza campos vazios para null e CNPJ para dígitos", () => {
    const r = clientSchema.parse(base);
    expect(r.cnpj).toBe("11222333000181");
    expect(r.trade_name).toBeNull();
    expect(r.email).toBeNull();
    expect(r.phone).toBeNull();
  });
  it("aponta CNPJ inválido", () => {
    const r = clientSchema.safeParse({ ...base, cnpj: "11.222.333/0001-00" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["cnpj"]);
  });
  it("aponta e-mail e telefone inválidos", () => {
    const r = clientSchema.safeParse({ ...base, email: "sem-arroba", phone: "123" });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path[0]);
    expect(paths).toContain("email");
    expect(paths).toContain("phone");
  });
  it("rejeita regime fora da lista", () => {
    expect(clientSchema.safeParse({ ...base, tax_regime: "xpto" }).success).toBe(false);
  });
});

describe("Formulário de contato", () => {
  it("exige WhatsApp para registrar consentimento", () => {
    const r = contactSchema.safeParse({ name: "Ana", whatsapp: "", is_primary: false, whatsapp_opt_in: true });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["whatsapp_opt_in"]);
  });
  it("aceita contato completo", () => {
    const r = contactSchema.parse({ name: "Ana", whatsapp: "(11) 99999-8888", is_primary: true, whatsapp_opt_in: true });
    expect(r.whatsapp).toBe("5511999998888");
  });
});

describe("Equipe e senha", () => {
  it("colaborador precisa de departamento", () => {
    expect(newUserSchema.safeParse({ full_name: "Ana", email: "a@b.com", role: "colaborador", department: "" }).success).toBe(false);
    expect(newUserSchema.safeParse({ full_name: "Ana", email: "a@b.com", role: "gestor", department: "" }).success).toBe(true);
  });
  it("senha precisa de 10+ caracteres, letras e números, e confirmação igual", () => {
    expect(passwordSchema.safeParse({ password: "curta1", confirm: "curta1" }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "somenteletras", confirm: "somenteletras" }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "senhaforte123", confirm: "outra" }).success).toBe(false);
    expect(passwordSchema.safeParse({ password: "senhaforte123", confirm: "senhaforte123" }).success).toBe(true);
  });
});
