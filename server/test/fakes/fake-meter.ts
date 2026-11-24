/** A FAKE meter for tests only (c77). It invents events from numbers the test gives it; it reads no real usage and calls nothing. */
export class FakeMeter {
  calls = 0;
  events(subject: string, unit: string, quantities: number[]) {
    return quantities.map((quantity) => { this.calls++; return { subject, unit, quantity, costMicros: quantity * 10, source: 'fake-meter' }; });
  }
}
