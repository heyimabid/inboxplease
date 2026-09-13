// Messenger text limits must never silently truncate verified facts or policy text.
export function replyChunks(text: string) {
  const chunks: string[] = [];
  let current = '';
  for (const character of text) {
    if (current.length + character.length > 1900) {
      chunks.push(current);
      current = '';
    }
    current += character;
  }
  if (current) chunks.push(current);
  return chunks;
}
