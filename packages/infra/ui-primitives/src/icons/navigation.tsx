/** Generic navigation and status glyphs shared by application clients. */
import type { ReactNode } from 'react'
import type { IconProps } from './props.ts'

function outline(artwork: ReactNode, strokeWidth: number) {
  return function OutlineIcon({ size = 16, className }: IconProps) {
    return (
      <svg width={size} height={size} className={className} viewBox="0 0 16 16"
        fill="none" stroke="currentColor" strokeWidth={strokeWidth}
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {artwork}
      </svg>
    )
  }
}

const book = <><path d="M8 3.5C6.5 2.3 4 2 1.5 2.5v10C4 12 6.5 12.3 8 13.5c1.5-1.2 4-1.5 6.5-1v-10C12 2 9.5 2.3 8 3.5Z" /><path d="M8 3.5v10M4 5.5l2 .5M10 6l2-.5M4 8l2 .5M10 8.5l2-.5" /></>
const library = <><path d="M2 2v12M5 2v12M9 2l4 11M1 14h5M8 14h6" /></>
const film = <><rect x="1.5" y="2.5" width="13" height="11" rx="1" /><path d="M5 2.5v11M11 2.5v11M1.5 6h3.5M1.5 10H5M11 6h3.5M11 10h3.5" /></>
const clapperboard = <><path d="M2 6.5h12v7H2zM2 6.5 1 3l12-2 1 3.5ZM4 2.5 7 5M9 1.5l3 2.5" /></>
const chart = <><path d="M2 2v12h12M5 11V7M8.5 11V4M12 11V8" /></>
const bulb = <><path d="M5.5 10.5c0-2-2-2.5-2-5a4.5 4.5 0 0 1 9 0c0 2.5-2 3-2 5ZM5.5 13h5M7 15h2" /></>
const shieldCheck = <><path d="m8 1.5 5.5 2v4c0 3-2.5 5.5-5.5 7-3-1.5-5.5-4-5.5-7v-4Z" /><path d="m5 7.5 2 2 4-4" /></>
const layout = <><rect x="1.5" y="1.5" width="5" height="6" rx="1" /><rect x="9.5" y="1.5" width="5" height="3" rx="1" /><rect x="1.5" y="10.5" width="5" height="4" rx="1" /><rect x="9.5" y="7.5" width="5" height="7" rx="1" /></>
const leftClose = <><rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M5.5 2v12m5-9-3 3 3 3" /></>
const leftOpen = <><rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M5.5 2v12m3-9 3 3-3 3" /></>
const rightClose = <><rect x="1.5" y="2" width="13" height="12" rx="1" /><path d="M10.5 2v12m-5-9 3 3-3 3" /></>
const lock = <><rect x="3" y="7" width="10" height="7" rx="1" /><path d="M5 7V4a3 3 0 0 1 6 0v3M8 10v1.5" /></>
const arrowRight = <path d="M2 8h12m-5-5 5 5-5 5" />
const circle = <circle cx="8" cy="8" r="5.5" />
const userCheck = <><circle cx="6" cy="4.5" r="2.5" /><path d="M1.5 14v-1.5a4.5 4.5 0 0 1 9 0V14m0-6 1.5 1.5 3-3" /></>

export const IconBookOutlineRegular = outline(book, 1)
export const IconBookOutlineMedium = outline(book, 1.3)
export const IconLibraryOutlineRegular = outline(library, 1)
export const IconLibraryOutlineMedium = outline(library, 1.3)
export const IconFilmOutlineRegular = outline(film, 1)
export const IconFilmOutlineMedium = outline(film, 1.3)
export const IconClapperboardOutlineRegular = outline(clapperboard, 1)
export const IconClapperboardOutlineMedium = outline(clapperboard, 1.3)
export const IconChartOutlineRegular = outline(chart, 1)
export const IconChartOutlineMedium = outline(chart, 1.3)
export const IconLightbulbOutlineRegular = outline(bulb, 1)
export const IconLightbulbOutlineMedium = outline(bulb, 1.3)
export const IconShieldCheckOutlineRegular = outline(shieldCheck, 1)
export const IconShieldCheckOutlineMedium = outline(shieldCheck, 1.3)
export const IconLayoutOutlineRegular = outline(layout, 1)
export const IconLayoutOutlineMedium = outline(layout, 1.3)
export const IconPanelLeftCloseOutlineRegular = outline(leftClose, 1)
export const IconPanelLeftCloseOutlineMedium = outline(leftClose, 1.3)
export const IconPanelLeftOpenOutlineRegular = outline(leftOpen, 1)
export const IconPanelLeftOpenOutlineMedium = outline(leftOpen, 1.3)
export const IconPanelRightCloseOutlineRegular = outline(rightClose, 1)
export const IconPanelRightCloseOutlineMedium = outline(rightClose, 1.3)
export const IconLockOutlineRegular = outline(lock, 1)
export const IconLockOutlineMedium = outline(lock, 1.3)
export const IconArrowRightOutlineRegular = outline(arrowRight, 1)
export const IconArrowRightOutlineMedium = outline(arrowRight, 1.3)
export const IconCircleOutlineRegular = outline(circle, 1)
export const IconCircleOutlineMedium = outline(circle, 1.3)
export const IconUserCheckOutlineRegular = outline(userCheck, 1)
export const IconUserCheckOutlineMedium = outline(userCheck, 1.3)
