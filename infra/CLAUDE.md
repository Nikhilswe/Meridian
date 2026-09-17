# infra/ -- Claude project memory

Read `../CLAUDE.md` first. Full human-facing detail (deploy commands, IAM
posture, cost breakdown) lives in `infra/README.md` and
`../docs/aws-cost-notes.md` -- read those before changing anything here,
this file only adds agent-facing rules.

## State of this directory: written, reviewed, NOT deployed
There are no AWS credentials in a default session. Don't run
`sam deploy`/`aws cloudformation` assuming they'll succeed -- check the
session actually has credentials first, and if it does, still confirm with
the user before deploying (this creates real billable resources, even if
cheap -- see the cost notes doc).

## The one deliberate stopgap: don't "fix" it by hand-duplicating more logic
`infra/lambda/assignTicket/index.js` and `infra/lambda/summariseCase/index.js`
are plain JS files that talk to DynamoDB directly, re-implementing (not
importing) the same logic as `backend/src/services/AssignmentService.ts` and
`SummarisationService.ts`. This was an explicit, documented choice to keep
the infra scaffold runnable/reviewable without requiring DynamoDB-backed
repository implementations or a bundler in that pass -- it is NOT the
target design. If you're asked to extend AWS-side logic:
1. **Prefer writing the real fix**: implement `DynamoTicketRepository` /
   `DynamoPolicyRepository` / etc. against the SAME interfaces in
   `backend/src/repositories/`, register them in
   `backend/src/di/container.ts` behind an execution-environment check, and
   bundle the real TS services into the Lambda (esbuild, which `sam build`
   supports natively) instead of adding more hand-written `.js` duplicating
   business rules.
2. If a quick fix to the existing `.js` stub is truly all that's asked for,
   keep the two implementations' behavior identical (same round-robin
   cursor logic, same `/\btest\b/i` bypass, same status-transition rules) and
   say explicitly in your response that this is still the stopgap path, not
   the fix.
`infra/lambda/api/index.js` already does this correctly -- it wraps the real
`backend/src/app.ts` Express app via `serverless-http` rather than
reimplementing routes, and is blocked only on the Dynamo repositories
existing (see its own comment).

## Alarms live in the template, not in the console
`cfn/main.template.yaml` defines every CloudWatch alarm, the SNS
`AlarmTopic`, the assignment DLQ, the explicit Lambda log groups (needed
for retention AND for the log metric filters), and the dashboard. If you
add a Lambda or a table, add its `Errors`/throttle alarm next to the
existing ones and a row to the table in `README.md`; never create alarms
by hand in the console where the next deploy can't see them. Log-based
alarms match exact strings the code logs (`"Unhandled error:"` from
`backend/src/middleware/errorHandler.ts`, `"API request failed with status"`
from the providers) -- if you change those log lines, change the
`FilterPattern` too.

## Region/env parameters
`cfn/main.template.yaml` takes `EnvironmentName` (beta|prod) and
`LlmProvider`, and uses only `AWS::Region`/`AWS::AccountId` pseudo
parameters -- never hardcode a region, account ID, or ARN. If you add a
resource, keep this property; the template is meant to deploy unmodified
into any region.

## Budget discipline
Every resource choice here (PAY_PER_REQUEST DynamoDB, HTTP API over REST
API, arm64 Lambda, S3 lifecycle expiry, 14-day log retention) exists to keep
this under the user's ~$60/6-month demo budget -- see
`../docs/aws-cost-notes.md` for the line-item reasoning. If you add a new
AWS resource, add a line to that doc explaining its cost impact, and prefer
the cheapest option that still satisfies the requirement (e.g. on-demand
over provisioned capacity, HTTP API over REST API) unless the user asks for
something that specifically needs the pricier option.
