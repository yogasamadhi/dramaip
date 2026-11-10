// Surfaces: page and content containers (card, panel, toolbar, page header,
// disclosure). They carry layout and the theme's surface tokens only.

import type { HTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'
import css from './Surfaces.module.css'

/** Render a raised content card as an `<article>`. */
export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <article className={clsx(css.card, className)} {...props} />
}

/** Render a flat bordered region as a `<section>`. */
export function Panel({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={clsx(css.panel, className)} {...props} />
}

/** Render a horizontal row of actions with the toolbar role. */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="toolbar" className={clsx(css.toolbar, className)} {...props} />
}

/**
 * Render a page header.
 * @param props.eyebrow - small context line above the title.
 * @param props.actions - controls aligned to the end of the header.
 * @returns the header element; the title is the page's `<h1>`.
 */
export function PageHeader(props: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={clsx(css.header, props.className)}>
      <div className={css.heading}>
        {props.eyebrow ? <p className={css.eyebrow}>{props.eyebrow}</p> : null}
        <h1 className={css.title}>{props.title}</h1>
        {props.description ? <p className={css.description}>{props.description}</p> : null}
      </div>
      {props.actions ? <div className={css.actions}>{props.actions}</div> : null}
    </header>
  )
}

/**
 * Render a native `<details>` disclosure; keyboard behavior and the `open`
 * attribute stay the platform's.
 * @param props.summary - the always-visible summary row.
 * @returns the details element.
 */
export function Disclosure({ summary, summaryClassName, className, children, ...props }:
  Omit<HTMLAttributes<HTMLDetailsElement>, 'title'> & {
    summary: ReactNode
    summaryClassName?: string
    open?: boolean
  }) {
  return (
    <details className={clsx(css.disclosure, className)} {...props}>
      <summary className={clsx(css.summary, summaryClassName)}>{summary}</summary>
      <div className={css.body}>{children}</div>
    </details>
  )
}
