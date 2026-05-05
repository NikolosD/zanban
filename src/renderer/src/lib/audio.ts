export interface MicDevice {
  deviceId: string
  label: string
}

export async function enumerateMics(): Promise<MicDevice[]> {
  const list = await navigator.mediaDevices.enumerateDevices()
  return list
    .filter((d) => d.kind === 'audioinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label }))
}
