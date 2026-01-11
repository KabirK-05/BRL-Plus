import { useToast } from '@chakra-ui/react'
import { useCallback } from 'react'

export const API_BASE_URL = 'http://localhost:6969'

export type FetchApiOptions = {
  errorTitle?: string
}

/**
 * Toast-backed API helper for talking to the Flask backend.
 * Usage:
 *   const { fetchApi } = useApi()
 *   const res = await fetchApi('/', { method: 'POST', body: formData })
 */
export function useApi() {
  const toast = useToast()

  const fetchApi = useCallback(async function fetchApi(
    path: string,
    options: RequestInit,
    { errorTitle = 'Error' }: FetchApiOptions = { errorTitle: 'Error' }
  ) {
    try {
      const response = await fetch(`${API_BASE_URL}${path}`, options)

      if (response.ok) {
        return response
      }

      // Try to parse backend error JSON: { error: string }
      try {
        const data = await response.json()
        const description =
          typeof data?.error === 'string' && data.error.length > 0
            ? data.error
            : response.statusText

        toast({
          title: errorTitle,
          description,
          status: 'error',
          duration: 5000,
          isClosable: true,
          position: 'bottom-right',
        })
      } catch {
        toast({
          title: errorTitle,
          description: response.statusText,
          status: 'error',
          duration: 5000,
          isClosable: true,
          position: 'bottom-right',
        })
      }
      return null
    } catch (err) {
      const description = err instanceof Error ? err.message : String(err)
      toast({
        title: errorTitle,
        description,
        status: 'error',
        duration: 5000,
        isClosable: true,
        position: 'bottom-right',
      })
      return null
    }
  }, [toast])

  return { fetchApi }
}


