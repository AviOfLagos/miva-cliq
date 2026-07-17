/** Robust SSE reader: parses event:/data: lines across chunk boundaries. */
export async function readSSE(
  response: Response,
  onEvent: (event: string, data: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error("No response body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const flush = (raw: string) => {
    if (!raw.trim()) return;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      const clean = line.replace(/\r$/, "");
      if (clean.startsWith("event:")) {
        event = clean.slice(6).trim();
      } else if (clean.startsWith("data:")) {
        dataLines.push(clean.slice(5).replace(/^\s/, ""));
      }
    }
    if (dataLines.length) onEvent(event, dataLines.join("\n"));
  };

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    // Events are separated by a blank line (\n\n).
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      flush(raw);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) flush(buffer);
}