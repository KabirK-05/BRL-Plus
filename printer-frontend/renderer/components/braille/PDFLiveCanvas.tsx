import { Box, VStack } from '@chakra-ui/react'
import React, { useEffect, useRef, useState } from 'react'
import { useApi } from '../../lib/api'
import { DotPosition, DotPositions } from './types'

export type PDFLiveCanvasProps = {
  page: number
  dotPositions: DotPositions
  disablePolling?: boolean
}

export function PDFLiveCanvas({ page, dotPositions, disablePolling = false }: PDFLiveCanvasProps) {
  const { fetchApi } = useApi()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [currentDotPositions, setCurrentDotPositions] = useState<DotPosition[]>([])

  useEffect(() => {
    if (!canvasRef.current) return
    const canvas = canvasRef.current
    const dpr = 2 * (window.devicePixelRatio || 1)

    const displayWidth = boxRef.current?.clientWidth ?? 0
    const displayHeight = (11 / 8.5) * displayWidth

    canvas.width = displayWidth * dpr
    canvas.height = displayHeight * dpr
    canvas.style.width = `${displayWidth}px`
    canvas.style.height = `${displayHeight}px`

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, displayWidth, displayHeight)

    // Background
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, displayWidth, displayHeight)

    ctx.imageSmoothingEnabled = true

    const plotDot = (dot: DotPosition, color: string) => {
      ctx.strokeStyle = color
      ctx.lineWidth = 1

      const { x: mmX, y: mmY, punch } = dot
      const inX = mmX * 0.0393701
      const inY = mmY * 0.0393701
      const pxX = (inX * displayWidth) / 8.5
      const pxY = (inY * displayWidth) / 8.5

      ctx.fillStyle = punch ? color : 'white'

      ctx.beginPath()
      const radius = (0.0393701 * displayWidth) / 8.5
      ctx.arc(pxX, pxY, radius, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
    }

    const pageDots = dotPositions[page] ?? []
    for (const dot of pageDots) plotDot(dot, '#0F172A') // slate-ish
    for (const dot of currentDotPositions) plotDot(dot, '#EF4444') // red
  }, [page, dotPositions, currentDotPositions])

  useEffect(() => {
    setCurrentDotPositions([])
    if (disablePolling) return

    const interval = setInterval(async () => {
      const response = await fetchApi('/printed_dots', { method: 'POST' })
      if (response) {
        const data = await response.json()
        setCurrentDotPositions(data)
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [page, disablePolling, fetchApi])

  return (
    <VStack
      w="full"
      maxW="860px"
      h="65vh"
      overflow="hidden"
      borderWidth="1px"
      borderColor="glass.border"
      borderRadius="card"
      bg="glass.bg"
      sx={{
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
    >
      <Box w="full" h="full" ref={boxRef} overflow="auto" bg="rgba(255,255,255,0.75)">
        <canvas ref={canvasRef}>
          <p>Preview cannot be displayed.</p>
        </canvas>
      </Box>
    </VStack>
  )
}


