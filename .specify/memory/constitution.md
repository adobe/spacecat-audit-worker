<!--
Sync Impact Report:
- Version change: (new) → 1.0.0
- Modified principles: N/A (initial version)
- Added sections: All sections (initial creation)
- Removed sections: None
- Templates requiring updates:
  ✅ plan-template.md - reviewed, no changes needed (constitution check placeholder present)
  ✅ spec-template.md - reviewed, no changes needed (user stories align with audit principles)
  ✅ tasks-template.md - reviewed, no changes needed (task structure supports audit workflow)
  ✅ agent-file-template.md - reviewed, no changes needed
  ✅ checklist-template.md - reviewed, no changes needed
- Follow-up TODOs: None
-->

# SpaceCat Audit Worker Constitution

## Core Principles

### I. Audit-Based Architecture

Every feature must be implemented as an audit or audit component. Audits are operations that inspect, collect, verify, or analyze data for a given URL or site. Each audit MUST:

- Accept a URL and context as parameters
- Return an `auditResult` object and `fullAuditRef` reference
- Use the `AuditBuilder` pattern for composition
- Integrate with the standard audit lifecycle (site provider, org provider, URL resolver, runner, persister, message sender, post-processors)

**Rationale**: Consistent audit architecture ensures predictable behavior, enables reuse of common components (persistence, messaging, validation), and maintains operational uniformity across all site inspections.

### II. Builder Pattern for Composition

Audits MUST be constructed using the `AuditBuilder` fluent API rather than direct instantiation. Builders provide:

- Clear declaration of audit steps and customizations
- Type-safe configuration through chaining methods
- Explicit override points for default behavior (`withUrlResolver`, `withPersister`, `withMessageSender`, etc.)
- Support for both runner-based (single-function) and step-based (multi-step workflow) audits

**Rationale**: The builder pattern enforces consistent audit construction, makes customization points explicit, and prevents misconfiguration by validating audit structure at build time.

### III. Step-Based Workflows (When Required)

Complex audits requiring multiple specialized processing stages MUST use step-based architecture via `addStep()`. Step-based audits are required when:

- Processing requires coordination with external workers (content scrapers, import workers, etc.)
- Execution time exceeds Lambda limits for single-pass processing
- Different steps require different processing capabilities

Each step MUST:

- Specify a valid destination queue (except the final step)
- Return data conforming to the destination's payload format
- Preserve `auditContext` to maintain the step chain
- Handle audit state via `context.audit` (undefined only for first step)

**Rationale**: Step-based workflows enable complex, long-running audit operations to be decomposed into manageable units that can be distributed across specialized workers while maintaining audit state consistency.

### IV. Test Coverage and Validation (NON-NEGOTIABLE)

All audit logic MUST be thoroughly tested. Required test coverage:

- **Unit tests**: Core audit logic, data transformers, validators
- **Integration tests**: Audit execution end-to-end, persistence, messaging
- **Contract tests**: API endpoints, queue message formats, external service interfaces
- Coverage threshold maintained at project standards (visible in codecov badge)

Tests MUST be written BEFORE implementation when following TDD workflow. Tests MUST verify:

- Successful audit execution paths
- Error handling and edge cases
- Data persistence to DynamoDB
- Message sending to SQS queues
- Post-processor execution

**Rationale**: Audits directly impact site analysis and optimization recommendations. Inadequate testing risks incorrect data collection, missed issues, or false positives that degrade trust in the SpaceCat system.

### V. Opportunity and Suggestion Framework

Audits that identify actionable improvements MUST use the opportunity and suggestion framework. Implementation requires:

- Post-processor using `convertToOpportunity` from `common/opportunity.js`
- Data mapper in `opportunity-data-mapper.js` defining: runbook, origin, title, description, guidance steps, tags, and data
- Use of `syncSuggestions` to map new suggestions to opportunities
- Unique key generation via `buildKey` for suggestion tracking

Auto-suggest features (AI-generated suggestions) MUST:

- Verify site enablement via configuration: `configuration.isHandlerEnabledForSite('[audit-name]-auto-suggest', site)`
- Check audit success before generating suggestions
- Return unmodified `auditData` if disabled or audit failed
- Chain with opportunity conversion in post-processors

**Rationale**: Standardized opportunity and suggestion handling ensures consistent user experience across all audit types, enables tracking of improvement adoption, and provides a unified interface for both automated and AI-assisted recommendations.

### VI. AWS Serverless Architecture Compliance

All audit code MUST operate within AWS Lambda constraints:

- Maximum execution time: 15 minutes (900 seconds) - use step-based audits for longer operations
- Memory allocation: 6144 MB (as configured in package.json)
- Node.js version: 24.x (as specified in engines)
- Bundle compatibility: Code must work when packaged by helix-deploy
- Secrets management: Use AWS Secrets Manager via helix-shared-secrets, NEVER hardcode credentials
- State persistence: Use DynamoDB (via data access layer), not in-memory state
- Message passing: Use SQS queues for async communication

**Rationale**: Lambda constraints are hard limits that cause immediate failure if exceeded. Compliance ensures audits run reliably in production and integrate properly with the AWS infrastructure.

### VII. Observability and Debugging

All audits MUST provide clear observability:

- Structured logging via `context.log` at appropriate levels (info, warn, error)
- Log key audit milestones: start, data collection points, external calls, completion, errors
- Include site ID, audit type, and audit ID in log context
- Expose audit results via SpaceCat API for inspection
- Store full audit references (`fullAuditRef`) pointing to detailed results (S3, external APIs, etc.)
- Preserve error stack traces and context in failure scenarios

**Rationale**: Audits run asynchronously and may fail hours after triggering. Comprehensive logging and result tracking are essential for debugging issues, monitoring system health, and validating audit correctness.

## Development Workflow

### Local Development Requirements

Developers MUST use one of the supported local development methods:

1. **Source mode** (`npm start`): Direct source execution with hot reload
   - Requires manual environment variable export
   - Use for active development with breakpoints
   - Runs `test/dev/server.mjs`

2. **Bundle mode** (`npm run start:unpacked`): Tests actual Lambda artifact
   - Automatically loads `.env` via dotenv
   - Required for debugging bundle-specific issues
   - Validates production deployment behavior

Environment setup:

- AWS credentials from KLAM (DEV profile only, NEVER production)
- `.env` file in project root (NEVER committed to git)
- Application secrets via `./scripts/populate-env.sh` from AWS Secrets Manager
- Secrets path: `/helix-deploy/spacecat-services/audit-worker/latest`

**Rationale**: Consistent local development environment prevents "works on my machine" issues and ensures developers test against the same infrastructure as production.

### Code Quality Gates

Before committing code:

1. **Linting**: `npm run lint` must pass (enforced in CI)
2. **Tests**: `npm test` must pass with no reduction in coverage
3. **Bundle validation**: `npm run build` must succeed without errors
4. **Staged file linting**: Husky pre-commit hook enforces linting on changed files

Commit messages MUST follow semantic-release format via `npm run commit` wizard.

**Rationale**: Automated quality gates prevent broken code from entering main branch and ensure consistent code style across the team.

## Security Requirements

### Secrets and Credentials

- NEVER commit API keys, tokens, passwords, or AWS credentials
- NEVER hardcode sensitive values in source code
- Reference secrets via environment variables only
- Document new secrets in README and `template.yml`
- Add placeholders (not values) to `.env.example` if maintained

### Data Handling

- Treat all site data as potentially sensitive
- Log only non-sensitive identifiers (site ID, URL)
- NEVER log full page content, user data, or API responses containing PII
- Use DynamoDB encryption at rest (enabled by default)
- Use HTTPS for all external API calls

**Rationale**: SpaceCat processes data for Adobe customers. Security violations risk customer trust, compliance violations, and potential data breaches.

## Governance

### Constitution Authority

This constitution supersedes all other development practices. When conflicts arise between this constitution and other documentation, the constitution takes precedence.

### Amendment Process

1. Amendments require documented rationale explaining:
   - What is changing and why
   - Impact on existing audits and workflows
   - Migration plan for existing code if applicable
2. Version must be incremented according to semantic versioning:
   - MAJOR: Backward incompatible changes (e.g., removing a principle)
   - MINOR: New principles or material expansions
   - PATCH: Clarifications, wording improvements, typo fixes
3. Sync impact report MUST be updated at top of this file
4. Dependent templates MUST be reviewed and updated if affected

### Compliance Review

All pull requests MUST verify compliance with:

- Audit-based architecture (Principle I)
- Builder pattern usage (Principle II)
- Test coverage requirements (Principle IV, NON-NEGOTIABLE)
- AWS Lambda constraints (Principle VI)
- Security requirements (entire section)

Code reviews MUST reject PRs that violate NON-NEGOTIABLE principles.

### Runtime Development Guidance

For runtime development guidance (active technologies, project structure, common commands), refer to:

- README.md: Setup, local development, audit creation guide
- docs/API.md: API reference
- .specify/templates/agent-file-template.md: Auto-generated development guidelines (when implemented)

**Version**: 1.0.0 | **Ratified**: 2026-01-22 | **Last Amended**: 2026-01-22
