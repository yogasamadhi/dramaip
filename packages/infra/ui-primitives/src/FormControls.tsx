// FormControls: multi-line text, labeled field, native select and the Radix
// listbox select. Single-line text uses Input.

import {
  forwardRef, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { Select as SelectPrimitive } from 'radix-ui'
import clsx from 'clsx'
import { IconCheckOutlineRegular, IconChevronDownOutlineRegular } from './icons/index.tsx'
import css from './FormControls.module.css'

/** Render a multi-line text input; attributes pass through to the native textarea. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({
  className, ...props
}, ref) {
  return <textarea ref={ref} className={clsx(css.textarea, className)} {...props} />
})

/**
 * Render a labeled form field around one control.
 * @param props.label - localized label; `htmlFor` ties it to the control.
 * @param props.hint - helper text shown when there is no error.
 * @param props.error - validation message; replaces the hint.
 * @param props.required - marks the label as required.
 * @returns the field element.
 */
export function Field(props: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={clsx(css.field, props.className)}>
      <label htmlFor={props.htmlFor} className={css.label}>
        {props.label}
        {props.required ? <span className={css.required} aria-hidden="true">*</span> : null}
      </label>
      {props.children}
      {props.error
        ? <p className={css.error}>{props.error}</p>
        : props.hint ? <p className={css.hint}>{props.hint}</p> : null}
    </div>
  )
}

/**
 * Render a styled native select for forms that rely on platform select
 * semantics (combobox role, type-ahead, `selectOption` automation).
 */
export const NativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function NativeSelect({
  className, ...props
}, ref) {
  return <select ref={ref} className={clsx(css.native, className)} {...props} />
})

export type SelectOption = {
  value: string
  label: ReactNode
  group?: string
  disabled?: boolean
}

export type SelectProps = {
  options: readonly SelectOption[]
  value?: string
  defaultValue?: string
  placeholder?: string
  onValueChange?(value: string): void
  disabled?: boolean
  required?: boolean
  name?: string
  id?: string
  className?: string
  'aria-label'?: string
}

// Radix reserves the empty string for "no selection"; an empty option value
// rides this sentinel inside the listbox and maps back at the boundary.
const EMPTY = '\u0000empty'
const toItem = (value: string): string => value === '' ? EMPTY : value
const fromItem = (value: string): string => value === EMPTY ? '' : value

/**
 * Render a listbox select built on the Radix Select primitive.
 * @param props.options - options in display order; `group` gathers consecutive options under a label.
 * @param props.onValueChange - receives the chosen option value.
 * @returns the select trigger; the listbox portals above the page.
 */
export function Select({
  options, value, defaultValue, placeholder, onValueChange, disabled, required, name, id, className,
  'aria-label': ariaLabel,
}: SelectProps) {
  const groups: { label: string | undefined, options: SelectOption[] }[] = []
  for (const option of options) {
    const last = groups.at(-1)
    if (last !== undefined && last.label === option.group) last.options.push(option)
    else groups.push({ label: option.group, options: [option] })
  }
  return (
    <SelectPrimitive.Root
      {...(value !== undefined ? { value: toItem(value) } : {})}
      {...(defaultValue !== undefined ? { defaultValue: toItem(defaultValue) } : {})}
      {...(onValueChange ? { onValueChange: (next: string) => onValueChange(fromItem(next)) } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      {...(required !== undefined ? { required } : {})}
      {...(name !== undefined ? { name } : {})}
    >
      <SelectPrimitive.Trigger id={id} aria-label={ariaLabel} className={clsx(css.trigger, className)}>
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className={css.chevron}><IconChevronDownOutlineRegular /></SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className={css.content}>
          <SelectPrimitive.Viewport className={css.viewport}>
            {groups.map((group, index) => (
              <SelectPrimitive.Group key={`${group.label ?? ''}:${index}`}>
                {group.label !== undefined && <SelectPrimitive.Label className={css.groupLabel}>{group.label}</SelectPrimitive.Label>}
                {group.options.map(option => (
                  <SelectPrimitive.Item
                    key={option.value}
                    value={toItem(option.value)}
                    {...(option.disabled !== undefined ? { disabled: option.disabled } : {})}
                    className={css.item}
                  >
                    <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className={css.indicator}><IconCheckOutlineRegular /></SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                ))}
              </SelectPrimitive.Group>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}
