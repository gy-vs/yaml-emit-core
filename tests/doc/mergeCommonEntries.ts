import type { DocumentOptions, SchemaOptions, YAMLMap, YAMLSeq } from 'yaml'
import { Document, parse, parseDocument, stringify } from 'yaml'

const jobs = () => [
  { name: 'build', image: 'app:1.2', env: 'prod', retries: 3 },
  { name: 'test', image: 'app:1.2', env: 'prod', retries: 3 },
  { name: 'deploy', image: 'app:1.2', env: 'prod', retries: 3 }
]

const jobsYaml = `- <<: &a1
    image: app:1.2
    env: prod
    retries: 3
  name: build
- <<: *a1
  name: test
- <<: *a1
  name: deploy
`

describe('sequence of mappings', () => {
  test('exact output', () => {
    const str = stringify(jobs(), { merge: true, mergeCommonEntries: true })
    expect(str).toBe(jobsYaml)
  })

  test('anchor is defined before its aliases', () => {
    const str = stringify(jobs(), { merge: true, mergeCommonEntries: true })
    expect(str.indexOf('&a1')).toBeLessThan(str.indexOf('*a1'))
  })

  test('round-trip', () => {
    const str = stringify(jobs(), { merge: true, mergeCommonEntries: true })
    expect(parse(str, { merge: true })).toStrictEqual(jobs())
  })

  test('doc.toJS()', () => {
    const doc = new Document(jobs(), {
      merge: true,
      mergeCommonEntries: true
    })
    expect(doc.toJS()).toStrictEqual(jobs())
    expect(String(doc)).toBe(jobsYaml)
  })

  test('local entries override merged ones', () => {
    const value = [
      { name: 'a', image: 'app', env: 'prod', retries: 3, cpu: 1 },
      { name: 'b', image: 'app', env: 'prod', retries: 5, cpu: 1 },
      { name: 'c', image: 'app', env: 'prod', retries: 3, cpu: 2 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a1
    image: app
    env: prod
    cpu: 1
  name: a
  retries: 3
- <<: *a1
  name: b
  retries: 5
- name: c
  image: app
  env: prod
  retries: 3
  cpu: 2
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })

  test('mapping with only common entries', () => {
    const value = [
      { a: 1, b: 2, c: 3, d: 4 },
      { a: 1, b: 2, c: 3, d: 4 },
      { a: 9, b: 8, c: 7, d: 6 },
      { a: 9, b: 8, c: 7, d: 6 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a1
    a: 1
    b: 2
    c: 3
    d: 4
- <<: *a1
- <<: &a2
    a: 9
    b: 8
    c: 7
    d: 6
- <<: *a2
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })

  test('flow style', () => {
    const str = stringify(jobs(), {
      merge: true,
      mergeCommonEntries: true,
      collectionStyle: 'flow'
    })
    expect(str).toBe(`[
  { <<: &a1 { image: app:1.2, env: prod, retries: 3 }, name: build },
  { <<: *a1, name: test },
  { <<: *a1, name: deploy }
]
`)
    expect(parse(str, { merge: true })).toStrictEqual(jobs())
  })
})

describe('mapping values', () => {
  const byName = () => ({
    build: { image: 'app', env: 'prod', retries: 3, cmd: 'make' },
    test: { image: 'app', env: 'prod', retries: 3, cmd: 'npm t' },
    deploy: { image: 'app', env: 'prod', retries: 3, cmd: 'ship' }
  })

  test('exact output', () => {
    const str = stringify(byName(), { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`build:
  <<: &a1
    image: app
    env: prod
    retries: 3
  cmd: make
test:
  <<: *a1
  cmd: npm t
deploy:
  <<: *a1
  cmd: ship
`)
  })

  test('round-trip', () => {
    const str = stringify(byName(), { merge: true, mergeCommonEntries: true })
    expect(parse(str, { merge: true })).toStrictEqual(byName())
  })
})

describe('nested common values', () => {
  const value = () => [
    {
      name: 'a',
      resources: { cpu: 1, mem: 2 },
      image: 'app',
      env: 'prod',
      retries: 3
    },
    {
      name: 'b',
      resources: { cpu: 1, mem: 2 },
      image: 'app',
      env: 'prod',
      retries: 3
    }
  ]

  test('exact output', () => {
    const str = stringify(value(), { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a1
    resources:
      cpu: 1
      mem: 2
    image: app
    env: prod
    retries: 3
  name: a
- <<: *a1
  name: b
`)
  })

  test('round-trip', () => {
    const str = stringify(value(), { merge: true, mergeCommonEntries: true })
    expect(parse(str, { merge: true })).toStrictEqual(value())
  })

  test('differently ordered nested maps are not merged', () => {
    const value = [
      { env: { A: 1, B: 2 }, x: 1, y: 2, z: 3 },
      { env: { B: 2, A: 1 }, x: 1, y: 2, z: 3 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a1
    x: 1
    y: 2
    z: 3
  env:
    A: 1
    B: 2
- <<: *a1
  env:
    B: 2
    A: 1
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })
})

describe('minimum common entries', () => {
  const two = () => [
    { a: 1, b: 2, x: 0 },
    { a: 1, b: 2, y: 0 }
  ]

  test('two common entries are not extracted by default', () => {
    const str = stringify(two(), { merge: true, mergeCommonEntries: true })
    expect(str).toBe(stringify(two(), { merge: true }))
  })

  test('configurable with a number', () => {
    const str = stringify(two(), { merge: true, mergeCommonEntries: 2 })
    expect(str).toBe(`- <<: &a1
    a: 1
    b: 2
  x: 0
- <<: *a1
  y: 0
`)
    expect(parse(str, { merge: true })).toStrictEqual(two())
  })

  test('single common entry with mergeCommonEntries: 1', () => {
    const value = [
      { a: 1, x: 0 },
      { a: 1, y: 0 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: 1 })
    expect(str).toBe(`- <<: &a1
    a: 1
  x: 0
- <<: *a1
  y: 0
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })
})

describe('no effect without merge key support', () => {
  for (const options of [{}, { schema: 'json' }] as const) {
    test(JSON.stringify(options), () => {
      const str = stringify(jobs(), { ...options, mergeCommonEntries: true })
      expect(str).toBe(stringify(jobs(), options))
      expect(str).not.toContain('<<')
    })
  }
})

describe('merge key schemas', () => {
  const schemaOptions: Array<DocumentOptions & SchemaOptions> = [
    { merge: true },
    { version: '1.1' },
    { schema: 'yaml-1.1' },
    { customTags: ['merge'] }
  ]
  for (const options of schemaOptions) {
    test(JSON.stringify(options), () => {
      const str = stringify(jobs(), { ...options, mergeCommonEntries: true })
      expect(str).toBe(jobsYaml)
      expect(parse(str, options)).toStrictEqual(jobs())
    })
  }
})

describe('interaction with aliasDuplicateObjects', () => {
  test('shared references are not extracted as common entries', () => {
    const env = { NODE_ENV: 'prod', TZ: 'UTC' }
    const value = [
      { name: 'a', env, image: 'app', retries: 3, cpu: 1 },
      { name: 'b', env, image: 'app', retries: 3, cpu: 1 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a2
    image: app
    retries: 3
    cpu: 1
  name: a
  env: &a1
    NODE_ENV: prod
    TZ: UTC
- <<: *a2
  name: b
  env: *a1
`)
    const res = parse(str, { merge: true })
    expect(res).toStrictEqual(value)
    expect(res[0].env).toBe(res[1].env)
  })

  test('disabled aliasDuplicateObjects', () => {
    const env = { NODE_ENV: 'prod', TZ: 'UTC' }
    const value = [
      { name: 'a', env, image: 'app', retries: 3, cpu: 1 },
      { name: 'b', env, image: 'app', retries: 3, cpu: 1 }
    ]
    const str = stringify(value, {
      aliasDuplicateObjects: false,
      merge: true,
      mergeCommonEntries: true
    })
    expect(str).toBe(`- <<: &a1
    env:
      NODE_ENV: prod
      TZ: UTC
    image: app
    retries: 3
    cpu: 1
  name: a
- <<: *a1
  name: b
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })
})

describe('anchors', () => {
  test('anchorPrefix option is used', () => {
    const str = stringify(jobs(), {
      anchorPrefix: 'job',
      merge: true,
      mergeCommonEntries: true
    })
    expect(str).toContain('<<: &job1')
    expect(str).toContain('<<: *job1')
  })

  test('no collision with anchors already in the document', () => {
    const doc = parseDocument<YAMLSeq, false>('- &a1 { x: 1 }\n', {
      merge: true
    })
    const node = doc.createNode(
      [
        { a: 1, b: 2, c: 3 },
        { a: 1, b: 2, c: 3 }
      ],
      { mergeCommonEntries: true }
    )
    doc.value.push(node)
    const str = String(doc)
    expect(str).toContain('&a2')
    expect(str).not.toContain('&a1\n')
    expect(doc.errors).toHaveLength(0)
  })
})

describe('doc.createPair', () => {
  test('applies to the pair value', () => {
    const doc = new Document(null, { merge: true })
    const pair = doc.createPair('jobs', jobs(), { mergeCommonEntries: true })
    const seq = pair.value as YAMLSeq
    const first = seq[0] as YAMLMap
    const [firstPair] = first.values.values()
    expect(firstPair.key).toMatchObject({ value: '<<' })
    expect(doc.toJS()).toBeNull()
  })
})

describe('edge cases', () => {
  test('no common entries', () => {
    const value = [
      { a: 1, b: 2, c: 3 },
      { d: 4, e: 5, f: 6 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(stringify(value, { merge: true }))
  })

  test('single mapping', () => {
    const value = [{ a: 1, b: 2, c: 3 }]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(stringify(value, { merge: true }))
  })

  test('null values in common entries', () => {
    const value = [
      { a: null, b: 1, c: 2, x: 0 },
      { a: null, b: 1, c: 2, y: 0 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a1
    a: null
    b: 1
    c: 2
  x: 0
- <<: *a1
  y: 0
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })

  test('pre-existing merge key is kept', () => {
    const value = [
      { '<<': { z: 9 }, a: 1, b: 2, c: 3 },
      { '<<': { z: 9 }, a: 1, b: 2, c: 3 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(parse(str, { merge: true })).toStrictEqual([
      { a: 1, b: 2, c: 3, z: 9 },
      { a: 1, b: 2, c: 3, z: 9 }
    ])
  })

  test('largest common subset is extracted first', () => {
    const value = [
      { a: 1, b: 2, c: 3, d: 4, p: 0 },
      { a: 1, b: 2, c: 3, d: 4, q: 0 },
      { a: 1, b: 2, c: 3, e: 5, r: 0 },
      { a: 1, b: 2, c: 3, e: 5, s: 0 }
    ]
    const str = stringify(value, { merge: true, mergeCommonEntries: true })
    expect(str).toBe(`- <<: &a1
    a: 1
    b: 2
    c: 3
  d: 4
  p: 0
- <<: *a1
  d: 4
  q: 0
- <<: *a1
  e: 5
  r: 0
- <<: *a1
  e: 5
  s: 0
`)
    expect(parse(str, { merge: true })).toStrictEqual(value)
  })
})
