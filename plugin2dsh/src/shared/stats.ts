/**
 * Text statistics for a chapter or scene. Pure and dependency-free, so the
 * Host tool and the browser panel compute identical numbers.
 */

export interface TextStats {
  /** Non-whitespace characters. */
  readonly characters: number
  /** Han, Hiragana, Katakana and Hangul characters. */
  readonly cjkCharacters: number
  /** Runs of Latin letters or digits. */
  readonly latinWords: number
  /** Blocks separated by one or more blank lines. */
  readonly paragraphs: number
  /** Non-empty lines that carry a quoted utterance. */
  readonly dialogueLines: number
  /** Estimated silent-reading time, rounded up to whole minutes. */
  readonly readingMinutes: number
}

/** Characters per minute for CJK text and words per minute for Latin text. */
const CJK_PER_MINUTE = 400
const LATIN_PER_MINUTE = 200

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const LATIN_WORD = /[\p{Script=Latin}\p{Nd}]+(?:['’-][\p{Script=Latin}\p{Nd}]+)*/gu
const DIALOGUE = /“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/u

export function textStats(text: string): TextStats {
  const normalized = text.replace(/\r\n?/g, '\n')
  const characters = normalized.replace(/\s/gu, '').length
  const cjkCharacters = normalized.match(CJK)?.length ?? 0
  const latinWords = normalized.match(LATIN_WORD)?.length ?? 0
  const paragraphs = normalized.split(/\n\s*\n/u).filter((block) => block.trim() !== '').length
  const dialogueLines = normalized
    .split('\n')
    .filter((line) => line.trim() !== '' && DIALOGUE.test(line)).length
  const minutes = cjkCharacters / CJK_PER_MINUTE + latinWords / LATIN_PER_MINUTE
  return {
    characters,
    cjkCharacters,
    latinWords,
    paragraphs,
    dialogueLines,
    readingMinutes: minutes === 0 ? 0 : Math.ceil(minutes),
  }
}
