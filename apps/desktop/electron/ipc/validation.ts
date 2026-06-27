import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { validateIpcArgs } from '@sdns/core'

let installed = false

export function installIpcValidation(): void {
  if (installed) return
  installed = true

  const originalHandle = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    originalHandle(channel, (event, ...args) => listener(event, ...validateIpcArgs(channel, args)))) as typeof ipcMain.handle
}


