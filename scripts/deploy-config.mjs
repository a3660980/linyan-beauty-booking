import fs from 'node:fs';
const id=process.env.CLOUDFLARE_D1_DATABASE_ID;
if(!id||!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Configure the CLOUDFLARE_D1_DATABASE_ID GitHub variable first.');
fs.mkdirSync('.deploy',{recursive:true});
const cfg=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
cfg.main='../../worker/index.ts';cfg.assets.directory='../../dist';cfg.d1_databases[0].database_id=id;cfg.d1_databases[0].migrations_dir='../../migrations';
fs.writeFileSync('.deploy/wrangler.json',JSON.stringify(cfg,null,2));
console.log('Deployment config prepared in an ignored directory.');
