// 探针 2：列 IndexedDB 目录树
const fs = require('fs');
const path = require('path');

const ud = path.resolve(process.argv[2] || 'D:/Project/CebianX/cebian-web-provider/e2e/.userdata-collab-fresh');
const idbBase = path.join(ud, 'Default', 'IndexedDB');

function walk(dir, depth=0, out=[], relBase=dir) {
  if (depth > 3) return out;
  if (!fs.existsSync(dir)) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { out.push({type:'err', name: e.message, path: dir}); return out; }
  for (const f of entries) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) {
      out.push({type: 'dir', name: f.name, rel: path.relative(relBase, p)});
      walk(p, depth+1, out, relBase);
    } else {
      try { out.push({type: 'file', name: f.name, size: fs.statSync(p).size, rel: path.relative(relBase, p)}); } catch {}
    }
  }
  return out;
}

console.log('=== IndexedDB tree (depth 3) under', idbBase, '===');
if (!fs.existsSync(idbBase)) { console.log('NO_IDB_DIR'); process.exit(0); }
const tree = walk(idbBase, 0);
for (const n of tree.slice(0, 80)) {
  const depth = (n.rel.match(/[/\\]/g) || []).length;
  const indent = '  '.repeat(depth);
  console.log(`${indent}${n.type === 'dir' ? '📁' : '📄'} ${n.name}${n.size ? ' ('+n.size+'B)' : ''}`);
}
console.log(`\nTotal entries: ${tree.length}`);

console.log('\n=== Extension-related entries ===');
for (const n of tree) {
  if (n.name.includes('chrome-extension') || n.name.includes('nkeimhog')) {
    console.log('-', n.rel);
  }
}
