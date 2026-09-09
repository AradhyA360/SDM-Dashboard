import { useEffect, useRef } from 'react'
import { useMotionValue, useTransform, animate, motion } from 'framer-motion'

export default function CountUp({ value = 0, decimals = 0, duration = 0.9 }) {
  const numeric = typeof value === 'number' ? value : parseFloat(value) || 0
  const motionVal = useMotionValue(0)
  const rounded = useTransform(motionVal, (v) => v.toFixed(decimals))
  const prevValue = useRef(0)

  useEffect(() => {
    const controls = animate(motionVal, numeric, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    })
    prevValue.current = numeric
    return controls.stop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric])

  return <motion.span>{rounded}</motion.span>
}
