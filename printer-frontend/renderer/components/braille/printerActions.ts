import { DotPosition } from './types'

export async function printDots(
  fetchApi: (path: string, options: RequestInit, opts?: { errorTitle?: string }) => Promise<Response | null>,
  dotPositions: DotPosition[],
  { demoMode }: { demoMode: boolean }
) {
  if (demoMode) {
    return null
  }
  return await fetchApi('/print_dots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dotPositions }),
  })
}

export async function stopPrint(
  fetchApi: (path: string, options: RequestInit, opts?: { errorTitle?: string }) => Promise<Response | null>,
  { demoMode }: { demoMode: boolean }
) {
  if (demoMode) return null
  return await fetchApi('/stop_print', { method: 'POST' })
}

export async function pausePrint(
  fetchApi: (path: string, options: RequestInit, opts?: { errorTitle?: string }) => Promise<Response | null>,
  { demoMode }: { demoMode: boolean }
) {
  if (demoMode) return null
  return await fetchApi('/pause_print', { method: 'POST' })
}

export async function resumePrint(
  fetchApi: (path: string, options: RequestInit, opts?: { errorTitle?: string }) => Promise<Response | null>,
  { demoMode }: { demoMode: boolean }
) {
  if (demoMode) return null
  return await fetchApi('/resume_print', { method: 'POST' })
}


