// DropdownMenu: a trigger-anchored action menu built on the Radix
// DropdownMenu primitive. Items carry `role="menuitem"` and the Radix
// `data-highlighted` / `data-state` attributes.

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { DropdownMenu as MenuPrimitive } from 'radix-ui'
import clsx from 'clsx'
import css from './DropdownMenu.module.css'

const DropdownContent = forwardRef<ElementRef<typeof MenuPrimitive.Content>, ComponentPropsWithoutRef<typeof MenuPrimitive.Content>>(
  function DropdownContent({ className, sideOffset = 7, ...props }, ref) {
    return (
      <MenuPrimitive.Portal>
        <MenuPrimitive.Content ref={ref} sideOffset={sideOffset} className={clsx(css.content, className)} {...props} />
      </MenuPrimitive.Portal>
    )
  },
)

const DropdownItem = forwardRef<ElementRef<typeof MenuPrimitive.Item>, ComponentPropsWithoutRef<typeof MenuPrimitive.Item>>(
  function DropdownItem({ className, ...props }, ref) {
    return <MenuPrimitive.Item ref={ref} className={clsx(css.item, className)} {...props} />
  },
)

const DropdownRadioItem = forwardRef<
  ElementRef<typeof MenuPrimitive.RadioItem>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.RadioItem>
>(function DropdownRadioItem({ className, ...props }, ref) {
  return <MenuPrimitive.RadioItem ref={ref} className={clsx(css.item, className)} {...props} />
})

const DropdownLabel = forwardRef<ElementRef<typeof MenuPrimitive.Label>, ComponentPropsWithoutRef<typeof MenuPrimitive.Label>>(
  function DropdownLabel({ className, ...props }, ref) {
    return <MenuPrimitive.Label ref={ref} className={clsx(css.label, className)} {...props} />
  },
)

const DropdownSeparator = forwardRef<
  ElementRef<typeof MenuPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.Separator>
>(function DropdownSeparator({ className, ...props }, ref) {
  return <MenuPrimitive.Separator ref={ref} className={clsx(css.separator, className)} {...props} />
})

const DropdownItemIndicator = forwardRef<
  ElementRef<typeof MenuPrimitive.ItemIndicator>,
  ComponentPropsWithoutRef<typeof MenuPrimitive.ItemIndicator>
>(function DropdownItemIndicator({ className, ...props }, ref) {
  return <MenuPrimitive.ItemIndicator ref={ref} className={clsx(css.indicator, className)} {...props} />
})

/** Action menu root with Trigger, Content, Item, Label, Separator and radio parts. */
export const DropdownMenu = Object.assign(
  (props: ComponentPropsWithoutRef<typeof MenuPrimitive.Root>) => <MenuPrimitive.Root {...props} />,
  {
    Trigger: MenuPrimitive.Trigger,
    Content: DropdownContent,
    Item: DropdownItem,
    Label: DropdownLabel,
    Separator: DropdownSeparator,
    RadioGroup: MenuPrimitive.RadioGroup,
    RadioItem: DropdownRadioItem,
    ItemIndicator: DropdownItemIndicator,
  },
)
