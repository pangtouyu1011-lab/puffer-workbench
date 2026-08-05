// 用 PAT 通过 Supabase Management API 执行 SQL（不落盘 token）
// 用法：SB_PAT=xxx node run_sql.js <sql-file>
const fs = require('fs');
const path = require('path');

const REF = 'chfczfrkgndgudcxoump';
const PAT = process.env.SB_PAT;
if (!PAT) { console.error('缺少环境变量 SB_PAT'); process.exit(2); }
const sqlFile = process.argv[2];
if (!sqlFile) { console.error('用法: node run_sql.js <sql-file>'); process.exit(2); }
const query = fs.readFileSync(sqlFile, 'utf8');

(async () => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  console.log('HTTP', res.status);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text);
  }
  process.exit(res.ok ? 0 : 1);
})();
