import { Alias } from '../nodes/Alias.ts'
import { Pair } from '../nodes/Pair.ts'
import { Scalar } from '../nodes/Scalar.ts'
import type { Node } from '../nodes/types.ts'
import { YAMLMap } from '../nodes/YAMLMap.ts'
import { YAMLSeq } from '../nodes/YAMLSeq.ts'
import { YAMLSet } from '../nodes/YAMLSet.ts'
import type { Schema } from '../schema/Schema.ts'
import { merge } from '../schema/yaml-1.1/merge.ts'
import { anchorNames, findNewAnchor } from './anchors.ts'
import type { Document, DocValue } from './Document.ts'

/** The default minimum number of shared key-value pairs to extract. */
const defaultMinShared = 3

type MergeCommonKeysContext = {
  anchorPrefix: string
  anchors: Set<string>
  minShared: number
  schema: Schema
}

/**
 * Extract key-value pairs that are common to sibling mappings into anchored
 * mappings, and replace the extracted pairs with `<<` merge keys referring
 * to the corresponding anchor. The anchored mapping is placed within the
 * first mapping of each sibling group, so that each anchor is defined before
 * any alias referring to it.
 *
 * As merge keys are a YAML 1.1 feature, this does nothing unless the
 * document's schema supports them. The transformation preserves the
 * JavaScript value of each mapping: extracted pairs are deep-equal in all
 * mappings of a group, and pairs kept locally always take precedence over
 * merged-in values.
 */
export function mergeCommonKeys(
  doc: Document<DocValue, boolean>,
  root: Node | Pair | null,
  option: boolean | number,
  anchorPrefix?: string
): void {
  const { schema } = doc
  if (!schema.tags.some(tag => tag.tag === merge.tag && tag.default)) return
  const minShared =
    typeof option === 'number'
      ? Math.max(1, Math.floor(option))
      : defaultMinShared
  if (!(minShared >= 1)) return // NaN

  const anchors = anchorNames(doc)
  collectAnchors(root, anchors)
  const ctx: MergeCommonKeysContext = {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    anchorPrefix: anchorPrefix || 'a',
    anchors,
    minShared,
    schema
  }
  extractFromNode(root, ctx)
}

function collectAnchors(node: Node | Pair | null, anchors: Set<string>): void {
  if (!node) return
  if (node instanceof Pair) {
    collectAnchors(node.key, anchors)
    collectAnchors(node.value, anchors)
    return
  }
  if (node.anchor) anchors.add(node.anchor)
  if (node instanceof YAMLSeq) {
    for (const item of node) collectAnchors(item, anchors)
  } else if (node instanceof YAMLMap) {
    for (const pair of node.pairs()) collectAnchors(pair, anchors)
  } else if (node instanceof YAMLSet) {
    for (const item of node.values.values()) collectAnchors(item, anchors)
  }
}

function extractFromNode(
  node: Node | Pair | null,
  ctx: MergeCommonKeysContext
): void {
  if (!node) return
  if (node instanceof Pair) {
    extractFromNode(node.key, ctx)
    extractFromNode(node.value, ctx)
  } else if (node instanceof YAMLSeq) {
    if (!node.tag) extractFromMembers(membersOf(node), ctx)
    for (const item of node) extractFromNode(item, ctx)
  } else if (node instanceof YAMLMap) {
    if (!node.tag) extractFromMembers(membersOf(node), ctx)
    for (const pair of node.pairs()) extractFromNode(pair, ctx)
  } else if (node instanceof YAMLSet) {
    for (const item of node.values.values()) extractFromNode(item, ctx)
  }
}

/** The direct child mappings of a collection, in document order. */
function membersOf(coll: YAMLSeq | YAMLMap): YAMLMap[] {
  const members: YAMLMap[] = []
  if (coll instanceof YAMLSeq) {
    for (const item of coll) if (isPlainMap(item)) members.push(item)
  } else {
    for (const pair of coll.pairs())
      if (isPlainMap(pair.value)) members.push(pair.value)
  }
  return members
}

/**
 * A mapping may take part in merge key extraction only if it's a plain
 * mapping whose subtree contains no aliases, anchors, comments or merge
 * keys. Such subtrees may be freely restructured without changing their
 * JavaScript value or breaking references to them.
 */
function isPlainMap(node: unknown): node is YAMLMap {
  return node instanceof YAMLMap && !node.tag && isCleanTree(node)
}

function isCleanTree(node: Node | Pair | null): boolean {
  if (node === null) return true
  if (node instanceof Pair) {
    return isCleanTree(node.key) && isCleanTree(node.value)
  }
  if (node instanceof Alias) return false
  if (node.anchor || node.comment || node.commentBefore || node.spaceBefore)
    return false
  if (node instanceof YAMLSeq) return node.every(isCleanTree)
  if (node instanceof YAMLMap) {
    for (const pair of node.pairs()) {
      if (isMergeKey(pair.key)) return false
      if (!isCleanTree(pair.key) || !isCleanTree(pair.value)) return false
    }
  } else if (node instanceof YAMLSet) {
    for (const item of node.values.values())
      if (!isCleanTree(item)) return false
  }
  return true
}

const isMergeKey = (key: Node): boolean =>
  key instanceof Scalar && merge.identify(key.value)

/**
 * Greedily extract groups of key-value pairs shared by at least two of the
 * given sibling mappings. Each extraction removes pairs from the mappings,
 * so the loop is guaranteed to terminate.
 */
function extractFromMembers(
  members: YAMLMap[],
  ctx: MergeCommonKeysContext
): void {
  let start = 0
  while (members.length - start >= 2) {
    const first = members[start]
    let common = mapPairs(first)
    let subgroup: YAMLMap[] | null = null
    for (
      let i = start + 1;
      i < members.length && common.length >= ctx.minShared;
      ++i
    ) {
      const other = members[i]
      if (other === first || subgroup?.includes(other)) continue
      const rest = intersectPairs(common, other)
      if (rest.length >= ctx.minShared) {
        common = rest
        ;(subgroup ??= [first]).push(other)
      }
    }
    if (subgroup) {
      applyExtraction(subgroup, common, ctx)
      start = 0
    } else {
      start += 1
    }
  }
}

/** The non-merge-key pairs of a mapping, as `[mapKey, pair]` entries. */
function mapPairs(map: YAMLMap): [unknown, Pair][] {
  const pairs: [unknown, Pair][] = []
  for (const [mk, pair] of map.values)
    if (!isMergeKey(pair.key)) pairs.push([mk, pair])
  return pairs
}

/** The entries of `common` that have a deep-equal pair in `map`. */
function intersectPairs(
  common: [unknown, Pair][],
  map: YAMLMap
): [unknown, Pair][] {
  return common.filter(([mk, pair]) => {
    const other = map.values.get(mk)
    return (
      other !== undefined &&
      !isMergeKey(other.key) &&
      nodesEqual(pair.key, other.key) &&
      nodesEqual(pair.value, other.value)
    )
  })
}

function nodesEqual(a: Node | Pair | null, b: Node | Pair | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a instanceof Pair || b instanceof Pair) {
    return (
      a instanceof Pair &&
      b instanceof Pair &&
      nodesEqual(a.key, b.key) &&
      nodesEqual(a.value, b.value)
    )
  }
  if (a.constructor !== b.constructor || a.tag !== b.tag) return false
  if (a instanceof Scalar && b instanceof Scalar) {
    const av = a.value
    const bv = b.value
    return (
      av === bv ||
      (typeof av === 'number' &&
        typeof bv === 'number' &&
        Number.isNaN(av) &&
        Number.isNaN(bv))
    )
  }
  if (a instanceof YAMLSeq && b instanceof YAMLSeq) {
    return a.length === b.length && a.every((item, i) => nodesEqual(item, b[i]))
  }
  if (a instanceof YAMLMap && b instanceof YAMLMap) {
    if (a.values.size !== b.values.size) return false
    for (const [mk, pa] of a.values) {
      const pb = b.values.get(mk)
      if (!pb || !nodesEqual(pa.key, pb.key) || !nodesEqual(pa.value, pb.value))
        return false
    }
    return true
  }
  if (a instanceof YAMLSet && b instanceof YAMLSet) {
    if (a.values.size !== b.values.size) return false
    for (const [mk, na] of a.values) {
      const nb = b.values.get(mk)
      if (!nb || !nodesEqual(na, nb)) return false
    }
    return true
  }
  return false
}

/**
 * Replace the `common` pairs of each mapping in `subgroup` with a `<<` merge
 * key. The anchored mapping is defined within the first mapping of the
 * group, or is that mapping itself if it consists of exactly the common
 * pairs. Later mappings refer to it with an alias.
 */
function applyExtraction(
  subgroup: YAMLMap[],
  common: [unknown, Pair][],
  ctx: MergeCommonKeysContext
): void {
  const anchor = findNewAnchor(ctx.anchorPrefix, ctx.anchors)
  ctx.anchors.add(anchor)
  const first = subgroup[0]
  if (!first.anchor && first.values.size === common.length) {
    first.anchor = anchor
  } else {
    const anchorMap = new YAMLMap(ctx.schema)
    for (const [mk, pair] of common) {
      anchorMap.values.set(mk, pair)
      first.values.delete(mk)
    }
    anchorMap.anchor = anchor
    prependMergePair(first, anchorMap, ctx)
  }
  for (let i = 1; i < subgroup.length; ++i) {
    const map = subgroup[i]
    for (const [mk] of common) map.values.delete(mk)
    prependMergePair(map, new Alias(anchor), ctx)
  }
}

function prependMergePair(
  map: YAMLMap,
  value: YAMLMap | Alias,
  ctx: MergeCommonKeysContext
): void {
  // A Symbol('<<') key is resolved as a merge key, like when parsing.
  const pair = new Pair<Node, Node>(new Scalar(Symbol('<<')), value)
  map.values = new Map([[ctx.schema.mapKey(pair), pair], ...map.values])
}
