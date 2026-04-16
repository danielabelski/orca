export type DropIndicator = 'left' | 'right' | null

export function getDropIndicatorClasses(dropIndicator: DropIndicator): string {
  if (dropIndicator === 'left') {
    return "before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-accent before:content-['']"
  }
  if (dropIndicator === 'right') {
    return "after:absolute after:inset-y-1 after:right-0 after:w-0.5 after:rounded-full after:bg-accent after:content-['']"
  }
  return ''
}
