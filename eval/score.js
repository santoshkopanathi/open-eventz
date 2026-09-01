// Score a run against the golden set.  usage: node eval/score.js eval/run-v3-results.json
const fs = require('fs')
const file = process.argv[2] || 'eval/run-v3-results.json'
const R = JSON.parse(fs.readFileSync(file, 'utf8')).filter(r => r.v2)
const conf = r => r.v2.price_confidence || 'low'
const answers = r => r.v2.price === 'free' || r.v2.price === 'paid'
const dist = f => { const c = {}; R.forEach(r => { const v = f(r); c[v] = (c[v] || 0) + 1 }); return c }

console.log('=== ' + file + '  (n=' + R.length + ') ===\n')
console.log('GATE 1 — does confidence vary?')
console.log('  price      :', dist(r => r.v2.price_confidence))
console.log('  kid        :', dist(r => r.v2.kid_confidence))
console.log('  age        :', dist(r => r.v2.age_confidence))
console.log('  price value:', dist(r => r.v2.price))

const unk = R.filter(r => r.label_price === 'unknown')
const det = R.filter(r => r.label_price !== 'unknown')
const c1 = {}; unk.forEach(r => c1[conf(r)] = (c1[conf(r)] || 0) + 1)
const c2 = {}; det.forEach(r => c2[conf(r)] = (c2[conf(r)] || 0) + 1)
const hi = unk.filter(r => conf(r) === 'high')
console.log('\nGATE 2 — calibration  (gate: no more than 4 HIGH on the unknowables)')
console.log('  on the ' + unk.length + ' you could NOT determine:', c1)
console.log('  on the ' + det.length + ' you COULD determine   :', c2)
console.log('  -> HIGH on unknowables:', hi.length, hi.length <= 4 ? 'PASS' : 'FAIL')
hi.forEach(r => console.log('       ! ' + r.n + '. ' + r.title.slice(0, 46)))

const paid = R.filter(r => r.label_price === 'paid')
const wf = paid.filter(r => r.v2.price === 'free')
console.log('\nGATE 3 — safety  (gate: 0 wrongly-free)')
paid.forEach(r => console.log('  ' + r.title.slice(0, 40).padEnd(42) + 'v3 says ' + r.v2.price + ' (' + conf(r) + ')'))
console.log('  -> wrongly-free:', wf.length, wf.length === 0 ? 'PASS' : 'FAIL')

const wasHidden = R.filter(r => r.label_kid === 'yes' && r.v1.kid_relevant === false)
const back = wasHidden.filter(r => r.v2.kid_relevant === true)
const said = R.filter(r => r.label_kid === 'no')
const leak = said.filter(r => r.v2.kid_relevant === true)
console.log('\nGATE 4 — kid-relevance')
console.log('  hidden by v1 but you said yes:', wasHidden.length, '-> now shown:', back.length)
wasHidden.forEach(r => console.log('    ' + (r.v2.kid_relevant ? 'OK  ' : 'MISS') + ' ' + r.title.slice(0, 46).padEnd(48) + JSON.stringify(r.v2.age_buckets)))
console.log('  you said no:', said.length, '-> leaked:', leak.length)
said.forEach(r => console.log('    ' + (r.v2.kid_relevant ? 'LEAK' : 'OK  ') + ' ' + r.title))

const policies = {
  'model only, show all':       r => (r.v2.price === 'unknown' ? null : r.v2.price),
  'withhold LOW':               r => (r.v2.price === 'unknown' || conf(r) === 'low' ? null : r.v2.price),
  'withhold LOW + MEDIUM':      r => (r.v2.price === 'unknown' || conf(r) !== 'high' ? null : r.v2.price),
  'unknown/low -> FREE':        r => (r.v2.price === 'unknown' || conf(r) === 'low' ? 'free' : r.v2.price),
  'unknown -> FREE, keep low':  r => (r.v2.price === 'unknown' ? 'free' : r.v2.price),
}
console.log('\nPOLICY TABLE — what a parent sees')
console.log('  policy                       badges  over-claim  under-claim  WRONGLY-FREE')
for (const [name, f] of Object.entries(policies)) {
  let b = 0, o = 0, u = 0, w = 0
  for (const r of R) {
    const shown = f(r)
    if (shown) { b++; if (r.label_price === 'unknown') o++; if (r.label_price === 'paid' && shown === 'free') w++ }
    else if (r.label_price !== 'unknown') u++
  }
  console.log('  ' + name.padEnd(29) + String(b).padEnd(8) + String(o).padEnd(12) + String(u).padEnd(13) + w + (w ? '  <-- FAILS GATE' : ''))
}
console.log('  ' + 'v1 today (reference)'.padEnd(29) + '57      12          2            0')
