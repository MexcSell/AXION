/** The POST /missions body. `improve` is sent only when ticked (administrators; the server refuses anyone else). */
export function missionCreateBody(input: { text: string; shared: boolean; improve?: boolean }, fileIds: string[]) {
  return { text: input.text, files: fileIds, shared: input.shared, ...(input.improve ? { improve: true } : {}) };
}
