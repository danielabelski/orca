export type DropIndicator = 'left' | 'right' | null

// Why: the theme's accent color (#404040 in dark mode) is too subtle for a
// drag-and-drop insertion cue. Using a vivid blue matches VS Code's
// tab.dragAndDropBorder and is immediately visible against all tab backgrounds.
export function getDropIndicatorClasses(dropIndicator: DropIndicator): string {
  if (dropIndicator === 'left') {
    return "before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-blue-500 before:z-10 before:content-['']"
  }
  if (dropIndicator === 'right') {
    return "after:absolute after:inset-y-0 after:right-0 after:w-[2px] after:bg-blue-500 after:z-10 after:content-['']"
  }
  return ''
}
