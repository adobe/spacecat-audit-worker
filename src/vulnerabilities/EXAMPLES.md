# Example payloads for the different steps

## Step 1: `import-from-starfish`

```bash
curl -X POST http://localhost:3000 \
     -H "Content-Type: application/json" \
     -d '{"type":"security-vulnerabilities","siteId":"9ee60274-f27a-47ab-9b60-46c09a83175c"}'
```

## Step 2: `generate-suggestion-data`

```bash
curl -X POST http://localhost:3000 \
     -H "Content-Type: application/json" \
     -d '{"success":true,"siteId":"9ee60274-f27a-47ab-9b60-46c09a83175c","type":"security-vulnerabilities","auditContext":{"next":"generate-suggestion-data","auditId":"e082980d-673b-4e37-828a-949731127261","auditType":"security-vulnerabilities","fullAuditRef":"publish-p15854-e1797721.adobeaemcloud.com/us/en.html"},"config":{"type":"code","siteId":"9ee60274-f27a-47ab-9b60-46c09a83175c","sources":["github"],"destinations":["default"],"owner":"OneAdobe","repo":"aem-security-vulns-testbed","ref":"main"},"data":{"importResults":[{"result":[{"codeBucket":"spacecat-dev-importer","codePath":"code/9ee60274-f27a-47ab-9b60-46c09a83175c/github/OneAdobe/aem-security-vulns-testbed/main/repository.zip"}]}]}}'
```

## Step 3: CodeFix Handler

```bash
url -X POST http://localhost:3000 \
     -H "Content-Type: application/json" \
     -d '{"id":"9466759f-aa78-43e0-9cb4-f643b1b5694a","type":"codefix:security-vulnerabilities","auditId":"d03dbd86-60a7-40cb-b0f9-2800e888d7ed","siteId":"9ee60274-f27a-47ab-9b60-46c09a83175c","traceId":"156e5f0c-7a9d-4d54-8dc1-2518b26be2b1","data":{"opportunityId":"9466759f-aa78-43e0-9cb4-f643b1b5694a","success":true,"updates":[{"suggestion_id":"4fdd02ae-ca45-4761-82be-9e60c279cff8","fixes":[{"code_fix_path":"fixes/9ee60274-f27a-47ab-9b60-46c09a83175c/security_vulnerabilities_suggestion_1_run1_13c3d2f3/report.json","code_fix_bucket":"mystique-local-assets"}]}]}}'
```
