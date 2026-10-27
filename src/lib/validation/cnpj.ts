/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * Normaliza um CNPJ: mantém só letras e números, em maiúsculas.
 * Desde julho/2026 a Receita emite CNPJ ALFANUMÉRICO (letras nas 12 primeiras posições; os 2 últimos são dígitos).
 */
export function normalizeCnpj(value: string): string {
  return value.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

/** Valida os dígitos verificadores do CNPJ, numérico ou alfanumérico (mesma regra usada no banco). */
export function isValidCnpj(value: string): boolean {
  const cnpj = normalizeCnpj(value);
  if (!/^[0-9A-Z]{12}\d{2}$/.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  // Valor de cada caractere = código ASCII - 48 (0-9 = 0-9; A = 17, B = 18, ...)
  const v = cnpj.split("").map((c) => c.charCodeAt(0) - 48);
  const calc = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const rest = weights.reduce((acc, w, i) => acc + v[i] * w, 0) % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === v[12] && calc(13) === v[13];
}

/** 12345678000195 -> 12.345.678/0001-95 ; 12ABC34501DE35 -> 12.ABC.345/01DE-35 */
export function formatCnpj(value: string): string {
  const c = normalizeCnpj(value);
  if (c.length !== 14) return value;
  return c.replace(/^(.{2})(.{3})(.{3})(.{4})(.{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Normaliza um número de WhatsApp brasileiro para o formato internacional só com dígitos.
 * "(11) 99999-8888" -> "5511999998888"; aceita o 0 de longa distância ("011 ...") e "0055".
 * Números com DDI diferente devem vir com "+". Retorna null se não for possível interpretar.
 */
export function normalizeWhatsapp(value: string): string | null {
  const trimmed = value.trim();
  let d = onlyDigits(trimmed);
  if (trimmed.startsWith("+")) return d.length >= 10 && d.length <= 15 && !/^0/.test(d) ? d : null;
  if (d.startsWith("00")) d = d.slice(2); // 0055...
  else if (d.startsWith("0")) d = d.slice(1); // 011...
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!((d.length === 12 || d.length === 13) && d.startsWith("55"))) return null;
  // DDD válido (11 a 99, sem zero) e número que não seja só zeros
  const ddd = d.slice(2, 4);
  if (!/^[1-9][1-9]$/.test(ddd) || /^0+$/.test(d.slice(4))) return null;
  return d;
}

/** 5511999998888 -> +55 (11) 99999-8888 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const d = onlyDigits(value);
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return `+${d}`;
}
