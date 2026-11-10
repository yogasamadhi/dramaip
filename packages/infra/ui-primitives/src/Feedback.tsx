// Feedback: empty, loading and inline notice states for a content region.

import type { ReactNode } from 'react'
import clsx from 'clsx'
import { useControlLabels } from './ControlLabels.tsx'
import {
  IconArchiveOutlineRegular, IconCheckCircleOutlineRegular, IconInfoOutlineRegular, IconLoadingOutlineRegular,
  IconWarningOutlineRegular,
} from './icons/index.tsx'
import css from './Feedback.module.css'

/**
 * Render the empty state of a region.
 * @param props.icon - replaces the default glyph.
 * @param props.action - one control that fills the region, e.g. a create button.
 * @returns the empty-state element.
 */
export function EmptyState(props: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={clsx(css.empty, props.className)}>
      <div className={css.emptyIcon} aria-hidden="true">{props.icon ?? <IconArchiveOutlineRegular size={20} />}</div>
      <h3 className={css.emptyTitle}>{props.title}</h3>
      {props.description ? <p className={css.emptyDescription}>{props.description}</p> : null}
      {props.action ? <div className={css.emptyAction}>{props.action}</div> : null}
    </div>
  )
}

/**
 * Render a loading status line.
 * @param props.label - replaces the provided `loading` text.
 * @returns the status element.
 */
export function LoadingState(props: { label?: string, className?: string }) {
  const labels = useControlLabels()
  return (
    <div role="status" className={clsx(css.loading, props.className)}>
      <IconLoadingOutlineRegular className={css.spinner} />
      {props.label ?? labels.loading}
    </div>
  )
}

export type InlineNoticeTone = 'info' | 'success' | 'warning' | 'danger'

const NOTICE_ICON = {
  info: IconInfoOutlineRegular,
  success: IconCheckCircleOutlineRegular,
  warning: IconWarningOutlineRegular,
  danger: IconWarningOutlineRegular,
} as const

/**
 * Render a notice inside the content flow. `danger` announces as an alert,
 * the other tones as a status.
 * @param props.tone - palette and glyph (default `info`).
 * @returns the notice element.
 */
export function InlineNotice({ tone = 'info', title, children, className }: {
  tone?: InlineNoticeTone
  title?: ReactNode
  children: ReactNode
  className?: string
}) {
  const Icon = NOTICE_ICON[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} data-tone={tone} className={clsx(css.notice, className)}>
      <Icon className={css.noticeIcon} />
      <div className={css.noticeBody}>
        {title ? <p className={css.noticeTitle}>{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  )
}
