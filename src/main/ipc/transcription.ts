import { IPC } from '../../shared/ipc-channels.js'
import { loadSpeechModel, speechModelStatus } from '../transcription/speechModel.js'
import { handleIpc } from './guard.js'

export function registerTranscriptionHandlers(): void {
  handleIpc(IPC.transcription.speechModel, () => speechModelStatus())
  handleIpc(IPC.transcription.downloadSpeechModel, (e) =>
    loadSpeechModel((fraction) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.transcription.speechModelProgress, fraction)
    })
  )
}
