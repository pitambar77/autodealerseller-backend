// Banner headings with line breaks and coloured words, stored as plain text pieces:
//   [{ text: 'Your next ride.\n' }, { text: 'Your deal.', color: '#F8D000' }, { text: ' Your way.' }]
// "\n" is a line break; a piece without a colour uses the banner's white. The website draws the pieces
// as text (never as HTML), so a heading can't inject markup. The same file is in the web app
// (src/config/heading.js): keep both copies identical.

/** Colours offered in the editor (any #rrggbb is also accepted). */
export const HEADING_COLORS = [
  { value: '', label: 'White' },
  { value: '#F8D000', label: 'Brand yellow' },
  { value: '#E8201C', label: 'Brand red' },
  { value: '#FB923C', label: 'Orange' },
  { value: '#34D399', label: 'Green' },
  { value: '#7DD3FC', label: 'Sky blue' },
  { value: '#CBD5E1', label: 'Light grey' },
];

export const HEADING_MAX_CHARS = 120;
export const HEADING_MAX_LINES = 4;

export const DEFAULT_HEADING = [{ text: 'Your next ride.\n' }, { text: 'Your deal.', color: '#F8D000' }, { text: ' Your way.' }];

const HEX = /^#[0-9a-f]{6}$/i;

/** The heading as plain text ("\n" for line breaks). */
export const headingText = (segments) => (Array.isArray(segments) ? segments.map((s) => s?.text || '').join('') : '');

/** True when there is something to show. */
export const hasHeading = (segments) => headingText(segments).trim().length > 0;

/**
 * Tidies a heading: keeps only text and valid colours, joins neighbouring pieces of the same colour,
 * removes blank lines at the start and end. Returns { segments, error } (error is a plain sentence).
 */
export function cleanHeading(input, { required = false } = {}) {
  if (input == null || (Array.isArray(input) && !input.length)) return required ? { segments: [], error: 'Write the heading.' } : { segments: [] };
  if (!Array.isArray(input) || input.length > 60) return { segments: [], error: 'The heading is not in the expected format.' };
  const out = [];
  for (const s of input) {
    // Plain characters only: no control characters except line breaks; tabs become spaces.
    const text = String(s?.text ?? '')
      .replace(/\r\n?/g, '\n')
      .replace(/\t/g, ' ')
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F\u200B-\u200F\u2028\u2029]/g, '');
    if (!text) continue;
    const color = typeof s?.color === 'string' && HEX.test(s.color) ? s.color.toUpperCase() : '';
    const last = out[out.length - 1];
    if (last && (last.color || '') === color) last.text += text;
    else out.push(color ? { text, color } : { text });
  }
  // Trim surrounding whitespace and line breaks, and collapse runs of blank lines.
  while (out.length && !out[0].text.replace(/^[\s\n]+/, '')) out.shift();
  if (out.length) out[0].text = out[0].text.replace(/^[\s\n]+/, '');
  while (out.length && !out[out.length - 1].text.replace(/[\s\n]+$/, '')) out.pop();
  if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/[\s\n]+$/, '');
  out.forEach((s) => (s.text = s.text.replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').replace(/ {2,}/g, ' ')));
  const text = headingText(out);
  if (required && !text.trim()) return { segments: [], error: 'Write the heading.' };
  if (text.replace(/\n/g, '').length > HEADING_MAX_CHARS) return { segments: out, error: `Keep the heading to ${HEADING_MAX_CHARS} characters so it fits on phones.` };
  if (text.split('\n').length > HEADING_MAX_LINES) return { segments: out, error: `Use at most ${HEADING_MAX_LINES} lines.` };
  return { segments: out };
}
