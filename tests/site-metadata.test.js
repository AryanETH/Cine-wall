'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'../public');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const meta=(html,key)=>new RegExp(`<meta (?:name|property)="${key}" content="([^"]+)"`).exec(html)?.[1];

test('homepage and app metadata describe current capabilities without placeholder ratings or perfect-sync claims',()=>{
  const html=read('index.html'),title=/<title>([^<]+)<\/title>/.exec(html)[1];
  for(const key of ['title','og:title','twitter:title'])assert.equal(meta(html,key),title);
  for(const key of ['og:description','twitter:description'])assert.equal(meta(html,key),meta(html,'description'));
  const schemas=[...html.matchAll(/<script type="application\/ld\+json">([\s\S]+?)<\/script>/g)].map(match=>JSON.parse(match[1]));
  const app=schemas.find(schema=>schema['@type']==='WebApplication');
  assert.equal(schemas.find(schema=>schema['@type']==='WebSite').name,'CineWall');
  assert.equal(title,'CineWall - Free mini theatre at home');
  assert.equal(app.url,'https://watch.aitoyz.in/');assert.equal(app.isAccessibleForFree,true);
  assert.equal(app.aggregateRating,undefined);assert.ok(app.featureList.some(item=>item.includes('Teleprompter')));
  assert.ok(fs.existsSync(path.join(root,new URL(app.image).pathname)));
  const manifest=JSON.parse(read('manifest.json'));
  assert.match(manifest.description,/playlists/);assert.equal(manifest.orientation,'any');
  assert.doesNotMatch(JSON.stringify([app,manifest]),/perfect sync|presentations across/i);
  assert.match(html, /aria-label="CineWall modes" data-nosnippet/);
  assert.match(html, /id="faq-devices"/);
});

test('public canonical pages are in the sitemap while room pages advertise noindex and remain crawlable',()=>{
  const sitemap=read('sitemap.xml'),robots=read('robots.txt');
  const urls=[...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]);
  assert.equal(new Set(urls).size,urls.length);
  for(const url of urls){const pathname=new URL(url).pathname;const html=read(pathname==='/'?'index.html':pathname.slice(1));assert.ok(html.includes(`rel="canonical" href="${url}"`));}
  assert.ok(!urls.some(url=>/index\.html|admin\.html|screen\.html|share\.html|mic\.html/.test(url)));
  for(const page of ['admin.html','screen.html','share.html','mic.html']){
    assert.match(meta(read(page),'robots'),/noindex/);
    assert.ok(!robots.includes('Disallow: /'+page),'crawlers must be able to read noindex');
  }
});
