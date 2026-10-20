import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync} from "node:fs";

const registry=JSON.parse(readFileSync("generated/commands.json","utf8"));
const listed=registry.commands.filter(c=>c.listed!==false&&c.kind==="command");
const live=listed.filter(c=>c.preview?.type==="web");

test("registry discovers the entire migrated Hark command library",()=>{
  assert.equal(registry.commandCount,16);
  assert.equal(registry.listedCount,15);
  assert.equal(listed.length,15);
  assert.equal(new Set(registry.commands.map(c=>c.id)).size,16);
  assert.ok(registry.commands.some(c=>c.id==="G006"&&c.kind==="module"&&!c.listed));
});

test("every registry package points to real Python source",()=>{
  for(const command of registry.commands){
    assert.ok(existsSync(command.sourcePath),command.id+" source must exist");
    assert.ok(command.packagePath.startsWith("commands/"));
    assert.equal(command.runtime.language,"python");
    assert.ok(command.summary.length>10);
  }
});

test("every listed command now has a real browser preview entry",()=>{
  assert.equal(registry.livePreviewCount,registry.listedCount);
  assert.equal(live.length,listed.length);
  assert.deepEqual(
    live.map(c=>c.id).sort(),
    listed.map(c=>c.id).sort()
  );
  for(const command of live){
    assert.ok(existsSync(command.preview.entry),command.id+" preview entry");
    assert.ok(command.preview.capture);
    assert.ok(command.preview.ready?.selector);
    assert.ok(command.preview.ready?.metric);
    assert.equal(command.preview.thumbnail,
      "assets/thumbnails/"+command.id+".png");
  }
});

test("marketplace JavaScript contains no hand-maintained command catalogue",()=>{
  const app=readFileSync("legacy/static-v0/app.js","utf8");
  assert.ok(!app.includes("const commands = ["));
  assert.ok(app.includes("generated/commands.json"));
  assert.ok(!app.includes("liveDemoPaths"));
});

test("registry builder has a loose-script auto-discovery path",()=>{
  const builder=readFileSync("scripts/build-registry.mjs","utf8");
  assert.ok(builder.includes("A loose .py file anywhere below commands/"));
  assert.ok(builder.includes('endsWith(".py")'));
  assert.ok(builder.includes('preview","index.html'));
});
