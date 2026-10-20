import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const root=resolve(import.meta.dirname,"..");
const packageIndex=JSON.parse(readFileSync(resolve(root,"public/packages/index.json"),"utf8"));

test("all fifteen seed commands are complete, checksummed v1 packages",()=>{
  assert.equal(Object.keys(packageIndex).length,15);
  for(const [slug,metadata] of Object.entries(packageIndex)){
    const archive=readFileSync(resolve(root,`public/packages/${slug}-${metadata.version}.command.zip`));
    assert.equal(createHash("sha256").update(archive).digest("hex"),metadata.sha256,slug);
    assert.equal(archive.byteLength,metadata.bytes,slug);
    const entries=unzipSync(archive);
    for(const path of ["command.json","README.md","icon.svg"])
      assert.ok(entries[path],`${slug} requires ${path}`);
    const manifest=JSON.parse(strFromU8(entries["command.json"]));
    assert.equal(manifest.schemaVersion,"1.0",slug);
    assert.equal(manifest.slug,slug);
    assert.equal(manifest.entrypoint.callable,"run_command",slug);
    assert.ok(entries[manifest.entrypoint.file],`${slug} entrypoint must exist`);
    assert.match(strFromU8(entries[manifest.entrypoint.file]),/^def run_command\(/m,slug);
    for(const file of manifest.dependencies.files)
      assert.ok(entries[file],`${slug} dependency ${file} must exist`);
  }
});

test("all fifteen listed commands have nonblank computed preview thumbnails",()=>{
  const previews=JSON.parse(readFileSync(resolve(root,"public/assets/thumbnails/manifest.json"),"utf8"));
  assert.equal(previews.demos.length,15);
  assert.equal(new Set(previews.demos.map(item=>item.id)).size,15);
  for(const demo of previews.demos){
    const image=resolve(root,"public",demo.image.replace(/^\//,""));
    assert.ok(statSync(image).size>8000,`${demo.id} thumbnail must be nonblank`);
  }
  const wrappers=readdirSync(resolve(root,"public/commands"),{withFileTypes:true})
    .filter(entry=>entry.isDirectory())
    .filter(entry=>{
      try{return statSync(resolve(root,"public/commands",entry.name,"preview/index.html")).isFile()}
      catch{return false}
    });
  assert.equal(wrappers.length,12,"twelve commands use the standard preview adapter");
});
