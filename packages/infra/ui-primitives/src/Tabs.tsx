// Tabs: a tab set built on the Radix Tabs primitive. The parts keep the
// Radix props (value, onValueChange, activationMode, forceMount, asChild).

import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react'
import { Tabs as TabsPrimitive } from 'radix-ui'
import clsx from 'clsx'
import css from './Tabs.module.css'

const TabsList = forwardRef<ElementRef<typeof TabsPrimitive.List>, ComponentPropsWithoutRef<typeof TabsPrimitive.List>>(
  function TabsList({ className, ...props }, ref) {
    return <TabsPrimitive.List ref={ref} className={clsx(css.list, className)} {...props} />
  },
)

const TabsTrigger = forwardRef<ElementRef<typeof TabsPrimitive.Trigger>, ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>>(
  function TabsTrigger({ className, ...props }, ref) {
    return <TabsPrimitive.Trigger ref={ref} className={clsx(css.trigger, className)} {...props} />
  },
)

const TabsContent = forwardRef<ElementRef<typeof TabsPrimitive.Content>, ComponentPropsWithoutRef<typeof TabsPrimitive.Content>>(
  function TabsContent({ className, ...props }, ref) {
    return <TabsPrimitive.Content ref={ref} className={clsx(css.content, className)} {...props} />
  },
)

/** Tab set root with `Tabs.List`, `Tabs.Trigger` and `Tabs.Content` parts. */
export const Tabs = Object.assign(TabsPrimitive.Root, {
  List: TabsList,
  Trigger: TabsTrigger,
  Content: TabsContent,
})
