export interface MicDevice {
  deviceId: string
  label: string
}

export async function enumerateMics(): Promise<MicDevice[]> {
  const list = await navigator.mediaDevices.enumerateDevices()
  // Chromium repeats the OS default (and, on Windows, the communications device)
  // as 'default' / 'communications' entries; pickers have their own default item.
  return list
    .filter(
      (d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'
    )
    .map((d) => ({ deviceId: d.deviceId, label: d.label }))
}
