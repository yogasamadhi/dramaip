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
import { registerSearchIpc } from './search.ipc'
import { registerAssetIpc } from './asset.ipc'
import { registerCloudAuthIpc } from './cloud-auth.ipc'
import { registerCloudHandoffIpc } from './cloud-handoff.ipc'
import { registerCloudSnapshotIpc } from './cloud-snapshot.ipc'
import { registerSourceImportIpc } from './source-import.ipc'
import { registerStoryBibleIpc } from './story-bible.ipc'
import { registerGenerationIpc } from './generation.ipc'
import { registerRightsIpc } from './rights.ipc'
import { registerVisualAssetIpc } from './visual-asset.ipc'
import { registerShotStillIpc } from './shot-still.ipc'
import { registerAnimaticIpc } from './animatic.ipc'
import { registerAudioIpc } from './audio.ipc'
import { registerEpisodeRenderIpc } from './episode-render.ipc'
import { registerEpisodeQualityIpc } from './episode-quality.ipc'
import { registerEpisodeComplianceIpc } from './episode-compliance.ipc'
import { registerPlatformDeliveryIpc } from './platform-delivery.ipc'
import { registerFeedbackIpc } from './feedback.ipc'
import { registerLocalizationIpc } from './localization.ipc'
import { installIpcValidation } from './validation'

export function registerAllIpc(): void {
  installIpcValidation()
  registerSecurityIpc()
  registerDataBackupIpc()
  registerTaskIpc()
  registerLogIpc()
  registerDiagnosticIpc()
  registerSearchIpc()
	registerAssetIpc()
	registerCloudAuthIpc()
	registerCloudHandoffIpc()
	registerCloudSnapshotIpc()
  registerProjectIpc()
  registerSourceImportIpc()
  registerStoryBibleIpc()
  registerGenerationIpc()
  registerRightsIpc()
  registerVisualAssetIpc()
  registerShotStillIpc()
  registerAnimaticIpc()
  registerAudioIpc()
  registerEpisodeRenderIpc()
  registerEpisodeQualityIpc()
  registerEpisodeComplianceIpc()
  registerPlatformDeliveryIpc()
  registerFeedbackIpc()
  registerLocalizationIpc()
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
