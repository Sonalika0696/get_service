import type { Variants, Transition } from 'framer-motion';

/** Shared motion tokens, aligned with @sft/tokens durations/easings. */

export const spring: Transition = { type: 'spring', stiffness: 380, damping: 34 };

export const easeOut: Transition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] };

/** Container that staggers its children in on mount. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

/** A single item rising and fading into place. */
export const riseItem: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: easeOut },
};

/** Subtle press feedback for tappable cards and buttons. */
export const pressable = {
  whileHover: { y: -2 },
  whileTap: { scale: 0.98 },
  transition: spring,
};
