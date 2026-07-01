import { registerProjectIpc } from './project.ipc'
import { registerModelIpc } from './model.ipc'
import { registerAiIpc } from './ai.ipc'
import { registerExportIpc } from './export.ipc'
import { registerMemoryIpc } from './memory.ipc'
import { registerAnalysisIpc } from './analysis.ipc'
import { registerAdaptationIpc } from './adaptation.ipc'
import { registerScriptIpc } from './script.ipc'
import { registerShotIpc } from './shot.ipc'
import { registerVideoIpc } from './video.ipc'
import { registerWritingRoomIpc } from './writing-room.ipc'
import { registerCreativeIpc } from './creative.ipc'
import { registerSecurityIpc } from './security.ipc'
import { registerDataBackupIpc } from './data-backup.ipc'
import { registerTaskIpc } from './task.ipc'
import { registerLogIpc } from './log.ipc'
import { registerDiagnosticIpc } from './diagnostic.ipc'
import { installIpcValidation } from './validation'

export function registerAllIpc(): void {
  installIpcValidation()
  registerSecurityIpc()
  registerDataBackupIpc()
  registerTaskIpc()
  registerLogIpc()
  registerDiagnosticIpc()
  registerProjectIpc()
  registerModelIpc()
  registerAiIpc()
  registerExportIpc()
  registerMemoryIpc()
  registerAnalysisIpc()
  registerAdaptationIpc()
  registerScriptIpc()
  registerShotIpc()
  registerVideoIpc()
  registerWritingRoomIpc()
  registerCreativeIpc()
}
