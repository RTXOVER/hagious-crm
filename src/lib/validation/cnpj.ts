/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Valida os dígitos verificadores do CNPJ (mesma regra usada no banco). */
export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const digits = cnpj.split("").map(Number);
  const calc = (length: number) => {
    const weights = length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + digits[i] * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calc(12) === digits[12] && calc(13) === digits[13];
}

/** 12345678000195 -> 12.345.678/0001-95 */
export function formatCnpj(value: string): string {
  const d = onlyDigits(value);
  if (d.length !== 14) return value;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Normaliza um número de WhatsApp brasileiro para o formato internacional só com dígitos.
 * "(11) 99999-8888" -> "5511999998888". Números com DDI diferente devem vir com "+".
 * Retorna null se não for possível interpretar.
 */
export function normalizeWhatsapp(value: string): string | null {
  const trimmed = value.trim();
  const d = onlyDigits(trimmed);
  if (trimmed.startsWith("+")) return d.length >= 10 && d.length <= 15 ? d : null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

/** 5511999998888 -> +55 (11) 99999-8888 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return "";
  const d = onlyDigits(value);
  const m = d.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  if (m) return `+55 (${m[1]}) ${m[2]}-${m[3]}`;
  return `+${d}`;
}
