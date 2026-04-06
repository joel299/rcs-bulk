/**
 * Normaliza telefone para E.164 assumindo Brasil (+55) se não tiver código de país.
 * Aceita formatos: +5548999990001, 5548999990001, 48999990001, (48) 99999-0001
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')

  if (digits.length === 13 && digits.startsWith('55')) {
    return `+${digits}`
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    return `+${digits}`
  }
  if (digits.length === 11) {
    return `+55${digits}`
  }
  if (digits.length === 10) {
    return `+55${digits}`
  }
  if (raw.startsWith('+') && digits.length >= 10) {
    return `+${digits}`
  }

  return null
}

export function isValidPhone(raw: string): boolean {
  return normalizePhone(raw) !== null
}

/** Remove formatação para comparação/deduplicação */
export function canonicalPhone(raw: string): string {
  return raw.replace(/\D/g, '')
}
