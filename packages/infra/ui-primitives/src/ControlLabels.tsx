// ControlLabels: the localized accessible names and default texts that the
// composite controls render (close buttons, confirm dialogs, loading states).
// The render site provides them once, above every composite control.

import { createContext, useContext, type ReactNode } from 'react'

/** Localized texts the composite controls render. */
export interface ControlLabels {
  /** Accessible name of a dialog's close button. */
  close: string
  /** Accessible name of a drawer's close button. */
  closeDrawer: string
  /** Accessible name of a toast's dismiss button. */
  dismiss: string
  /** Screen-reader name of one toast, and of the region that lists them. */
  notification: string
  notifications: string
  /** Default LoadingState text. */
  loading: string
  /** Confirm dialog: default title, confirm and cancel texts. */
  confirmTitle: string
  confirm: string
  cancel: string
  /** Confirm dialog with `tone: 'danger'`: default title and confirm text. */
  dangerTitle: string
  dangerConfirm: string
}

const LabelsContext = createContext<ControlLabels | null>(null)

/**
 * Provide the localized control texts to every composite control below.
 * @param props.labels - texts from the render site's language dictionary.
 * @returns the provider element.
 */
export function ControlLabelsProvider({ labels, children }: { labels: ControlLabels, children?: ReactNode }) {
  return <LabelsContext.Provider value={labels}>{children}</LabelsContext.Provider>
}

/**
 * Read the localized control texts.
 * @returns the texts from the nearest ControlLabelsProvider.
 * @throws when no provider is mounted: a composite control would otherwise render unnamed buttons.
 */
export function useControlLabels(): ControlLabels {
  const labels = useContext(LabelsContext)
  if (labels === null) throw new Error('ControlLabelsProvider is missing above a composite control')
  return labels
}
