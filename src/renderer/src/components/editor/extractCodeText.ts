import React from 'react'

// Why: rehype-highlight replaces a fenced block's children with a nested tree
// of React span elements (one per token). To get the original plain source
// back — used as resetKey and the fallback view — we walk the tree and
// concatenate text nodes in order. The tree is small (bounded by block size)
// and the cost is negligible compared to the highlight work that produced it.
export function extractCodeText(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return ''
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map(extractCodeText).join('')
  }
  if (React.isValidElement(node)) {
    const childProps = node.props as { children?: React.ReactNode }
    return extractCodeText(childProps.children)
  }
  return ''
}
