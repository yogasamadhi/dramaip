import 'react-native'
import React from 'react'
import { OverlayProvider } from '@gluestack-ui/overlay'
import { ToastProvider } from '@gluestack-ui/toast'

type GluestackUIProviderProps = {
  children: React.ReactNode
}

/**
 * Root provider scaffolded by `gluestack-ui` v5. It composes the overlay and
 * toast hosts that gluestack components (added via `npx gluestack-ui add`)
 * depend on. Color scheme is driven by NativeWind / the surrounding tree, so
 * this provider intentionally takes no theme props.
 */
export function GluestackUIProvider({ children }: GluestackUIProviderProps) {
  return (
    <OverlayProvider>
      <ToastProvider>{children}</ToastProvider>
    </OverlayProvider>
  )
}
