import { createContext, useContext } from 'react'
import type { TabContentType } from '../../../../shared/types'

export type SplitDropDirection = 'left' | 'right' | 'up' | 'down' | 'center'

export type TabDragData = {
  sourceGroupId: string
  unifiedTabId: string
  visibleId: string
  contentType: TabContentType
  worktreeId: string
  label: string
}

export type CrossGroupDragState = {
  activeTab: TabDragData | null
  overGroupId: string | null
  overTabBarIndex: number | null
  overSplitDirection: SplitDropDirection | null
}

export const GROUP_DROP_PREFIX = 'group-drop::'
export const GROUP_CONTENT_PREFIX = 'group-content::'

const EMPTY_DRAG_STATE: CrossGroupDragState = {
  activeTab: null,
  overGroupId: null,
  overTabBarIndex: null,
  overSplitDirection: null
}

export const CrossGroupDragStateContext = createContext<CrossGroupDragState>(EMPTY_DRAG_STATE)
export const CrossGroupDndContextPresent = createContext(false)

// Why: once split groups share a single DnD context, every sortable item must
// be globally unique across the whole workspace tree, not just within its tab
// strip. Prefixing the visible ID with the group ID preserves existing tab-bar
// ordering logic while letting dnd-kit distinguish same-entity tabs in
// different groups.
export function buildSharedSortableId(groupId: string, visibleId: string): string {
  return `${groupId}::${visibleId}`
}

export function parseSharedSortableId(id: string): { groupId: string; visibleId: string } | null {
  if (id.startsWith(GROUP_DROP_PREFIX) || id.startsWith(GROUP_CONTENT_PREFIX)) {
    return null
  }
  const separatorIndex = id.indexOf('::')
  if (separatorIndex <= 0) {
    return null
  }
  return {
    groupId: id.slice(0, separatorIndex),
    visibleId: id.slice(separatorIndex + 2)
  }
}

export function buildGroupDropId(groupId: string): string {
  return `${GROUP_DROP_PREFIX}${groupId}`
}

export function parseGroupDropId(id: string): { groupId: string } | null {
  return id.startsWith(GROUP_DROP_PREFIX) ? { groupId: id.slice(GROUP_DROP_PREFIX.length) } : null
}

export function buildGroupContentId(groupId: string): string {
  return `${GROUP_CONTENT_PREFIX}${groupId}`
}

export function parseGroupContentId(id: string): { groupId: string } | null {
  return id.startsWith(GROUP_CONTENT_PREFIX)
    ? { groupId: id.slice(GROUP_CONTENT_PREFIX.length) }
    : null
}

export function useCrossGroupDragState(): CrossGroupDragState {
  return useContext(CrossGroupDragStateContext)
}

export function useIsCrossGroupDndPresent(): boolean {
  return useContext(CrossGroupDndContextPresent)
}
