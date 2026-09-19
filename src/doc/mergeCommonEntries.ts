import { Alias } from '../nodes/Alias.ts'
import { isNode } from '../nodes/identity.ts'
import { Pair } from '../nodes/Pair.ts'
import { Scalar } from '../nodes/Scalar.ts'
import type { Node } from '../nodes/types.ts'
import { YAMLMap } from '../nodes/YAMLMap.ts'
import { YAMLSeq } from '../nodes/YAMLSeq.ts'
import { YAMLSet } from '../nodes/YAMLSet.ts'
import type { CreateNodeOptions } from '../options.ts'
import type { Schema } from '../schema/Schema.ts'
import { merge } from '../schema/yaml-1.1/merge.ts'
import { anchorNames, findNewAnchor } from './anchors.ts'
import type { Document, DocValue } from './Document.ts'

/** Default minimum number of common entries required for extraction. */
const defaultMinCommonEntries = 3

type ExtractionContext = {
  anchorPrefix: string
  minEntries: number
  schema: Schema
  takenAnchors: Set<string>
}

/**
 * Extract entries common to sibling mappings into anchored mappings, and
 * replace them in each source mapping with a `<<` merge key referencing the
 * anchor. Called during node creation when the `mergeCommonEntries` option
 * is enabled.
 *
 * The extraction never changes the resulting values: entries moved into the
 * anchored mapping are merged back into each source mapping, and any
 * remaining local entries override the merged ones. The anchored mapping is
 * placed within the merge value of the first mapping of each group, so that
 * its anchor is always defined before any alias to it in the document.
 *
 * Merge keys are a YAML 1.1 feature; if the schema does not support them,
 * this is a no-op.
 */
export function extractCommonEntries(
  root: Node,
  doc: Document<DocValue, boolean>,
  options: CreateNodeOptions
): void {
  const opt = options.mergeCommonEntries
  const minEntries = opt === true ? defaultMinCommonEntries : opt
  if (!minEntries || minEntries < 1) return

  const { schema } = doc
  const mergeKeysEnabled = schema.tags.some(
    tag => tag.tag === merge.tag && tag.default
  )
  if (!mergeKeysEnabled) return

  const takenAnchors = anchorNames(doc)
  for (const name of anchorNames(root)) takenAnchors.add(name)
  const ctx: ExtractionContext = {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    anchorPrefix: options.anchorPrefix || 'a',
    minEntries,
    schema,
    takenAnchors
  }
  processNode(root, ctx)
}

/**
 * Find groups of sibling mappings with common entries, deepest collections
 * first so that mappings created by the extraction are not re-processed.
 */
function processNode(node: Node, ctx: ExtractionContext): void {
  if (node instanceof YAMLSeq) {
    for (const item of node) if (isNode(item)) processNode(item, ctx)
    extractFromSiblings(node, ctx)
  } else if (node instanceof YAMLMap && !(node instanceof YAMLSet)) {
    for (const pair of node.values.values()) {
      if (isNode(pair.value)) processNode(pair.value, ctx)
    }
    extractFromSiblings(node, ctx)
  }
}

/**
 * Repeatedly extract the most valuable group of common entries among the
 * direct child mappings of `coll`, until no group shares enough entries.
 */
function extractFromSiblings(
  coll: YAMLSeq | YAMLMap,
  ctx: ExtractionContext
): void {
  const maps: YAMLMap[] = []
  if (coll instanceof YAMLSeq) {
    for (const item of coll) if (isPlainMap(item)) maps.push(item)
  } else {
    for (const pair of coll.values.values()) {
      if (isPlainMap(pair.value)) maps.push(pair.value)
    }
  }
  if (maps.length < 2) return

  for (;;) {
    const entries = maps.map(eligibleEntries)
    const indexes = entries.map(bucketize)
    let best: { common: Pair[]; members: YAMLMap[]; score: number } | null =
      null
    for (let i = 0; i < maps.length; ++i) {
      if (entries[i].length < ctx.minEntries) continue
      for (let j = i + 1; j < maps.length; ++j) {
        const common = entries[i].filter(pa => findEqual(indexes[j], pa))
        if (common.length < ctx.minEntries) continue
        const members = maps.filter((_, k) =>
          common.every(cp => findEqual(indexes[k], cp))
        )
        const score = common.length * (members.length - 1)
        if (!best || score > best.score) best = { common, members, score }
      }
    }
    if (!best) return
    applyExtraction(best.common, best.members, ctx)
  }
}

/**
 * Move the common entries of the first group member into a new anchored
 * mapping, drop them from each member, and prepend to each member a `<<`
 * merge key referencing the anchored mapping.
 */
function applyExtraction(
  common: Pair[],
  members: YAMLMap[],
  ctx: ExtractionContext
): void {
  const [first, ...rest] = members
  const moved: Pair[] = []
  for (const [mk, pair] of first.values) {
    if (common.some(cp => pairsEqual(cp, pair))) {
      first.values.delete(mk)
      moved.push(pair)
    }
  }
  const commonMap = new YAMLMap(ctx.schema, moved)
  commonMap.anchor = findNewAnchor(ctx.anchorPrefix, ctx.takenAnchors)
  ctx.takenAnchors.add(commonMap.anchor)
  prependMergePair(first, commonMap, ctx)

  const alias = new Alias(commonMap.anchor)
  for (const member of rest) {
    for (const [mk, pair] of member.values) {
      if (common.some(cp => pairsEqual(cp, pair))) member.values.delete(mk)
    }
    prependMergePair(member, alias.clone(), ctx)
  }
}

function prependMergePair(
  map: YAMLMap,
  value: Node, // the anchored common mapping, or an alias to it
  ctx: ExtractionContext
): void {
  const pair = new Pair(new Scalar('<<'), value)
  let mk: unknown = ctx.schema.mapKey(pair)
  if (map.values.has(mk)) mk = Symbol('<<')
  map.values = new Map([[mk, pair], ...map.values])
}

/** A mapping that may take part in common entry extraction. */
function isPlainMap(node: unknown): node is YAMLMap {
  return (
    node instanceof YAMLMap &&
    !(node instanceof YAMLSet) &&
    !node.tag &&
    !node.anchor
  )
}

/**
 * The entries of `map` that may be moved into a shared mapping: not merge
 * keys, and containing no anchors or aliases, so that moving them cannot
 * break the anchor-before-alias order of the document.
 */
function eligibleEntries(map: YAMLMap): Pair[] {
  const res: Pair[] = []
  for (const pair of map.values.values()) {
    if (isMergePairKey(pair.key)) continue
    if (!isNode(pair.key) || !isPortable(pair.key)) continue
    if (pair.value && !isPortable(pair.value)) continue
    res.push(pair)
  }
  return res
}

function isMergePairKey(key: unknown): boolean {
  return (
    key instanceof Scalar &&
    (!key.type || key.type === Scalar.PLAIN) &&
    merge.identify(key.value)
  )
}

/** True if the node's subtree contains no anchors or aliases. */
function isPortable(node: Node): boolean {
  if (node.anchor || node instanceof Alias) return false
  if (node instanceof YAMLSeq) {
    for (const item of node) {
      if (item instanceof Pair) {
        if (!isPortable(item.key) || (item.value && !isPortable(item.value)))
          return false
      } else if (isNode(item) && !isPortable(item)) return false
    }
  } else if (node instanceof YAMLMap) {
    for (const pair of node.values.values()) {
      if (!isPortable(pair.key) || (pair.value && !isPortable(pair.value)))
        return false
    }
  }
  return true
}

function pairsEqual(a: Pair, b: Pair): boolean {
  return nodesEqual(a.key, b.key) && nodesEqual(a.value, b.value)
}

function nodesEqual(a: Node | null, b: Node | null): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a instanceof Scalar && b instanceof Scalar) {
    return a.value === b.value && a.tag === b.tag
  }
  if (a instanceof YAMLSeq && b instanceof YAMLSeq) {
    if (a.tag !== b.tag || a.length !== b.length) return false
    for (let i = 0; i < a.length; ++i) {
      const ai = a[i]
      const bi = b[i]
      if (ai instanceof Pair || bi instanceof Pair) {
        if (!(ai instanceof Pair) || !(bi instanceof Pair)) return false
        if (!pairsEqual(ai, bi)) return false
      } else if (!nodesEqual(ai, bi)) return false
    }
    return true
  }
  if (
    a instanceof YAMLMap &&
    b instanceof YAMLMap &&
    a.constructor === b.constructor
  ) {
    if (a.tag !== b.tag || a.size !== b.size) return false
    const bPairs = b.values.values()
    for (const pa of a.values.values()) {
      const pb = bPairs.next()
      if (pb.done || !pairsEqual(pa, pb.value)) return false
    }
    return true
  }
  return false
}

/** Bucket index of pairs by key, used to speed up entry comparisons. */
type EntryIndex = Map<unknown, Pair[]>

const nonScalarKey = Symbol('non-scalar key')

function bucketize(pairs: Pair[]): EntryIndex {
  const index: EntryIndex = new Map()
  for (const pair of pairs) {
    const sig = keySignature(pair)
    const bucket = index.get(sig)
    if (bucket) bucket.push(pair)
    else index.set(sig, [pair])
  }
  return index
}

function keySignature({ key }: Pair): unknown {
  if (!(key instanceof Scalar)) return nonScalarKey
  const { value } = key
  return value !== null &&
    (typeof value === 'object' || typeof value === 'function')
    ? nonScalarKey
    : value
}

function findEqual(index: EntryIndex, pair: Pair): Pair | undefined {
  return index.get(keySignature(pair))?.find(p => pairsEqual(p, pair))
}
