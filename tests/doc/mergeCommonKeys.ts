import { Document, parse, stringify } from 'yaml'
import { source } from '../_utils.ts'

const jobs = [
  { name: 'build', image: 'node:20', retries: 3, env: 'prod', script: 'build' },
  { name: 'test', image: 'node:20', retries: 3, env: 'prod', script: 'test' },
  {
    name: 'deploy',
    image: 'node:20',
    retries: 3,
    env: 'prod',
    script: 'deploy'
  }
]

describe('extraction', () => {
  test('sequence of mappings', () => {
    const out = stringify(jobs, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - <<: &a1
          image: node:20
          retries: 3
          env: prod
        name: build
        script: build
      - <<: *a1
        name: test
        script: test
      - <<: *a1
        name: deploy
        script: deploy
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(jobs)
  })

  test('mapping of mappings', () => {
    const value = {
      jobs: {
        a: { image: 'node:20', retries: 3, env: 'prod', x: 1 },
        b: { image: 'node:20', retries: 3, env: 'prod', y: 2 }
      }
    }
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      jobs:
        a:
          <<: &a1
            image: node:20
            retries: 3
            env: prod
          x: 1
        b:
          <<: *a1
          "y": 2
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('first mapping exactly matches the common pairs', () => {
    const value = [
      { image: 'node:20', retries: 3, env: 'prod' },
      { name: 'test', image: 'node:20', retries: 3, env: 'prod' }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - &a1
        image: node:20
        retries: 3
        env: prod
      - <<: *a1
        name: test
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('nested sibling groups', () => {
    const value = [
      {
        name: 'a',
        image: 'img',
        retries: 3,
        env: 'p',
        steps: [
          { run: 'x', shell: 'sh', os: 'linux', timeout: 10 },
          { run: 'y', shell: 'sh', os: 'linux', timeout: 10 }
        ]
      },
      {
        name: 'b',
        image: 'img',
        retries: 3,
        env: 'p',
        steps: [
          { run: 'z', shell: 'sh', os: 'linux', timeout: 10 },
          { run: 'w', shell: 'sh', os: 'linux', timeout: 10 }
        ]
      }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - <<: &a1
          image: img
          retries: 3
          env: p
        name: a
        steps:
          - <<: &a2
              shell: sh
              os: linux
              timeout: 10
            run: x
          - <<: *a2
            run: "y"
      - <<: *a1
        name: b
        steps:
          - <<: &a3
              shell: sh
              os: linux
              timeout: 10
            run: z
          - <<: *a3
            run: w
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('multiple subgroups', () => {
    const value = [
      { n: 'a', base1: 1, base2: 2, base3: 3, s1: 'x', s2: 'y', s3: 'z' },
      { n: 'b', base1: 1, base2: 2, base3: 3, s1: 'x', s2: 'y', s3: 'z' },
      { n: 'c', base1: 1, base2: 2, base3: 3, g1: 7, g2: 8, g3: 9 },
      { n: 'd', base1: 1, base2: 2, base3: 3, g1: 7, g2: 8, g3: 9 }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - <<: &a2
          s1: x
          s2: "y"
          s3: z
        <<: &a1
          base1: 1
          base2: 2
          base3: 3
        "n": a
      - <<: *a2
        <<: *a1
        "n": b
      - <<: &a3
          g1: 7
          g2: 8
          g3: 9
        <<: *a1
        "n": c
      - <<: *a3
        <<: *a1
        "n": d
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('keys with different values are kept locally', () => {
    const value = [
      { a: 1, b: 2, c: 3, d: 4 },
      { a: 1, b: 2, c: 3, d: 5 }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - <<: &a1
          a: 1
          b: 2
          c: 3
        d: 4
      - <<: *a1
        d: 5
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('shared NaN values', () => {
    const value = [
      { a: NaN, b: 1, c: 2, x: 1 },
      { a: NaN, b: 1, c: 2, y: 2 }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - <<: &a1
          a: .nan
          b: 1
          c: 2
        x: 1
      - <<: *a1
        "y": 2
    `)
    const res = parse(out, { version: '1.1' })
    expect(Number.isNaN(res[0].a)).toBe(true)
    expect(Number.isNaN(res[1].a)).toBe(true)
  })

  test('shared pairs in flow style', () => {
    const out = stringify(jobs.slice(0, 2), {
      version: '1.1',
      mergeCommonKeys: true,
      flow: true
    })
    expect(out).toBe(
      '[\n  {\n      <<: &a1 { image: node:20, retries: 3, env: prod },\n' +
        '      name: build,\n      script: build\n    },\n' +
        '  { <<: *a1, name: test, script: test }\n]\n'
    )
    expect(parse(out, { version: '1.1' })).toStrictEqual(jobs.slice(0, 2))
  })

  test('doc.toJS() resolves the merges', () => {
    const doc = new Document(jobs, { version: '1.1', mergeCommonKeys: true })
    expect(doc.toJS()).toStrictEqual(jobs)
  })
})

describe('threshold', () => {
  const value = [
    { a: 1, b: 2, c: 1 },
    { a: 1, b: 2, d: 2 }
  ]

  test('at least 3 shared pairs are required by default', () => {
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(stringify(value, { version: '1.1' }))
  })

  test('custom minimum as a number', () => {
    const out = stringify(value, { version: '1.1', mergeCommonKeys: 2 })
    expect(out).toBe(source`
      - <<: &a1
          a: 1
          b: 2
        c: 1
      - <<: *a1
        d: 2
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('minimum of 1 extracts any shared pair', () => {
    const out = stringify(
      [
        { a: 1, b: 1 },
        { a: 1, b: 2 }
      ],
      { version: '1.1', mergeCommonKeys: 1 }
    )
    expect(out).toBe('- <<: &a1\n    a: 1\n  b: 1\n- <<: *a1\n  b: 2\n')
  })
})

describe('schema gating', () => {
  test('no effect with the default core schema', () => {
    expect(stringify(jobs, { mergeCommonKeys: true })).toBe(stringify(jobs))
  })

  test('no effect with the json schema', () => {
    const opt = { schema: 'json' }
    expect(stringify(jobs, { ...opt, mergeCommonKeys: true })).toBe(
      stringify(jobs, opt)
    )
  })

  test('active with merge: true on the core schema', () => {
    const out = stringify(jobs, { merge: true, mergeCommonKeys: true })
    expect(out).toContain('<<: &a1')
    expect(parse(out, { merge: true })).toStrictEqual(jobs)
  })

  test('active with customTags: ["merge"]', () => {
    const out = stringify(jobs.slice(0, 2), {
      customTags: ['merge'],
      mergeCommonKeys: true
    })
    expect(out).toContain('<<: &a1')
    expect(parse(out, { customTags: ['merge'] })).toStrictEqual(
      jobs.slice(0, 2)
    )
  })

  test('active with the yaml-1.1 schema', () => {
    const out = stringify(jobs, { schema: 'yaml-1.1', mergeCommonKeys: true })
    expect(out).toContain('<<: &a1')
    expect(parse(out, { schema: 'yaml-1.1' })).toStrictEqual(jobs)
  })

  test('inactive by default', () => {
    expect(stringify(jobs, { version: '1.1' })).not.toContain('<<')
  })
})

describe('anchors', () => {
  test('uses the anchorPrefix option', () => {
    const out = stringify(jobs, {
      version: '1.1',
      mergeCommonKeys: true,
      anchorPrefix: 'job'
    })
    expect(out).toContain('<<: &job1')
    expect(out).toContain('<<: *job1')
  })

  test('does not collide with aliasDuplicateObjects anchors', () => {
    const shared = [1, 2]
    const value = {
      first: [shared, shared],
      jobs: [
        { a: 1, b: 2, c: 3, n: 'x' },
        { a: 1, b: 2, c: 3, n: 'y' }
      ]
    }
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      first:
        - &a1
          - 1
          - 2
        - *a1
      jobs:
        - <<: &a2
            a: 1
            b: 2
            c: 3
          "n": x
        - <<: *a2
          "n": "y"
    `)
    expect(parse(out, { version: '1.1' })).toStrictEqual(value)
  })

  test('does not collide with existing anchors in doc.createNode', () => {
    const shared = [1, 2]
    const doc = new Document(
      { anchor: shared, ref: shared },
      { version: '1.1' }
    )
    const node = doc.createNode(
      [
        { a: 1, b: 2, c: 3, n: 'x' },
        { a: 1, b: 2, c: 3, n: 'y' }
      ],
      { mergeCommonKeys: true }
    )
    doc.set('jobs', node)
    const out = String(doc)
    expect(out).toContain('<<: &a2')
    expect(parse(out, { version: '1.1' })).toStrictEqual({
      anchor: [1, 2],
      ref: [1, 2],
      jobs: [
        { a: 1, b: 2, c: 3, n: 'x' },
        { a: 1, b: 2, c: 3, n: 'y' }
      ]
    })
  })

  test('mappings containing aliases are skipped', () => {
    const shared = { x: 1 }
    const value = [
      { ref: shared, a: 1, b: 2, c: 3 },
      { ref: shared, a: 1, b: 2, c: 3 }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(source`
      - ref: &a1
          x: 1
        a: 1
        b: 2
        c: 3
      - ref: *a1
        a: 1
        b: 2
        c: 3
    `)
    const res = parse(out, { version: '1.1' })
    expect(res[0].ref).toBe(res[1].ref)
  })

  test('mappings with existing merge keys are skipped', () => {
    const value = [
      { '<<': 1, a: 1, b: 2, c: 3 },
      { '<<': 1, a: 1, b: 2, c: 3 }
    ]
    const out = stringify(value, { version: '1.1', mergeCommonKeys: true })
    expect(out).toBe(stringify(value, { version: '1.1' }))
  })
})

describe('createNode & createPair', () => {
  test('doc.createNode', () => {
    const doc = new Document(null, { version: '1.1' })
    doc.value = doc.createNode(jobs, { mergeCommonKeys: true })
    const out = String(doc)
    expect(out).toContain('<<: &a1')
    expect(parse(out, { version: '1.1' })).toStrictEqual(jobs)
  })

  test('doc.createPair', () => {
    const doc = new Document({}, { version: '1.1' })
    doc.set(
      'jobs',
      doc.createPair('jobs', jobs, { mergeCommonKeys: true }).value
    )
    const out = String(doc)
    expect(out).toContain('<<: &a1')
    expect(parse(out, { version: '1.1' })).toStrictEqual({ jobs })
  })
})
