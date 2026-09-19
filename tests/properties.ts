import * as fc from 'fast-check'
import { parse, stringify } from 'yaml'

describe('properties', () => {
  test('parse stringified object', () => {
    const key = fc.fullUnicodeString()
    const values = [
      key,
      fc.lorem({ maxCount: 1000, mode: 'words' }),
      fc.lorem({ maxCount: 100, mode: 'sentences' }),
      fc.boolean(),
      fc.integer(),
      fc.double(),
      fc.constantFrom(null, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
    ]
    const yamlArbitrary = fc.anything({ key: key, values: values })
    const optionsArbitrary = fc.record(
      {
        mapAsMap: fc.constant(false),
        merge: fc.boolean(),
        schema: fc.constantFrom<('core' | 'yaml-1.1')[]>('core', 'yaml-1.1') // ignore 'failsafe', 'json'
      },
      { withDeletedKeys: true }
    )

    fc.assert(
      fc.property(yamlArbitrary, optionsArbitrary, (obj, opts) => {
        expect(parse(stringify(obj, opts), opts)).toStrictEqual(obj)
      })
    )
  })
})

describe('mergeCommonEntries', () => {
  const key = fc.fullUnicodeString()
  const values = [
    key,
    fc.lorem({ maxCount: 1000, mode: 'words' }),
    fc.lorem({ maxCount: 100, mode: 'sentences' }),
    fc.boolean(),
    fc.integer(),
    fc.double(),
    fc.constantFrom(null, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
  ]
  const yamlArbitrary = fc.anything({ key: key, values: values })

  test('round-trip of arbitrary values with merge: true', () => {
    fc.assert(
      fc.property(yamlArbitrary, obj => {
        const str = stringify(obj, { merge: true, mergeCommonEntries: true })
        expect(parse(str, { merge: true })).toStrictEqual(obj)
      })
    )
  })

  test('round-trip of arbitrary values with yaml-1.1 schema', () => {
    fc.assert(
      fc.property(yamlArbitrary, obj => {
        const str = stringify(obj, {
          schema: 'yaml-1.1',
          mergeCommonEntries: true
        })
        expect(parse(str, { schema: 'yaml-1.1' })).toStrictEqual(obj)
      })
    )
  })

  test('no effect when merge keys are not enabled', () => {
    fc.assert(
      fc.property(yamlArbitrary, obj => {
        expect(stringify(obj, { mergeCommonEntries: true })).toBe(
          stringify(obj)
        )
      })
    )
  })

  // Mappings built from a shared base, so that common entries actually exist
  const scalar = fc.oneof(
    fc.fullUnicodeString(),
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.constant(null)
  )
  const commonArb = fc.dictionary(key, scalar, { minKeys: 3, maxKeys: 8 })
  const nestedArb = fc.dictionary(key, scalar, { maxKeys: 4 })
  const extrasArb = fc.array(fc.dictionary(key, scalar, { maxKeys: 4 }), {
    minLength: 2,
    maxLength: 10
  })

  test('round-trip of mappings with common entries', () => {
    fc.assert(
      fc.property(commonArb, nestedArb, extrasArb, (common, nested, extras) => {
        const obj = extras.map(extra => ({
          ...structuredClone(common),
          shared: structuredClone(nested),
          ...extra
        }))
        const str = stringify(obj, { merge: true, mergeCommonEntries: true })
        expect(parse(str, { merge: true })).toStrictEqual(obj)
      }),
      { numRuns: 1000 }
    )
  })

  test('round-trip of nested mappings with common entries', () => {
    fc.assert(
      fc.property(commonArb, nestedArb, extrasArb, (common, nested, extras) => {
        const obj = {
          jobs: extras.map(extra => ({
            ...structuredClone(common),
            shared: structuredClone(nested),
            ...extra
          }))
        }
        const str = stringify(obj, {
          version: '1.1',
          mergeCommonEntries: true
        })
        expect(parse(str, { version: '1.1' })).toStrictEqual(obj)
      }),
      { numRuns: 1000 }
    )
  })
})
