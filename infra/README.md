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
  --stack-name meridian-beta \
  --parameter-overrides EnvironmentName=beta LlmProvider=anthropic AlarmEmail=oncall@example.com \
  --capabilities CAPABILITY_IAM
# AlarmEmail is optional; SNS sends a confirmation email you must click before
# notifications flow. Leave it out to create the topic + alarms without a
# subscriber (attach a chat/pager integration to the AlarmTopicArn output later).
# then set the real key (never put this in source control or the template):
aws secretsmanager put-secret-value \
  --secret-id /meridian/beta/ANTHROPIC_API_KEY \
  --secret-string '{"ANTHROPIC_API_KEY":"sk-ant-..."}'
```

## Monitoring and alarms (what fires, and what to do)
Every alarm publishes to the `AlarmTopicArn` output (SNS). The composite
`meridian-<env>-backend-unhealthy` alarm is the one to page on; the
individual alarms say where to look. The `BackendDashboardUrl` output has
all of them plus the underlying graphs on one page.

| Alarm | Fires when | First thing to check |
|---|---|---|
| `http-5xx` | any 5xx at the API Gateway edge in 5 min | API Lambda log group -- was it a crash (`api-lambda-errors`) or an app 500 (`api-500s`)? |
| `http-latency-p95` | p95 > 5 s for 10 min | summarise route slow (LLM) vs everything slow (DynamoDB/Lambda cold starts) |
| `api-lambda-errors` / `-throttles` / `-duration-p95` | the Express Lambda crashed / hit concurrency limits / p95 > 12 s (80% of timeout) | log group `/aws/lambda/meridian-<env>-api`; account concurrency quota |
| `api-500s` | the Express `errorHandler` logged `Unhandled error:` | grep that string in the API log group -- the message is the thrown error |
| `summarise-errors` / `-throttles` / `-duration-p95` | the LLM Lambda failed / was throttled / p95 > 24 s | **switch agents to the manual reply process**, then check the provider |
| `llm-provider-failures` | provider returned non-2xx 3+ times in 5 min | secret `/meridian/<env>/ANTHROPIC_API_KEY` present and valid? provider status page? quota? |
| `assign-errors` / `assign-stream-lag` | assignment Lambda failing / > 60 s behind the tickets stream | tickets stuck in `OPEN`; a poison record blocks the shard until retries exhaust |
| `assign-dlq-not-empty` | a ticket-created event exhausted 3 retries | the ticket exists but is unassigned: assign it by hand, fix the cause, then redrive the DLQ |
| `tickets-read/write-throttle` | DynamoDB throttled the tickets table | a burst beyond on-demand's instant capacity; if it persists, look for a hot key |

Runbook (the four steps the on-call person can always do safely):
1. Pause the AI path if `summarise-*` or `llm-provider-failures` is firing:
   tell agents to reply manually; the review workflow does not depend on
   the draft existing.
2. Read the log group named in the alarm description for the 5-minute
   window; every `Unhandled error:` / provider-failure line carries the
   error message.
3. Check the policy version and secret before assuming code is at fault.
4. Do not redrive the DLQ or resume the AI path until the cause is known;
   record who decided and when.

Alarms treat missing data as OK (no traffic is not an outage). Standard
alarms cost $0.10/month each -- see `../docs/aws-cost-notes.md`.

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
