// Blookberry AI: turns a short description into a Blook SVG with Claude, using
// real Blooks from public/blooks as the style guide.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 32000;
const MAX_PROMPT = 300;
const MAX_MATCHED = 3;
const MAX_SVG = 200 * 1024;

// The same few Blooks in every request, so this part of the prompt is cached.
const STYLE_GUIDE = ['chick', 'toast', 'penguin', 'happybot', 'frog', 'ghost', 'milk', 'unicorn'];

const RULES = `You design Blooks: the small, cute characters from Blooket. Every Blook is
drawn in the same house style, shown in the reference SVGs below. Study them
closely and match them: the canvas, the chunky rounded body that fills most of
it, flat colours with a few simple linear gradients, the darker underbelly band
along the bottom, large round eyes with white highlights, small simple mouths,
soft blush, and thick, clean shapes with no outlines unless the reference uses
them.

When asked for a Blook, reply with one complete SVG and nothing else:
- Start with <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 345"> and end with </svg>.
- Use only svg, g, defs, path, rect, circle, ellipse, polygon, polyline, line,
  linearGradient, radialGradient, stop and clipPath, with fill, stroke and
  opacity attributes (no style attributes, no <style> blocks, no classes).
- No text, no images, no scripts, no links, no animation.
- Keep it under about 120 shapes.
- Make it clearly the thing described, as a Blook, and make it charming.`;

const blooksDir = (root) => join(root, 'public', 'blooks');
const readBlook = (root, name) => readFileSync(join(blooksDir(root), `${name}.svg`), 'utf8');

// Blooks whose names share a word with the description, as extra examples.
function matchingBlooks(root, prompt) {
  const words = new Set(prompt.toLowerCase().match(/[a-z]{3,}/g) || []);
  if (!words.size || !existsSync(blooksDir(root))) return [];
  return readdirSync(blooksDir(root))
    .filter((f) => f.endsWith('.svg'))
    .map((f) => f.slice(0, -4))
    .filter((name) => !STYLE_GUIDE.includes(name) && [...words].some((w) => name.includes(w) || (name.length > 3 && w.includes(name))))
    .slice(0, MAX_MATCHED);
}

let styleGuide = null;
function systemBlocks(root) {
  if (!styleGuide) {
    const refs = STYLE_GUIDE.filter((n) => existsSync(join(blooksDir(root), `${n}.svg`)))
      .map((n) => `<reference name="${n}">\n${readBlook(root, n)}\n</reference>`).join('\n');
    styleGuide = `${RULES}\n\n<references>\n${refs}\n</references>`;
  }
  return [{ type: 'text', text: styleGuide, cache_control: { type: 'ephemeral' } }];
}

// Only plain drawing survives: anything that could run, load or link is removed.
const ALLOWED = new Set(['svg', 'g', 'defs', 'path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'lineargradient', 'radialgradient', 'stop', 'clippath']);
export function cleanSvg(text) {
  const start = text.indexOf('<svg');
  const end = text.lastIndexOf('</svg>');
  if (start < 0 || end < start) return null;
  let svg = text.slice(start, end + 6);
  if (svg.length > MAX_SVG) return null;
  svg = svg.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi, '');
  // Elements whose insides are not drawing go with everything inside them;
  // then any tag not on the list goes, so nothing else can run or load.
  svg = svg.replace(/<(script|style|foreignObject|text|title|desc|metadata|a|iframe|image|use)\b[\s\S]*?(<\/\1\s*>|\/>)/gi, '');
  svg = svg.replace(/<\/?([a-zA-Z][\w:-]*)\b[^>]*>/g, (whole, tag) => (ALLOWED.has(tag.toLowerCase()) ? whole : ''));
  // Event handlers, styles, and links anywhere but to this file's own gradients.
  svg = svg.replace(/\s(on\w+|style|class)\s*=\s*("[^"]*"|'[^']*')/gi, '');
  svg = svg.replace(/\s((?:xlink:)?href)\s*=\s*("[^"]*"|'[^']*')/gi, (whole, attr, value) => (/^["']#[\w-]+["']$/.test(value) ? whole : ''));
  svg = svg.replace(/url\(\s*(?!['"]?#)[^)]*\)/gi, 'none');
  if (!/^<svg\b/.test(svg) || !/<\/svg>$/.test(svg)) return null;
  if (!/\sxmlns=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  if (/xlink:/.test(svg) && !/xmlns:xlink=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace('<svg', '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  return svg;
}

export class AiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export const aiReady = () => !!process.env.ANTHROPIC_API_KEY;

// The SDK is only loaded when someone uses the AI, so the site starts without it.
let sdk = null;
async function anthropic() {
  if (sdk) return sdk;
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    sdk = { Anthropic, client: new Anthropic() };
  } catch {
    throw new AiError('Blookberry AI is not installed on this server yet.', 503);
  }
  return sdk;
}

export async function generateBlook(root, rawPrompt) {
  if (!aiReady()) throw new AiError('Blookberry AI is not switched on yet. The site owner needs to add an ANTHROPIC_API_KEY.', 503);
  const prompt = String(rawPrompt || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT);
  if (!prompt) throw new AiError('Describe the Blook you want first.', 400);
  const { Anthropic, client: api } = await anthropic();

  const matched = matchingBlooks(root, prompt);
  const extra = matched.length
    ? `These Blooks are related to the request, as extra examples:\n${matched.map((n) => `<reference name="${n}">\n${readBlook(root, n)}\n</reference>`).join('\n')}\n\n`
    : '';

  let message;
  try {
    const stream = api.beta.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Opus 5.5 always thinks; medium effort is its default, set here on purpose.
      output_config: { effort: 'medium' },
      // If a safety check declines the request, Anthropic retries it on a fitting model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: systemBlocks(root),
      messages: [{ role: 'user', content: `${extra}Make this Blook: ${prompt}` }],
    });
    message = await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new AiError('Blookberry AI has the wrong API key. The site owner needs to check ANTHROPIC_API_KEY.', 503);
    if (error instanceof Anthropic.RateLimitError) throw new AiError('Blookberry AI is busy. Try again in a minute.', 429);
    if (error instanceof Anthropic.APIError) throw new AiError(`Blookberry AI had a problem (${error.status ?? 'network'}). Try again.`, 502);
    throw new AiError('Blookberry AI could not be reached. Try again.', 502);
  }

  if (message.stop_reason === 'refusal') throw new AiError('Blookberry AI will not draw that one. Try describing something else.', 422);
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const svg = cleanSvg(text);
  if (!svg) {
    throw new AiError(message.stop_reason === 'max_tokens' ? 'That Blook got too big to finish. Try a simpler idea.' : 'Blookberry AI did not draw a Blook that time. Try again.', 502);
  }
  return { svg, prompt, references: matched, usage: message.usage };
}
