import {execFileSync} from 'node:child_process';
import {readFileSync,statSync,readdirSync} from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const ignored=new Set(['node_modules','.git','.wrangler','.deploy','.sites-runtime','dist','backups','exports','private']);
const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>ignored.has(e.name)?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.relative(root,path.join(dir,e.name))]);
let files;try{files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)}catch{files=walk(root)}
const rules=[['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['AWS access key',/\bAKIA[A-Z0-9]{16}\b/],['credential in URL',/https?:\/\/[^\s/]+:[^\s/]+@/],['filled runtime secret',/(?:LINE_(?:LOGIN_CHANNEL_SECRET|CHANNEL_ACCESS_TOKEN|CHANNEL_SECRET)|AUTH_SECRET|CLOUDFLARE_API_TOKEN)\s*[:=]\s*["']([A-Za-z0-9+/=_-]{24,})["']/]];
const forbidden=/(?:^|\/)(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|credentials[^/]*|[^/]+\.(?:pem|key|db|sqlite(?:3)?))$/;
let errors=0;
for(const file of files){if(file==='.env.example')continue;if(forbidden.test(file)){console.error(`Forbidden private file: ${file}`);errors++;continue}if(ignored.has(file.split('/')[0]))continue;try{if(statSync(file).size>2e6||/\.(?:jpg|png|webp|ico|woff2?)$/.test(file))continue;const text=readFileSync(file,'utf8');for(const [name,pattern] of rules){if(pattern.test(text)){console.error(`Potential ${name} in ${file} (value withheld)`);errors++;}}}catch{/* deleted file */}}
if(errors)process.exit(1);console.log(`Secret check passed (${files.length} files).`);
