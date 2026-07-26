import assert from 'node:assert/strict'
import { deflateRawSync } from 'node:zlib'
import { test } from 'node:test'
import { parseSourceImportBuffer } from '../apps/desktop/electron/source-import'

interface ZipEntry {
  name: string
  content: string
  uncompressedSize?: number
}

function makeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const input = Buffer.from(entry.content)
    const compressed = deflateRawSync(input)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.uncompressedSize ?? input.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.uncompressedSize ?? input.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralSize = centralParts.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...centralParts, end])
}

test('parses UTF-16 TXT, preserves preface order, skips empty chapters, and flags long chapters', () => {
  const source = '# 归来\n作品前言\n\n第1章 归来\n林晚回到城市。\n\n第2章 空章\n\n第3章 反击\n' + '她赢了。'.repeat(7_000)
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source, 'utf16le')])
  const preview = parseSourceImportBuffer('归来.txt', buffer)
  assert.equal(preview.contentKind, 'novel')
  assert.deepEqual(preview.chapters.map((chapter) => chapter.title), ['前言', '第1章 归来', '第3章 反击'])
  assert.match(preview.chapters[0].content, /作品前言/)
  assert.ok(preview.warnings.some((warning) => warning.includes('空章节')))
  assert.ok(preview.warnings.some((warning) => warning.includes('正文较长')))
})

test('parses DOCX body text without touching the source file', () => {
  const docx = makeZip([{
    name: 'word/document.xml',
    content: '<w:document><w:body><w:p><w:r><w:t>第1章 Word 导入</w:t></w:r></w:p><w:p><w:r><w:t>正文一。</w:t></w:r></w:p><w:p><w:r><w:t>第2章 继续</w:t></w:r></w:p><w:p><w:r><w:t>正文二。</w:t></w:r></w:p></w:body></w:document>',
  }])
  const preview = parseSourceImportBuffer('样本.docx', docx)
  assert.equal(preview.sourceType, 'docx')
  assert.equal(preview.chapters.length, 2)
  assert.equal(preview.chapters[1].content, '正文二。')
})

test('parses EPUB spine in declared order', () => {
  const epub = makeZip([
    { name: 'META-INF/container.xml', content: '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>' },
    { name: 'OPS/book.opf', content: '<package><metadata><dc:title>EPUB 归来</dc:title></metadata><manifest><item id="a" href="a.xhtml"/><item id="b" href="b.xhtml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>' },
    { name: 'OPS/a.xhtml', content: '<html><body><h1>第一章</h1><p>先声明但后阅读。</p></body></html>' },
    { name: 'OPS/b.xhtml', content: '<html><body><h1>第二章</h1><p>spine 第一段。</p></body></html>' },
  ])
  const preview = parseSourceImportBuffer('样本.epub', epub)
  assert.equal(preview.sourceType, 'epub')
  assert.equal(preview.title, 'EPUB 归来')
  assert.deepEqual(preview.chapters.map((chapter) => chapter.title), ['第二章', '第一章'])
  assert.match(preview.chapters[0].content, /spine 第一段/)
})

test('parses only explicit script JSON and Markdown structures', () => {
  const json = parseSourceImportBuffer('剧本.json', Buffer.from(JSON.stringify({
    title: '反击剧本',
    episodes: [{ episodeNumber: 1, title: '归来', content: '林晚：我回来了。', scenes: [{ title: '场景 1｜客厅', location: '客厅', characters: ['林晚'], summary: '对峙', content: '林晚：我回来了。' }] }],
  })))
  assert.equal(json.contentKind, 'script')
  assert.equal(json.episodes[0].scenes[0].characters[0], '林晚')

  const markdown = parseSourceImportBuffer('剧本.md', Buffer.from('# 第1集：归来\n## 场景 1｜客厅，夜\n（林晚推门）\n林晚：我回来了。'))
  assert.equal(markdown.contentKind, 'script')
  assert.equal(markdown.episodes[0].scenes[0].dialogueCount, 1)
  assert.equal(markdown.episodes[0].scenes[0].actionCount, 1)

  const unknown = parseSourceImportBuffer('未知.json', Buffer.from('{"notes":"只是一段原始草稿"}'))
  assert.equal(unknown.contentKind, 'draft')
  assert.equal(unknown.episodes.length, 0)
  assert.match(unknown.warnings[0], /不会猜测/)
})

test('rejects a zip entry that advertises an unsafe expanded size', () => {
  const docx = makeZip([{ name: 'word/document.xml', content: '<w:document/>', uncompressedSize: 9 * 1024 * 1024 }])
  assert.throws(() => parseSourceImportBuffer('危险.docx', docx), /过大的条目/)
})

test('rejects text that exceeds the source import preview limit before any write is possible', () => {
  assert.throws(() => parseSourceImportBuffer('过大.txt', Buffer.from('正文'.repeat(800_000))), /正文过长/)
})
