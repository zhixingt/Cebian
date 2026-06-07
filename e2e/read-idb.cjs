// 读 Chrome IndexedDB (LevelDB 格式) 的 webProviders 表
const { Level } = require('level');
const path = require('path');

const idbPath = path.join(
  process.env.LOCALAPPDATA || process.env.HOME,
  'AppData/Local/Google/Chrome/User Data/Default/IndexedDB',
);

(async () => {
  // walk 一层找带 'hmcofhnhpnjodhbleelmhpbckfngnkbk' 的目录
  const fs = require('fs');
  function find(dir, depth=0, results=[]) {
    if (depth > 4) return results;
    if (!fs.existsSync(dir)) return results;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.includes('hmcofhnhpnjodhbleelmhpbckfngnkbk')) {
          results.push(p);
        } else {
          find(p, depth+1, results);
        }
      }
    }
    return results;
  }

  const found = find(idbPath);
  console.log('Found IDB dirs:', found.length);
  if (found.length === 0) { process.exit(0); }

  for (const dir of found) {
    console.log('\n=== ' + path.basename(dir) + ' ===');
    // Chrome IDB uses sublevel layout - "Databases" or "Index Store"
    // Try opening the leveldb directly
    try {
      const db = new Level(dir, { createIfMissing: false, valueEncoding: 'binary' });
      await db.open();
      let count = 0;
      const interesting = [];
      for await (const [key, value] of db.iterator()) {
        count++;
        const keyStr = key.toString('utf8');
        // Look for anything containing 'webProviders' or 'glm'
        const valStr = value.toString('binary');
        if (keyStr.includes('webProv') || valStr.includes('webProv') ||
            keyStr.includes('glm') || valStr.includes('GLM') ||
            keyStr.includes('activeModel') || valStr.includes('activeModel')) {
          // 试着把 value 当 JSON 解析
          let valParsed = null;
          try { valParsed = JSON.parse(valStr); } catch {}
          interesting.push({ key: keyStr.substring(0, 100), valueLen: value.length, valParsed });
        }
      }
      console.log('Total entries:', count);
      console.log('Interesting:', JSON.stringify(interesting.slice(0, 8), null, 2).substring(0, 4000));
      await db.close();
    } catch (e) {
      console.log('Level open failed:', e.message);
    }
  }
})().catch(e => console.error('FATAL:', e.message));
