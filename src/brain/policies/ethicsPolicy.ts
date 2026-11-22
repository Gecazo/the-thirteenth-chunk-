// Deliberately conservative, supplementary to capability restrictions. No arbitrary model text is executable.
const toxic = /\b(?:fuck\w*|shit\w*|bitch\w*|kys|retard\w*|nigg\w*|fagg\w*|kill\s+yourself)\b/iu
const directive = /(?:^\s*[!/]|\b(?:ignore|override|bypass)\b.{0,34}\b(?:safety|policy|guard|instruction|rule)s?\b|\b(?:grief|dox|exfiltrate|attack|kill|steal|destroy|explode|op)\b)/iu
export function cleanText(input: string, limit: number): string | null {
  const value = input.normalize('NFKC').replace(/[\p{C}\p{Zl}\p{Zp}§]/gu, ' ').replace(/\s+/gu, ' ').trim()
  if (!value || toxic.test(value) || directive.test(value)) return null
  return value.slice(0, limit)
}
