import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const ORIGIN=(process.env.COMMANDS_PREVIEW_ORIGIN||"http://127.0.0.1:8765").replace(/\/$/,"");
const suffix=randomBytes(4).toString("hex");
const slug=`integration-smoke-${suffix}`;
const name=`IntegrationSmoke${suffix}`;

const source=readFileSync("public/packages/spiral-stair-0.1.0.command.zip");
const entries=unzipSync(source);
const manifest=JSON.parse(strFromU8(entries["command.json"]));
Object.assign(manifest,{
  slug,name,commandName:name,license:"MIT",
  summary:"Verify the complete COMMANDS community publishing flow.",
  description:"A temporary end-to-end release used to validate package upload, storage, catalog reads, and immutable download checksums.",
  provenance:{status:"community-publish",source:"Automated local integration test"}
});
entries["command.json"]=strToU8(JSON.stringify(manifest,null,2)+"\n");
const archive=zipSync(entries,{level:9});
const form=new FormData();
form.set("package",new File([archive],`${slug}.command.zip`,{type:"application/zip"}));
form.set("manifest",JSON.stringify(manifest));
form.set("changelog","End-to-end smoke release.");

const headers={
  origin:ORIGIN,
  "sec-fetch-site":"same-origin",
  "oai-authenticated-user-id":"commands-integration-test",
  "oai-authenticated-user-email":"private-test@example.invalid",
  "oai-authenticated-user-full-name":"COMMANDS%20Integration",
  "oai-authenticated-user-full-name-encoding":"percent-encoded-utf-8"
};

const published=await fetch(`${ORIGIN}/api/publish`,{method:"POST",headers,body:form});
const publishBody=await published.json();
assert.equal(published.status,200,JSON.stringify(publishBody));
assert.equal(publishBody.slug,slug);
assert.match(publishBody.checksumSha256,/^[a-f0-9]{64}$/);

const catalog=await fetch(`${ORIGIN}/api/v1/commands/${slug}`);
assert.equal(catalog.status,200);
const catalogBody=await catalog.json();
assert.equal(catalogBody.data.name,name);
assert.equal(catalogBody.data.license,"MIT");

const downloaded=await fetch(`${ORIGIN}/api/v1/commands/${slug}/download`);
assert.equal(downloaded.status,200);
const downloadedBytes=new Uint8Array(await downloaded.arrayBuffer());
const checksum=createHash("sha256").update(downloadedBytes).digest("hex");
assert.equal(checksum,publishBody.checksumSha256);
assert.equal(downloaded.headers.get("x-content-sha256"),checksum);

const duplicateForm=new FormData();
duplicateForm.set("package",new File([archive],`${slug}.command.zip`,{type:"application/zip"}));
duplicateForm.set("manifest",JSON.stringify(manifest));
const duplicate=await fetch(`${ORIGIN}/api/publish`,{method:"POST",headers,body:duplicateForm});
assert.equal(duplicate.status,409,"Immutable duplicate versions must be rejected");

console.log(`✔ published, read, downloaded, checksum-verified, and protected ${slug}`);
