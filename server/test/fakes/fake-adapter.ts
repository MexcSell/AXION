/** A FAKE model adapter for tests only (c77). It returns canned text, records what it was asked, and never calls a model, a network or an SDK. */
export interface FakeEntryRef { model: string; family: string }
export class FakeAdapter {
  calls: { model: string; prompt: string }[] = [];
  complete(entry: FakeEntryRef, prompt: string): string {
    this.calls.push({ model: entry.model, prompt });
    return `[fake ${entry.family}/${entry.model}] ${prompt.length} chars`;
  }
}
