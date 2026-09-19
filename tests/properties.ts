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

  describe('mergeCommonKeys', () => {
    // Small key & value pools make shared key-value pairs likely.
    const key = fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f')
    const extraKey = fc.constantFrom('p', 'q', 'r')
    const scalar = fc.constantFrom('x', 'y', 0, 1, true, false, null)
    const value1 = fc.oneof(scalar, fc.array(scalar, { maxLength: 3 }))
    const value2 = fc.oneof(
      scalar,
      value1,
      fc.dictionary(key, value1, { maxKeys: 3 }),
      fc.array(value1, { maxLength: 3 })
    )
    const baseMap = fc.dictionary(key, value2, { minKeys: 3, maxKeys: 6 })

    // Groups of similar mappings: deep copies of a shared base map,
    // each extended with a few extra pairs.
    const group = fc
      .tuple(
        baseMap,
        fc.array(fc.dictionary(extraKey, value2, { maxKeys: 2 }), {
          minLength: 2,
          maxLength: 8
        })
      )
      .map(([base, extras]) =>
        extras.map(extra => Object.assign(structuredClone(base), extra))
      )

    // Groups of identical references, handled by aliasDuplicateObjects.
    const sharedGroup = fc
      .tuple(baseMap, fc.integer({ min: 2, max: 5 }))
      .map(([base, count]) => Array.from({ length: count }, () => base))

    const doc = fc.oneof(
      group,
      sharedGroup,
      fc.dictionary(key, group, { maxKeys: 3 }),
      fc.array(group, { maxLength: 2 }),
      fc.dictionary(key, value2, { maxKeys: 4 })
    )

    test('round-trip through parse with merge keys enabled', () => {
      const schemaOpt = fc.constantFrom<
        ({ version: '1.1' } | { merge: true })[]
      >({ version: '1.1' }, { merge: true })
      fc.assert(
        fc.property(doc, schemaOpt, (obj, opt) => {
          const str = stringify(obj, { ...opt, mergeCommonKeys: true })
          expect(parse(str, opt)).toStrictEqual(obj)
        }),
        { numRuns: 1000 }
      )
    })

    test('no effect without merge key support in the schema', () => {
      const schemaOpt = fc.constantFrom<{ schema?: 'json'; version?: '1.2' }[]>(
        {},
        { version: '1.2' },
        { schema: 'json' }
      )
      fc.assert(
        fc.property(doc, schemaOpt, (obj, opt) => {
          expect(stringify(obj, { ...opt, mergeCommonKeys: true })).toBe(
            stringify(obj, opt)
          )
        }),
        { numRuns: 500 }
      )
    })
  })
})
