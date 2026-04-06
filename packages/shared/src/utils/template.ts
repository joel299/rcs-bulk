/**
 * Substitui variáveis {{chave}} em um template de mensagem.
 * Variáveis disponíveis: {{nome}}, {{telefone}} + campos extras do contato.
 */
export function renderTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match
  })
}

/** Extrai todas as variáveis usadas em um template */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g)
  return [...new Set([...matches].map((m) => m[1]))]
}
