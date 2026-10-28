// Write tools that already ran live in production with a checked read-back.
// Anything not listed here keeps the "not proven" notice in its description.
export const PRODUCTION_PROVEN: ReadonlySet<string> = new Set<string>(["merge_persons", "update_person", "attach_record"]);

export function describeWrite(name: string, text: string): string {
  return PRODUCTION_PROVEN.has(name) ? text : `${text} Ainda não provada em produção.`;
}
