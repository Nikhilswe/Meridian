# infra/ -- AWS scaffold (code-only in this pass)

This directory is written so a real deploy is a small number of commands
once you have AWS credentials -- but nothing here has been deployed or even
`sam build`-ed yet, by design (this environment has no AWS credentials, and
the session's stated priority was getting the offline flow solid first).

## Layout
- `cfn/main.template.yaml` -- a single AWS SAM/CloudFormation template (SAM
  is a CFN superset, deployed with the plain `aws cloudformation` CLI too if
  you prefer, since `sam build` just resolves the `AWS::Serverless::*`
  transform down to native CFN resources). Parameterized by `EnvironmentName`
  (beta|prod) and `LlmProvider`; uses only `AWS::Region`/`AWS::AccountId`
  pseudo params, so the identical template deploys to any region.
- `lambda/assignTicket/` -- DynamoDB-Stream-triggered function mirroring
  `backend/src/services/AssignmentService.ts`'s round-robin logic.
- `lambda/summariseCase/` -- API-Gateway-triggered function mirroring
  `backend/src/services/SummarisationService.ts`, including the identical
  test-keyword bypass rule and Claude (Anthropic) call shape.
- `lambda/api/` -- thin `serverless-http` wrapper intended to host the exact
  same Express app as the offline server (`backend/src/app.ts`) for ticket
  CRUD + auth, so that logic is never duplicated between local and AWS.

## Known gaps (intentionally left for a follow-up pass)
1. **No DynamoDB-backed repository implementations yet.** The backend's
   repository interfaces (`ITicketRepository`, `IPolicyRepository`, etc.)
   only have Postgres implementations right now. `lambda/api/index.js`'s
   comment flags this: to actually run `MainApiFunction` in AWS, add
   `DynamoTicketRepository` etc. implementing the same interfaces, register
   them in the DI container when `AWS_EXECUTION_ENV` is set, and bundle
   `backend/dist` into this Lambda with esbuild/`sam build`'s built-in
   esbuild support. Until then, `assignTicket` and `summariseCase`'s `.js`
   files talk to DynamoDB directly (hand-written, not generated from the TS
   services) purely so the *infrastructure* is complete and reviewable now.
2. **No CI/CD pipeline** (CodePipeline/GitHub Actions deploy workflow) --
   deploy manually for the demo; add one before treating this as prod.
3. **Cognito user provisioning** isn't automated -- create demo users via
   `aws cognito-idp admin-create-user` after the stack exists.

## Deploying once you have credentials
```bash
cd infra/cfn
sam build --template-file main.template.yaml
sam deploy --guided \
  --stack-name scaler-beta \
  --parameter-overrides EnvironmentName=beta LlmProvider=anthropic \
  --capabilities CAPABILITY_IAM
# then set the real key (never put this in source control or the template):
aws secretsmanager put-secret-value \
  --secret-id /scaler/beta/ANTHROPIC_API_KEY \
  --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-..."}'
```

## IAM / security posture already in the template
- Every Lambda's permissions are scoped with SAM `Policies:` shorthand
  (`DynamoDBCrudPolicy`, `S3CrudPolicy`, explicit `secretsmanager:GetSecretValue`
  on exactly one secret ARN) -- no `*` resource or action anywhere.
- API Gateway's default authorizer is the Cognito User Pool's JWT issuer;
  nothing is reachable unauthenticated except what you explicitly exclude.
- S3 bucket blocks all public access and uses default SSE-S3 encryption;
  DynamoDB tables use SSE by default too.
- Secrets (API keys) live in Secrets Manager, never in Lambda environment
  variables or the template itself -- `AwsSecretsManagerProvider` (backend
  code, reused conceptually by the Lambda stubs here) fetches them at call
  time only.
