interface HastText {
  type: 'text'
  value: string
}

interface HastElement {
  type: 'element'
  tagName: string
  properties: Record<string, unknown>
  children: HastNode[]
}

type HastNode = HastText | HastElement | { type: string }

const isElement = (node: HastNode): node is HastElement => node.type === 'element'
const isText = (node: HastNode): node is HastText => node.type === 'text'

// Each line keeps its own "\n", so the text content of the block stays exactly
// the source and a copy never gains or loses a newline.
function splitLines(nodes: HastNode[]): HastNode[][] {
  const lines: HastNode[][] = [[]]
  for (const node of nodes) {
    if (isText(node)) {
      for (const piece of node.value.split(/(?<=\n)/)) {
        lines.at(-1)!.push({ type: 'text', value: piece })
        if (piece.endsWith('\n')) lines.push([])
      }
    } else if (isElement(node)) {
      splitLines(node.children).forEach((fragment, i) => {
        if (i > 0) lines.push([])
        if (fragment.length > 0) lines.at(-1)!.push({ ...node, children: fragment })
      })
    } else {
      lines.at(-1)!.push(node)
    }
  }
  return lines
}

function wrapLines(code: HastElement): void {
  const lines = splitLines(code.children)
  if (lines.at(-1)!.length === 0) lines.pop()
  const existing = code.properties.className
  code.properties.className = [...(Array.isArray(existing) ? existing : []), 'zb-code']
  code.children = lines.map((children) => ({
    type: 'element',
    tagName: 'span',
    properties: { className: ['zb-line'] },
    children
  }))
}

function visit(node: HastNode): void {
  if (!isElement(node)) return
  if (node.tagName === 'pre') {
    const code = node.children.find((child) => isElement(child) && child.tagName === 'code')
    if (code && isElement(code)) wrapLines(code)
    return
  }
  node.children.forEach(visit)
}

/** Wraps every line of a fenced code block in a `.zb-line` span, after syntax highlighting. */
export function rehypeCodeLines() {
  return (tree: HastNode): void => {
    if ('children' in tree) (tree as HastElement).children.forEach(visit)
  }
}
