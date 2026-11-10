// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DocumentTitle } from '../src/client/DocumentTitle.tsx'

let originalTitle: string
beforeEach(() => { originalTitle = document.title })
afterEach(() => {
  try { cleanup() } finally { document.title = originalTitle }
})

describe('DocumentTitle', () => {
  it('projects the product title and restores it when unmounted', () => {
    document.title = 'stale title'
    const mounted = render(<DocumentTitle productTitle="Product" />)
    expect(document.title).toBe('Product')
    document.title = 'changed elsewhere'
    mounted.unmount()
    expect(document.title).toBe('Product')
  })

  it('follows a changed product title', () => {
    const mounted = render(<DocumentTitle productTitle="Product" />)
    mounted.rerender(<DocumentTitle productTitle="DramaIP 本地构建" />)
    expect(document.title).toBe('DramaIP 本地构建')
  })
})
