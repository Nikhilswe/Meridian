# AWS cost notes (target: fit under $60 for a 6-month demo)

These are order-of-magnitude estimates for light demo traffic (a handful of
people clicking around per day, not real production load). All resources in
`infra/cfn/main.template.yaml` are chosen specifically to keep this cheap and
to work identically in any region (no hardcoded ARNs/account IDs -- only
`AWS::Region` / `AWS::AccountId` pseudo params).

| Resource | Pricing model | 6-month estimate |
|---|---|---|
| DynamoDB (4 tables, on-demand) | pay-per-request, no idle cost | $0-3 (demo traffic is far below the always-free tier's 25 WCU/RCU-equivalent) |
| Lambda (3 functions, arm64, 256MB) | pay-per-invocation + duration | $0-1 (well within the perpetual free tier: 1M requests + 400,000 GB-s/month) |
| API Gateway (HTTP API, not REST API) | $1.00 per million requests | ~$0 at demo volume (HTTP API is ~70% cheaper than REST API) |
| S3 (attachments, 30-day lifecycle) | storage + requests | $0-2 (lifecycle rule caps how much ever accumulates) |
| Cognito User Pool | free for first 50,000 MAU | $0 |
| Secrets Manager (1 secret) | $0.40/secret/month | ~$2.40 over 6 months |
| CloudWatch Logs (14-day retention) | ingestion + storage | $0-3 |
| CloudWatch alarms (15 standard + 1 composite) | $0.10/standard alarm/month, $0.50/composite alarm/month; metric filters are free | ~$12 over 6 months (the single largest fixed line item -- delete the `HttpLatencyAlarm`/`*Duration*`/`*Throttles*` alarms if you need to trim, they are early-warning rather than failure alarms) |
| CloudWatch dashboard (1) | first 3 per account free | $0 |
| SNS alarm topic + 1 email subscription | first 1,000 email notifications/month free | $0 |
| SQS assignment DLQ | first 1M requests/month free | $0 (only receives messages when assignment has already failed 3 times) |
| Data transfer | mostly intra-region | $0-2 |
| **Total** | | **roughly $17-27 over 6 months**, leaving large headroom under $60 even accounting for LLM API costs paid separately (Anthropic/OpenAI billing is outside this AWS estimate -- keep an eye on token usage; the test-keyword bypass exists specifically so demos/tests don't burn real LLM spend by accident) |

## Why these choices keep it cheap
- **PAY_PER_REQUEST DynamoDB** instead of provisioned capacity: zero cost when nobody is using the demo, which is most of the time over 6 months.
- **HTTP API instead of REST API** in API Gateway: cheaper per-request and simpler JWT-authorizer wiring for a Cognito-fronted SPA.
- **arm64 Lambda architecture**: ~20% cheaper per GB-second than x86_64 for the same workload, and this workload has no native-arch dependency.
- **S3 lifecycle rule (30-day expiry)** on the attachments bucket: bounds storage growth for a long-running but low-volume demo.
- **14-day log retention**: avoids CloudWatch Logs storage creeping up silently over 6 months.

## What would blow the budget
Real, high-volume LLM calls (Claude/OpenAI) are billed separately from AWS and are the one line item that could matter here -- the rate limiter (10 requests / 10 minutes on both ticket-create and summarise, see `backend/src/middleware/rateLimiter.ts` and the `rateLimit.*` config keys) exists partly for this reason, and the `shouldBypassWithTestStub` rule means anything with "test" in the ticket overview never calls a real model at all.
