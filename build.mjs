// Gera as versões compactadas que o index.html usa:
//   css/app.css -> css/app.min.css
//   js/app.js   -> js/app.min.js
// e marca a versão (APP_VERSAO do js/app.js) no ?v= dos dois links do index.html,
// para o celular não juntar um index.html novo com um app.min.js velho guardado.
// Uso: npm install (só na primeira vez) e depois npm run build
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

// celulares e navegadores que o app atende (Android/Chrome 80+, iPhone com iOS 13.4+)
const ALVO = ['chrome80', 'safari13.1', 'firefox78', 'edge88'];

for (const [de, para] of [['css/app.css', 'css/app.min.css'], ['js/app.js', 'js/app.min.js']]) {
  // sem "bundle" e sem "format": só compacta, e os nomes globais (funções do app) continuam os mesmos
  await esbuild.build({ entryPoints: [de], outfile: para, minify: true, target: ALVO, charset: 'utf8', logLevel: 'warning' });
  console.log(para.padEnd(16), Math.round(statSync(de).size / 1024) + ' KB -> ' + Math.round(statSync(para).size / 1024) + ' KB');
}

const versao = (readFileSync('js/app.js', 'utf8').match(/const APP_VERSAO = '([^']+)'/) || [])[1];
if (!versao) throw new Error('Não achei o APP_VERSAO em js/app.js');
const html = readFileSync('index.html', 'utf8');
const novo = html.replace(/(css\/app\.min\.css|js\/app\.min\.js)(\?v=[^"]*)?"/g, '$1?v=' + versao + '"');
if ((novo.match(/app\.min\.(css|js)\?v=/g) || []).length !== 2) throw new Error('index.html: não achei os dois links css/app.min.css e js/app.min.js');
if (novo !== html) writeFileSync('index.html', novo);
console.log('index.html       versão ' + versao);
