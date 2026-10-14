// The one place redaction patterns live. Add a pattern here and it applies to new ingests and to `rebuild`.
// Order matters: specific shapes first so a generic rule never leaves half of a recognised secret behind.

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement?: string;
}

export const patterns: RedactionPattern[] = [
  // Also matches JSON-escaped keys, where newlines appear as a literal backslash and n.
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  // A key cut off before its END line still gets its body removed.
  {
    name: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=\s\\]{20,}/g,
  },
  { name: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g },
  { name: 'bearer', pattern: /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'aws-secret', pattern: /aws_?secret_?(?:access_?)?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}/gi },
  { name: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{8,}/g },
  { name: 'openai', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g },
  { name: 'github', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { name: 'slack', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'google-api', pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { name: 'stripe', pattern: /\b[sr]k_live_[A-Za-z0-9]{16,}/g },
  {
    name: 'connection-string',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|rediss|amqps?|sqlserver):\/\/[^\s:@/]+:[^\s@/]+@[^\s"']+/gi,
  },
  { name: 'password-assignment', pattern: /\b(?:password|pwd)\s*=\s*[^;"'\r\n]+/gi },
  { name: 'azure-account-key', pattern: /\bAccountKey\s*=\s*[^;"'\s]+/gi },
  { name: 'azure-sas', pattern: /\bSharedAccessSignature\s*=\s*[^;"'\s]+/gi },
  { name: 'azure-sas', pattern: /[?&]sig=[A-Za-z0-9%+/=]{8,}/g },
  {
    name: 'generic-secret',
    pattern: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["']?[^\s"',;]{8,}/gi,
  },
];
