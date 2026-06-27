import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const INCLUDE = new Set(['.ts', '.tsx', '.js', '.json', '.md', '.css', '.yml', '.yaml'])
const SKIP = new Set(['.git', 'node_modules', 'dist', 'out'])

function extname(file) {
  const i = file.lastIndexOf('.')
  return i >= 0 ? file.slice(i) : ''
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, files)
    else if (INCLUDE.has(extname(entry.name))) files.push(path)
  }
  return files
}

const failures = []
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (/\s+$/.test(line)) failures.push(`${file}:${index + 1} trailing whitespace`)
  })
  if (text.length > 0 && !text.endsWith('\n')) failures.push(`${file}: missing final newline`)
}

if (failures.length) {
  console.error(failures.slice(0, 100).join('\n'))
  if (failures.length > 100) console.error(`... ${failures.length - 100} more`)
  process.exit(1)
}
