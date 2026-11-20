/** One spelling per person: trim, collapse inner spaces, Unicode NFC. The key is lower case (axor/u1 rule). */
export function normalizeName(raw: string): { display: string; key: string } {
  const display = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  return { display, key: display.toLocaleLowerCase('en-US') };
}
