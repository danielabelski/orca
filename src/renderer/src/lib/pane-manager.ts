import { Terminal } from '@xterm/xterm'
import type { ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface PaneManagerOptions {
  onPaneCreated?: (pane: ManagedPane) => void | Promise<void>
  onPaneClosed?: (paneId: number) => void
  onActivePaneChange?: (pane: ManagedPane) => void
  onLayoutChanged?: () => void
  terminalOptions?: (paneId: number) => Partial<ITerminalOptions>
  onLinkClick?: (url: string) => void
}

export interface PaneStyleOptions {
  splitBackground?: string
  paneBackground?: string
  inactivePaneOpacity?: number
  activePaneOpacity?: number
  opacityTransitionMs?: number
  dividerThicknessPx?: number
}

export interface ManagedPane {
  id: number
  terminal: Terminal
  container: HTMLElement // the .pane element
  fitAddon: FitAddon
  searchAddon: SearchAddon
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ManagedPaneInternal extends ManagedPane {
  xtermContainer: HTMLElement
  webglAddon: WebglAddon | null
  unicode11Addon: Unicode11Addon
  webLinksAddon: WebLinksAddon
}

// ---------------------------------------------------------------------------
// PaneManager
// ---------------------------------------------------------------------------

export type DropZone = 'top' | 'bottom' | 'left' | 'right'

export class PaneManager {
  private root: HTMLElement
  private panes: Map<number, ManagedPaneInternal> = new Map()
  private activePaneId: number | null = null
  private nextPaneId = 1
  private options: PaneManagerOptions
  private styleOptions: PaneStyleOptions = {}
  private destroyed = false

  // Drag-to-reorder state
  private dragSourcePaneId: number | null = null
  private dropOverlay: HTMLElement | null = null
  private currentDropTarget: { paneId: number; zone: DropZone } | null = null

  constructor(root: HTMLElement, options: PaneManagerOptions) {
    this.root = root
    this.options = options
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  createInitialPane(opts?: { focus?: boolean }): ManagedPane {
    const pane = this.createPaneInternal()

    // When the pane is the sole child of root (no splits), it must
    // fill the root container so FitAddon calculates correct dimensions.
    pane.container.style.width = '100%'
    pane.container.style.height = '100%'
    pane.container.style.position = 'relative'
    pane.container.style.overflow = 'hidden'

    // Place directly into root
    this.root.appendChild(pane.container)

    this.openTerminal(pane)

    this.activePaneId = pane.id
    this.applyPaneOpacity()

    if (opts?.focus !== false) {
      pane.terminal.focus()
    }

    void this.options.onPaneCreated?.(this.toPublic(pane))
    return this.toPublic(pane)
  }

  splitPane(
    paneId: number,
    direction: 'vertical' | 'horizontal',
    opts?: { ratio?: number }
  ): ManagedPane | null {
    const existing = this.panes.get(paneId)
    if (!existing) return null

    const newPane = this.createPaneInternal()

    const parent = existing.container.parentElement
    if (!parent) return null

    const isVertical = direction === 'vertical'

    // Capture the flex style of the element we're replacing BEFORE modifying it,
    // so the new split wrapper inherits its position in the parent flex layout.
    const existingFlex = existing.container.style.flex || ''
    const existingMinW = existing.container.style.minWidth || ''
    const existingMinH = existing.container.style.minHeight || ''

    // Create split container
    const split = document.createElement('div')
    split.className = `pane-split ${isVertical ? 'is-vertical' : 'is-horizontal'}`
    split.style.display = 'flex'
    split.style.flexDirection = isVertical ? 'row' : 'column'

    // If the existing pane was inside a flex parent (another split), inherit its
    // flex properties so the split wrapper occupies the same slot. Otherwise
    // (direct child of root) use full width/height.
    if (parent.classList.contains('pane-split')) {
      split.style.flex = existingFlex || '1 1 0%'
      split.style.minWidth = existingMinW || '0'
      split.style.minHeight = existingMinH || '0'
      split.style.overflow = 'hidden'
    } else {
      split.style.width = '100%'
      split.style.height = '100%'
    }

    // Create divider
    const divider = this.createDivider(isVertical)

    // Apply flex styles to existing pane container (child of the new split)
    this.applyPaneFlexStyle(existing.container)

    // Apply flex styles to new pane container
    this.applyPaneFlexStyle(newPane.container)

    // Apply custom ratio if provided (e.g. restoring a saved layout)
    const ratio = opts?.ratio
    if (ratio !== undefined && ratio > 0 && ratio < 1) {
      const firstGrow = ratio
      const secondGrow = 1 - ratio
      existing.container.style.flex = `${firstGrow} 1 0%`
      newPane.container.style.flex = `${secondGrow} 1 0%`
    }

    // Replace existing pane with split in the DOM
    parent.replaceChild(split, existing.container)

    // Build split: [existing] [divider] [new]
    split.appendChild(existing.container)
    split.appendChild(divider)
    split.appendChild(newPane.container)

    // Open terminal for new pane
    this.openTerminal(newPane)

    // Set new pane active
    this.activePaneId = newPane.id
    this.applyPaneOpacity()
    this.applyDividerStyles()

    if (newPane.terminal) {
      newPane.terminal.focus()
    }

    // Refit existing pane since it now shares space
    this.safeFit(existing)

    this.updateMultiPaneState()

    void this.options.onPaneCreated?.(this.toPublic(newPane))
    this.options.onLayoutChanged?.()

    return this.toPublic(newPane)
  }

  closePane(paneId: number): void {
    const pane = this.panes.get(paneId)
    if (!pane) return

    const paneContainer = pane.container
    const parent = paneContainer.parentElement
    if (!parent) return

    // Dispose terminal and addons
    this.disposePane(pane)

    if (parent.classList.contains('pane-split')) {
      // Find sibling (skip divider)
      const children = Array.from(parent.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement &&
          (child.classList.contains('pane') || child.classList.contains('pane-split'))
      )

      const sibling = children.find((c) => c !== paneContainer) ?? null

      // Remove pane element
      paneContainer.remove()

      // Remove divider(s)
      const dividers = Array.from(parent.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.classList.contains('pane-divider')
      )
      for (const d of dividers) d.remove()

      if (sibling) {
        // Unwrap: replace the split container with the sibling
        const grandparent = parent.parentElement
        if (grandparent) {
          if (grandparent === this.root) {
            // Going back to root level — fill the root container
            sibling.style.flex = ''
            sibling.style.minWidth = ''
            sibling.style.minHeight = ''
            sibling.style.width = '100%'
            sibling.style.height = '100%'
            sibling.style.position = 'relative'
            sibling.style.overflow = 'hidden'
          } else if (grandparent.classList.contains('pane-split')) {
            // Going into another split — inherit the flex slot from the
            // split container we're removing
            sibling.style.flex = parent.style.flex || '1 1 0%'
            sibling.style.minWidth = parent.style.minWidth || '0'
            sibling.style.minHeight = parent.style.minHeight || '0'
            sibling.style.overflow = 'hidden'
          }
          grandparent.replaceChild(sibling, parent)
        }
      } else {
        // No sibling left, just remove the split
        parent.remove()
      }
    } else {
      // Direct child of root (only pane) — just remove
      paneContainer.remove()
    }

    // Activate next pane if needed
    if (this.activePaneId === paneId) {
      const remaining = Array.from(this.panes.values())
      if (remaining.length > 0) {
        this.activePaneId = remaining[0].id
        remaining[0].terminal.focus()
      } else {
        this.activePaneId = null
      }
    }

    this.applyPaneOpacity()

    // Refit remaining panes
    for (const p of this.panes.values()) {
      this.safeFit(p)
    }

    this.updateMultiPaneState()
    this.options.onPaneClosed?.(paneId)
    this.options.onLayoutChanged?.()
  }

  getPanes(): ManagedPane[] {
    return Array.from(this.panes.values()).map((p) => this.toPublic(p))
  }

  getActivePane(): ManagedPane | null {
    if (this.activePaneId === null) return null
    const pane = this.panes.get(this.activePaneId)
    return pane ? this.toPublic(pane) : null
  }

  setActivePane(paneId: number, opts?: { focus?: boolean }): void {
    const pane = this.panes.get(paneId)
    if (!pane) return

    const changed = this.activePaneId !== paneId
    this.activePaneId = paneId
    this.applyPaneOpacity()

    if (opts?.focus !== false) {
      pane.terminal.focus()
    }

    if (changed) {
      this.options.onActivePaneChange?.(this.toPublic(pane))
    }
  }

  setPaneStyleOptions(opts: PaneStyleOptions): void {
    this.styleOptions = { ...opts }
    this.applyPaneOpacity()
    this.applyDividerStyles()
    this.applyRootBackground()
  }

  /**
   * Suspend GPU rendering for all panes. Disposes WebGL addons to free
   * GPU contexts while keeping Terminal instances alive (scrollback, cursor,
   * screen buffer all preserved). Call when this tab/worktree becomes hidden.
   */
  suspendRendering(): void {
    for (const pane of this.panes.values()) {
      if (pane.webglAddon) {
        try {
          pane.webglAddon.dispose()
        } catch {
          /* ignore */
        }
        pane.webglAddon = null
      }
    }
  }

  /**
   * Resume GPU rendering for all panes. Recreates WebGL addons. Call when
   * this tab/worktree becomes visible again. Must be followed by a fit() pass.
   */
  resumeRendering(): void {
    for (const pane of this.panes.values()) {
      if (!pane.webglAddon) {
        this.attachWebgl(pane)
      }
    }
  }

  destroy(): void {
    this.destroyed = true
    this.hideDropOverlay()
    for (const pane of this.panes.values()) {
      this.disposePane(pane)
    }
    this.root.innerHTML = ''
    this.activePaneId = null
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private createPaneInternal(): ManagedPaneInternal {
    const id = this.nextPaneId++

    // Create .pane container
    const container = document.createElement('div')
    container.className = 'pane'
    container.dataset.paneId = String(id)

    // Create .xterm-container
    const xtermContainer = document.createElement('div')
    xtermContainer.className = 'xterm-container'
    xtermContainer.style.width = '100%'
    xtermContainer.style.height = '100%'
    container.appendChild(xtermContainer)

    // Build terminal options
    const userOpts = this.options.terminalOptions?.(id) ?? {}
    const terminalOpts: ITerminalOptions = {
      allowProposedApi: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: '"SF Mono", Menlo, monospace',
      fontWeight: '300',
      fontWeightBold: '500',
      scrollback: 10000,
      allowTransparency: false,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: true,
      drawBoldTextInBrightColors: true,
      ...userOpts
    }

    const terminal = new Terminal(terminalOpts)
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const unicode11Addon = new Unicode11Addon()
    // URL tooltip element — Ghostty-style bottom-left hint on hover
    const linkTooltip = document.createElement('div')
    linkTooltip.className = 'pane-link-tooltip'
    linkTooltip.style.cssText =
      'display:none;position:absolute;bottom:4px;left:8px;z-index:40;' +
      'padding:2px 8px;border-radius:4px;font-size:11px;font-family:inherit;' +
      'color:#a1a1aa;background:rgba(24,24,27,0.85);border:1px solid rgba(63,63,70,0.6);' +
      'pointer-events:none;max-width:80%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    container.appendChild(linkTooltip)

    // Ghostty-style drag handle — appears at top of pane on hover when 2+ panes
    const dragHandle = document.createElement('div')
    dragHandle.className = 'pane-drag-handle'
    container.appendChild(dragHandle)
    this.attachPaneDrag(dragHandle, id)

    const webLinksAddon = new WebLinksAddon(
      this.options.onLinkClick ? (_event, uri) => this.options.onLinkClick!(uri) : undefined,
      {
        hover: (event, uri) => {
          if (event.type === 'mouseover' && uri) {
            linkTooltip.textContent = uri
            linkTooltip.style.display = ''
          } else {
            linkTooltip.style.display = 'none'
          }
        }
      }
    )

    const pane: ManagedPaneInternal = {
      id,
      terminal,
      container,
      xtermContainer,
      fitAddon,
      searchAddon,
      unicode11Addon,
      webLinksAddon,
      webglAddon: null
    }

    // Focus handler: clicking a pane makes it active and explicitly focuses
    // the terminal. We must call focus: true here because after DOM reparenting
    // (e.g. splitPane moves the original pane into a flex container), xterm.js's
    // native click-to-focus on its internal textarea may not fire reliably.
    container.addEventListener('pointerdown', () => {
      if (!this.destroyed && this.activePaneId !== id) {
        this.setActivePane(id, { focus: true })
      }
    })

    this.panes.set(id, pane)
    return pane
  }

  /** Open terminal into its container and load addons. Must be called after the container is in the DOM. */
  private openTerminal(pane: ManagedPaneInternal): void {
    const { terminal, xtermContainer, fitAddon, searchAddon, unicode11Addon, webLinksAddon } = pane

    // Open terminal into DOM
    terminal.open(xtermContainer)

    // Load addons (order matters: WebGL must be after open())
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(searchAddon)
    terminal.loadAddon(unicode11Addon)
    terminal.loadAddon(webLinksAddon)

    // Activate unicode 11
    terminal.unicode.activeVersion = '11'

    // Attach GPU renderer
    this.attachWebgl(pane)

    // Initial fit (deferred to ensure layout has settled)
    requestAnimationFrame(() => {
      this.safeFit(pane)
    })
  }

  private attachWebgl(pane: ManagedPaneInternal): void {
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
        pane.webglAddon = null
      })
      pane.terminal.loadAddon(webglAddon)
      pane.webglAddon = webglAddon
    } catch {
      // WebGL not available — default DOM renderer is fine
      pane.webglAddon = null
    }
  }

  private safeFit(pane: ManagedPaneInternal): void {
    try {
      pane.fitAddon.fit()
    } catch {
      // Container may not have dimensions yet
    }
  }

  private disposePane(pane: ManagedPaneInternal): void {
    try {
      pane.webglAddon?.dispose()
    } catch {
      /* ignore */
    }
    try {
      pane.searchAddon.dispose()
    } catch {
      /* ignore */
    }
    try {
      pane.unicode11Addon.dispose()
    } catch {
      /* ignore */
    }
    try {
      pane.webLinksAddon.dispose()
    } catch {
      /* ignore */
    }
    try {
      pane.fitAddon.dispose()
    } catch {
      /* ignore */
    }
    try {
      pane.terminal.dispose()
    } catch {
      /* ignore */
    }
    this.panes.delete(pane.id)
  }

  private applyPaneFlexStyle(el: HTMLElement): void {
    el.style.flex = '1 1 0%'
    el.style.minWidth = '0'
    el.style.minHeight = '0'
    el.style.position = 'relative'
    el.style.overflow = 'hidden'
    // Clear any fixed width/height from createInitialPane so flex sizing
    // controls the layout instead of the leftover 100% values.
    el.style.width = ''
    el.style.height = ''
  }

  private createDivider(isVertical: boolean): HTMLElement {
    const divider = document.createElement('div')
    divider.className = `pane-divider ${isVertical ? 'is-vertical' : 'is-horizontal'}`

    // Ghostty-style: the element itself is a wide transparent hit area for easy
    // grabbing. The visible line is drawn by a CSS ::after pseudo-element
    // (see main.css), so `background` on the element stays transparent.
    const hitSize = this.getDividerHitSize()
    if (isVertical) {
      divider.style.width = `${hitSize}px`
      divider.style.cursor = 'col-resize'
    } else {
      divider.style.height = `${hitSize}px`
      divider.style.cursor = 'row-resize'
    }
    divider.style.flex = 'none'
    divider.style.position = 'relative'

    this.attachDividerDrag(divider, isVertical)
    return divider
  }

  /** Total hit area size = visible thickness + invisible padding on each side */
  private getDividerHitSize(): number {
    const thickness = this.styleOptions.dividerThicknessPx ?? 4
    const HIT_PADDING = 3
    return thickness + HIT_PADDING * 2
  }

  private attachDividerDrag(divider: HTMLElement, isVertical: boolean): void {
    const MIN_PANE_SIZE = 50

    let dragging = false
    let didMove = false
    let startPos = 0
    let prevFlex = 0
    let nextFlex = 0
    let totalSize = 0
    let prevEl: HTMLElement | null = null
    let nextEl: HTMLElement | null = null

    const onPointerDown = (e: PointerEvent): void => {
      e.preventDefault()
      divider.setPointerCapture(e.pointerId)
      divider.classList.add('is-dragging')
      dragging = true
      didMove = false

      startPos = isVertical ? e.clientX : e.clientY

      // Find previous and next pane/split siblings
      prevEl = divider.previousElementSibling as HTMLElement | null
      nextEl = divider.nextElementSibling as HTMLElement | null

      if (!prevEl || !nextEl) return

      const prevRect = prevEl.getBoundingClientRect()
      const nextRect = nextEl.getBoundingClientRect()
      const prevSize = isVertical ? prevRect.width : prevRect.height
      const nextSize = isVertical ? nextRect.width : nextRect.height
      totalSize = prevSize + nextSize

      // Store current proportions as flex-basis values
      prevFlex = prevSize
      nextFlex = nextSize
    }

    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging || !prevEl || !nextEl) return
      didMove = true

      const currentPos = isVertical ? e.clientX : e.clientY
      const delta = currentPos - startPos

      let newPrev = prevFlex + delta
      let newNext = nextFlex - delta

      // Enforce minimum pane size
      if (newPrev < MIN_PANE_SIZE) {
        newPrev = MIN_PANE_SIZE
        newNext = totalSize - MIN_PANE_SIZE
      }
      if (newNext < MIN_PANE_SIZE) {
        newNext = MIN_PANE_SIZE
        newPrev = totalSize - MIN_PANE_SIZE
      }

      // Use flex-grow proportionally
      prevEl.style.flex = `${newPrev} 1 0%`
      nextEl.style.flex = `${newNext} 1 0%`

      // Refit terminals in affected panes
      this.refitPanesUnder(prevEl)
      this.refitPanesUnder(nextEl)
    }

    const onPointerUp = (e: PointerEvent): void => {
      if (!dragging) return
      dragging = false
      divider.releasePointerCapture(e.pointerId)
      divider.classList.remove('is-dragging')
      prevEl = null
      nextEl = null

      // Persist updated ratios after a real drag
      if (didMove) {
        this.options.onLayoutChanged?.()
      }
    }

    // Ghostty-style: double-click divider to equalize sibling panes
    const onDoubleClick = (): void => {
      const prev = divider.previousElementSibling as HTMLElement | null
      const next = divider.nextElementSibling as HTMLElement | null
      if (!prev || !next) return

      prev.style.flex = '1 1 0%'
      next.style.flex = '1 1 0%'

      this.refitPanesUnder(prev)
      this.refitPanesUnder(next)
      this.options.onLayoutChanged?.()
    }

    divider.addEventListener('pointerdown', onPointerDown)
    divider.addEventListener('pointermove', onPointerMove)
    divider.addEventListener('pointerup', onPointerUp)
    divider.addEventListener('dblclick', onDoubleClick)
  }

  // -----------------------------------------------------------------------
  // Drag-to-reorder
  // -----------------------------------------------------------------------

  /** Move a pane from its current position to a new position relative to a target pane. */
  movePane(sourcePaneId: number, targetPaneId: number, zone: DropZone): void {
    if (sourcePaneId === targetPaneId) return
    const source = this.panes.get(sourcePaneId)
    const target = this.panes.get(targetPaneId)
    if (!source || !target) return

    // 1. Detach source pane from the tree (without disposing its terminal)
    this.detachPaneFromTree(source)

    // 2. Insert source next to target in the requested zone
    this.insertPaneNextTo(source, target, zone)

    // 3. Refit all panes and persist
    for (const p of this.panes.values()) this.safeFit(p)
    this.applyPaneOpacity()
    this.applyDividerStyles()
    this.updateMultiPaneState()
    this.options.onLayoutChanged?.()
  }

  /**
   * Detach a pane's container from the split tree without disposing the terminal.
   * The sibling is promoted to take the split container's slot.
   */
  private detachPaneFromTree(pane: ManagedPaneInternal): void {
    const container = pane.container
    const parent = container.parentElement
    if (!parent) return

    if (!parent.classList.contains('pane-split')) {
      // Direct child of root — just remove it
      container.remove()
      return
    }

    // Find sibling (skip dividers)
    const children = Array.from(parent.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement &&
        (child.classList.contains('pane') || child.classList.contains('pane-split'))
    )
    const sibling = children.find((c) => c !== container) ?? null

    // Remove pane and dividers from the split
    container.remove()
    const dividers = Array.from(parent.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.classList.contains('pane-divider')
    )
    for (const d of dividers) d.remove()

    // Promote sibling to replace the split container
    if (sibling) {
      const grandparent = parent.parentElement
      if (grandparent) {
        if (grandparent === this.root) {
          sibling.style.flex = ''
          sibling.style.minWidth = ''
          sibling.style.minHeight = ''
          sibling.style.width = '100%'
          sibling.style.height = '100%'
          sibling.style.position = 'relative'
          sibling.style.overflow = 'hidden'
        } else if (grandparent.classList.contains('pane-split')) {
          sibling.style.flex = parent.style.flex || '1 1 0%'
          sibling.style.minWidth = parent.style.minWidth || '0'
          sibling.style.minHeight = parent.style.minHeight || '0'
          sibling.style.overflow = 'hidden'
        }
        grandparent.replaceChild(sibling, parent)
      }
    } else {
      parent.remove()
    }
  }

  /** Insert source pane next to target pane by wrapping target in a new split. */
  private insertPaneNextTo(
    source: ManagedPaneInternal,
    target: ManagedPaneInternal,
    zone: DropZone
  ): void {
    const targetContainer = target.container
    const parent = targetContainer.parentElement
    if (!parent) return

    const isVertical = zone === 'left' || zone === 'right'
    const sourceFirst = zone === 'left' || zone === 'top'

    // Capture target's flex slot
    const targetFlex = targetContainer.style.flex || ''
    const targetMinW = targetContainer.style.minWidth || ''
    const targetMinH = targetContainer.style.minHeight || ''

    // Create split wrapper
    const split = document.createElement('div')
    split.className = `pane-split ${isVertical ? 'is-vertical' : 'is-horizontal'}`
    split.style.display = 'flex'
    split.style.flexDirection = isVertical ? 'row' : 'column'

    if (parent.classList.contains('pane-split')) {
      split.style.flex = targetFlex || '1 1 0%'
      split.style.minWidth = targetMinW || '0'
      split.style.minHeight = targetMinH || '0'
      split.style.overflow = 'hidden'
    } else {
      split.style.width = '100%'
      split.style.height = '100%'
    }

    // Create divider
    const divider = this.createDivider(isVertical)

    // Apply flex styles to both panes
    this.applyPaneFlexStyle(source.container)
    this.applyPaneFlexStyle(targetContainer)

    // Replace target with the split in the DOM
    parent.replaceChild(split, targetContainer)

    // Build split: [first] [divider] [second]
    if (sourceFirst) {
      split.appendChild(source.container)
      split.appendChild(divider)
      split.appendChild(targetContainer)
    } else {
      split.appendChild(targetContainer)
      split.appendChild(divider)
      split.appendChild(source.container)
    }

    // Refit both
    requestAnimationFrame(() => {
      this.safeFit(source)
      this.safeFit(target)
    })
  }

  /** Attach drag-to-reorder handlers to a pane's drag handle. */
  private attachPaneDrag(handle: HTMLElement, paneId: number): void {
    let dragging = false
    let startX = 0
    let startY = 0
    const DRAG_THRESHOLD = 5

    const onPointerDown = (e: PointerEvent): void => {
      // Only start drag if there are 2+ panes
      if (this.panes.size < 2) return
      e.preventDefault()
      e.stopPropagation()
      handle.setPointerCapture(e.pointerId)
      startX = e.clientX
      startY = e.clientY
      dragging = false

      const onPointerMoveOuter = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (!dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD) {
          dragging = true
          this.dragSourcePaneId = paneId
          this.root.classList.add('is-pane-dragging')
          const sourcePane = this.panes.get(paneId)
          if (sourcePane) sourcePane.container.classList.add('is-drag-source')
          this.showDropOverlay()
        }
        if (dragging) {
          this.updateDropTarget(ev.clientX, ev.clientY)
        }
      }

      const onPointerUpOuter = (ev: PointerEvent): void => {
        handle.releasePointerCapture(ev.pointerId)
        handle.removeEventListener('pointermove', onPointerMoveOuter)
        handle.removeEventListener('pointerup', onPointerUpOuter)

        if (dragging) {
          this.root.classList.remove('is-pane-dragging')
          const sourcePane = this.panes.get(paneId)
          if (sourcePane) sourcePane.container.classList.remove('is-drag-source')

          // Execute the drop
          if (this.currentDropTarget && this.dragSourcePaneId !== null) {
            this.movePane(
              this.dragSourcePaneId,
              this.currentDropTarget.paneId,
              this.currentDropTarget.zone
            )
          }

          this.hideDropOverlay()
          this.dragSourcePaneId = null
          this.currentDropTarget = null
        }
      }

      handle.addEventListener('pointermove', onPointerMoveOuter)
      handle.addEventListener('pointerup', onPointerUpOuter)
    }

    handle.addEventListener('pointerdown', onPointerDown)
  }

  /** Determine which pane and zone the cursor is over, and position the overlay. */
  private updateDropTarget(clientX: number, clientY: number): void {
    const overlay = this.dropOverlay
    if (!overlay) return

    // Find which pane the cursor is over (excluding the source)
    let targetPane: ManagedPaneInternal | null = null
    for (const pane of this.panes.values()) {
      if (pane.id === this.dragSourcePaneId) continue
      const rect = pane.container.getBoundingClientRect()
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        targetPane = pane
        break
      }
    }

    if (!targetPane) {
      overlay.style.display = 'none'
      this.currentDropTarget = null
      return
    }

    const rect = targetPane.container.getBoundingClientRect()
    const relX = (clientX - rect.left) / rect.width
    const relY = (clientY - rect.top) / rect.height

    // Determine zone: which edge is the cursor closest to?
    const distTop = relY
    const distBottom = 1 - relY
    const distLeft = relX
    const distRight = 1 - relX
    const minDist = Math.min(distTop, distBottom, distLeft, distRight)

    let zone: DropZone
    if (minDist === distTop) zone = 'top'
    else if (minDist === distBottom) zone = 'bottom'
    else if (minDist === distLeft) zone = 'left'
    else zone = 'right'

    this.currentDropTarget = { paneId: targetPane.id, zone }

    // Position overlay to cover the target half
    overlay.style.display = ''
    const scrollX = window.scrollX
    const scrollY = window.scrollY

    switch (zone) {
      case 'top':
        overlay.style.left = `${rect.left + scrollX}px`
        overlay.style.top = `${rect.top + scrollY}px`
        overlay.style.width = `${rect.width}px`
        overlay.style.height = `${rect.height / 2}px`
        break
      case 'bottom':
        overlay.style.left = `${rect.left + scrollX}px`
        overlay.style.top = `${rect.top + scrollY + rect.height / 2}px`
        overlay.style.width = `${rect.width}px`
        overlay.style.height = `${rect.height / 2}px`
        break
      case 'left':
        overlay.style.left = `${rect.left + scrollX}px`
        overlay.style.top = `${rect.top + scrollY}px`
        overlay.style.width = `${rect.width / 2}px`
        overlay.style.height = `${rect.height}px`
        break
      case 'right':
        overlay.style.left = `${rect.left + scrollX + rect.width / 2}px`
        overlay.style.top = `${rect.top + scrollY}px`
        overlay.style.width = `${rect.width / 2}px`
        overlay.style.height = `${rect.height}px`
        break
    }
  }

  private showDropOverlay(): void {
    if (!this.dropOverlay) {
      const overlay = document.createElement('div')
      overlay.className = 'pane-drop-overlay'
      document.body.appendChild(overlay)
      this.dropOverlay = overlay
    }
    this.dropOverlay.style.display = 'none'
  }

  private hideDropOverlay(): void {
    if (this.dropOverlay) {
      this.dropOverlay.remove()
      this.dropOverlay = null
    }
  }

  /** Add/remove .has-multiple-panes on root to control drag handle visibility. */
  private updateMultiPaneState(): void {
    if (this.panes.size >= 2) {
      this.root.classList.add('has-multiple-panes')
    } else {
      this.root.classList.remove('has-multiple-panes')
    }
  }

  private refitPanesUnder(el: HTMLElement): void {
    // If the element is a pane, refit it
    if (el.classList.contains('pane')) {
      const paneId = Number(el.dataset.paneId)
      const pane = this.panes.get(paneId)
      if (pane) this.safeFit(pane)
      return
    }

    // If it's a split, refit all panes inside it
    if (el.classList.contains('pane-split')) {
      const paneEls = el.querySelectorAll('.pane[data-pane-id]')
      for (const paneEl of paneEls) {
        const paneId = Number((paneEl as HTMLElement).dataset.paneId)
        const pane = this.panes.get(paneId)
        if (pane) this.safeFit(pane)
      }
    }
  }

  private applyPaneOpacity(): void {
    const {
      activePaneOpacity = 1,
      inactivePaneOpacity = 1,
      opacityTransitionMs = 0
    } = this.styleOptions

    const transition = opacityTransitionMs > 0 ? `opacity ${opacityTransitionMs}ms ease` : ''

    for (const pane of this.panes.values()) {
      const isActive = pane.id === this.activePaneId
      pane.container.style.opacity = String(isActive ? activePaneOpacity : inactivePaneOpacity)
      pane.container.style.transition = transition
    }
  }

  private applyDividerStyles(): void {
    const thickness = this.styleOptions.dividerThicknessPx ?? 4
    const hitSize = this.getDividerHitSize()

    const dividers = this.root.querySelectorAll('.pane-divider')
    for (const div of dividers) {
      const el = div as HTMLElement
      const isVertical = el.classList.contains('is-vertical')
      if (isVertical) {
        el.style.width = `${hitSize}px`
      } else {
        el.style.height = `${hitSize}px`
      }
      // Store the visual thickness for the CSS ::after pseudo-element
      el.style.setProperty('--divider-thickness', `${thickness}px`)
    }
  }

  private applyRootBackground(): void {
    if (this.styleOptions.splitBackground) {
      this.root.style.background = this.styleOptions.splitBackground
    }
  }

  private toPublic(pane: ManagedPaneInternal): ManagedPane {
    return {
      id: pane.id,
      terminal: pane.terminal,
      container: pane.container,
      fitAddon: pane.fitAddon,
      searchAddon: pane.searchAddon
    }
  }
}
