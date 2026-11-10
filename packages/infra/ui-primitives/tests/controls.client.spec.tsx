// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  Button, ConfirmProvider, ControlLabelsProvider, Dialog, DropdownMenu, Field, IconButton, InlineNotice,
  LoadingState, Select, Tabs, Tag, ToastProvider, confirmDialog, showToast, type ControlLabels,
} from '@dramaip/infra-ui-primitives'

const labels: ControlLabels = {
  close: '关闭', closeDrawer: '关闭抽屉', dismiss: '关闭通知', notification: '通知', notifications: '通知列表',
  loading: '正在加载…', confirmTitle: '确认操作', confirm: '确认', cancel: '取消',
  dangerTitle: '确认危险操作', dangerConfirm: '确认继续',
}

const withLabels = (node: ReactNode) => <ControlLabelsProvider labels={labels}>{node}</ControlLabelsProvider>

beforeAll(() => {
  // Radix Select measures and scrolls its listbox; jsdom implements neither.
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(cleanup)

describe('Button variants', () => {
  it('defaults to a non-submitting secondary button', () => {
    render(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toMatch(/secondary/)
    expect(button.className).toMatch(/md/)
  })

  it('maps variant and size to their classes', () => {
    render(<Button variant="danger" size="sm">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button.className).toMatch(/danger/)
    expect(button.className).toMatch(/sm/)
  })

  it('loading disables the button and marks it busy', () => {
    render(<Button loading>Run</Button>)
    const button = screen.getByRole('button', { name: 'Run' })
    expect(button).toHaveProperty('disabled', true)
    expect(button.getAttribute('aria-busy')).toBe('true')
  })

  it('asChild merges the button styling onto the child element', () => {
    render(<Button asChild variant="primary"><a href="#x">Open</a></Button>)
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link.className).toMatch(/primary/)
  })

  it('IconButton takes its title from the accessible name', () => {
    render(<IconButton aria-label="More">…</IconButton>)
    expect(screen.getByRole('button', { name: 'More' }).getAttribute('title')).toBe('More')
  })
})

describe('Field', () => {
  it('ties the label to the control and shows the error over the hint', () => {
    render(<Field label="Name" htmlFor="n" hint="hint" error="required"><input id="n" /></Field>)
    expect(screen.getByLabelText('Name')).toBeDefined()
    expect(screen.getByText('required')).toBeDefined()
    expect(screen.queryByText('hint')).toBeNull()
  })
})

describe('Select', () => {
  it('opens from the keyboard and maps the empty option value back to ""', async () => {
    const onValueChange = vi.fn()
    render(
      <Select
        aria-label="Genre"
        value="drama"
        options={[{ value: '', label: 'Any' }, { value: 'drama', label: 'Drama' }]}
        onValueChange={onValueChange}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Genre' })
    expect(trigger.textContent).toContain('Drama')
    act(() => { trigger.focus() })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const option = await screen.findByRole('option', { name: 'Any' })
    fireEvent.click(option)
    expect(onValueChange).toHaveBeenCalledWith('')
  })
})

describe('Tabs', () => {
  it('moves selection with the arrow keys', async () => {
    render(
      <Tabs defaultValue="a">
        <Tabs.List aria-label="Views">
          <Tabs.Trigger value="a">A</Tabs.Trigger>
          <Tabs.Trigger value="b">B</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="a">first</Tabs.Content>
        <Tabs.Content value="b">second</Tabs.Content>
      </Tabs>,
    )
    const first = screen.getByRole('tab', { name: 'A' })
    expect(first.getAttribute('aria-selected')).toBe('true')
    act(() => { first.focus() })
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    const second = screen.getByRole('tab', { name: 'B' })
    // Radix moves focus on the next frame; automatic activation then selects it.
    await waitFor(() => { expect(document.activeElement).toBe(second) })
    await waitFor(() => { expect(second.getAttribute('aria-selected')).toBe('true') })
  })
})

describe('Dialog', () => {
  it('is labelled by its title, has a named close button and closes on Escape', async () => {
    const onOpenChange = vi.fn()
    render(withLabels(
      <Dialog defaultOpen onOpenChange={onOpenChange}>
        <Dialog.Content>
          <Dialog.Title>Rename</Dialog.Title>
          <Dialog.Description>Pick a new name.</Dialog.Description>
        </Dialog.Content>
      </Dialog>,
    ))
    const dialog = screen.getByRole('dialog', { name: 'Rename' })
    expect(screen.getByRole('button', { name: '关闭' })).toBeDefined()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => { expect(onOpenChange).toHaveBeenCalledWith(false) })
  })

  it('requires the control labels', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Dialog defaultOpen><Dialog.Content><Dialog.Title>x</Dialog.Title></Dialog.Content></Dialog>))
      .toThrow(/ControlLabelsProvider/)
    vi.mocked(console.error).mockRestore()
  })
})

describe('DropdownMenu', () => {
  it('opens from the keyboard and runs the chosen item', async () => {
    const onSelect = vi.fn()
    render(
      <DropdownMenu>
        <DropdownMenu.Trigger>Actions</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onSelect={onSelect}>Duplicate</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu>,
    )
    const trigger = screen.getByRole('button', { name: 'Actions' })
    act(() => { trigger.focus() })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('confirmDialog', () => {
  it('resolves false without a provider', async () => {
    await expect(confirmDialog('x')).resolves.toBe(false)
  })

  it('uses the danger texts and resolves with the choice', async () => {
    render(withLabels(<ConfirmProvider />))
    let answer!: Promise<boolean>
    act(() => { answer = confirmDialog({ description: 'Discard the draft?', tone: 'danger' }) })
    const dialog = await screen.findByRole('dialog', { name: '确认危险操作' })
    expect(dialog.textContent).toContain('Discard the draft?')
    fireEvent.click(screen.getByRole('button', { name: '确认继续' }))
    await expect(answer).resolves.toBe(true)
  })

  it('declines the open request when a newer one arrives', async () => {
    render(withLabels(<ConfirmProvider />))
    let first!: Promise<boolean>
    act(() => { first = confirmDialog('first') })
    act(() => { void confirmDialog('second') })
    await expect(first).resolves.toBe(false)
    expect(await screen.findByText('second')).toBeDefined()
  })
})

describe('showToast', () => {
  it('shows the message and runs the recovery action', async () => {
    const onAction = vi.fn()
    render(withLabels(<ToastProvider />))
    act(() => { showToast({ message: 'Moved to trash', actionLabel: 'Undo', onAction }) })
    expect(await screen.findByText('Moved to trash')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest three', async () => {
    render(withLabels(<ToastProvider />))
    act(() => { for (const n of [1, 2, 3, 4]) showToast({ message: `toast ${String(n)}` }) })
    expect(await screen.findByText('toast 4')).toBeDefined()
    expect(screen.queryByText('toast 1')).toBeNull()
  })
})

describe('status atoms', () => {
  it('LoadingState announces the provided loading text', () => {
    render(withLabels(<LoadingState />))
    expect(screen.getByRole('status').textContent).toContain('正在加载…')
  })

  it('InlineNotice announces danger as an alert', () => {
    render(<InlineNotice tone="danger">Failed</InlineNotice>)
    expect(screen.getByRole('alert').getAttribute('data-tone')).toBe('danger')
  })

  it('Tag passes span attributes through', () => {
    render(<Tag tone="success" title="healthy">OK</Tag>)
    expect(screen.getByText('OK').getAttribute('title')).toBe('healthy')
  })
})
